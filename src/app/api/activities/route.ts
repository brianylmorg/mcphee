import { NextRequest, NextResponse } from "next/server";
import { createDB } from "@/db";
import { requireBabyInHousehold, userNameForHousehold } from "@/lib/db/household";
import { generateId } from "@/lib/utils";
import { normalizeActivityCreators } from "@/lib/activity-creators";
import { parseActivityDetails } from "@/lib/milk-volumes";
import { bottleBreastmilkLibraryDeduction } from "@/lib/milk-calculation";
import { MilkLedgerError, previewAvailableUse, replayMilkLedger, type MilkLedgerActivity } from "@/lib/milk-bank-ledger";

export const runtime = "nodejs";

const VALID_TYPES = new Set(["bottlefeed", "breastfeed", "pump", "diaper", "vomit", "sleep", "bankadjust", "note", "temperature"]);
const FUTURE_CLOCK_SKEW_MS = 2 * 60 * 1000;

function isValidTimestamp(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function validateActivityInput(body: Record<string, unknown>) {
  if (typeof body.babyId !== "string" || !body.babyId) return "babyId is required";
  if (typeof body.type !== "string" || !VALID_TYPES.has(body.type)) return "Invalid activity type";
  if (!isValidTimestamp(body.startedAt)) return "startedAt must be a timestamp";
  if (body.endedAt != null && !isValidTimestamp(body.endedAt)) return "endedAt must be a timestamp";
  if (body.endedAt != null && Number(body.endedAt) < Number(body.startedAt)) {
    return "endedAt must be after startedAt";
  }
  if (body.details != null && (typeof body.details !== "object" || Array.isArray(body.details))) {
    return "details must be an object";
  }
  if ((body.type === "note" || body.type === "temperature" || body.type === "sleep") && Number(body.startedAt) > Date.now() + FUTURE_CLOCK_SKEW_MS) {
    return "startedAt cannot be in the future";
  }
  if (body.type === "sleep" && body.endedAt != null && Number(body.endedAt) > Date.now() + FUTURE_CLOCK_SKEW_MS) {
    return "endedAt cannot be in the future";
  }
  const details = (body.details ?? {}) as Record<string, unknown>;
  if (typeof details.notes === "string" && details.notes.length > 500) {
    return "Notes must be 500 characters or fewer";
  }
  if (body.type === "note" && (typeof details.notes !== "string" || !details.notes.trim())) {
    return "Note text is required";
  }
  if (body.type === "temperature") {
    const celsius = Number(details.celsius);
    if (!Number.isFinite(celsius) || celsius < 30 || celsius > 45) {
      return "Temperature must be between 30 and 45 °C";
    }
    const methods = new Set(["armpit", "ear", "oral", "rectal", "forehead", "other"]);
    if (details.method != null && details.method !== "" && !methods.has(String(details.method))) {
      return "Invalid temperature measurement method";
    }
  }
  return null;
}

type DB = ReturnType<typeof createDB>;

async function milkLedgerForHousehold(
  db: Pick<DB, "execute">,
  householdId: string,
  excludeActivityId?: string,
): Promise<MilkLedgerActivity[]> {
  let sql = `SELECT a.id, a.type, a.started_at, a.created_at, a.details FROM activities a
             JOIN babies b ON b.id = a.baby_id
             WHERE b.household_id = ? AND a.type IN (?, ?, ?, ?, ?, ?)`;
  const args: Array<string | number> = [householdId, "pump", "bottlefeed", "bankadjust", "bankfreeze", "bankthaw", "bankdiscard"];
  if (excludeActivityId) {
    sql += " AND a.id != ?";
    args.push(excludeActivityId);
  }
  sql += " ORDER BY a.started_at ASC, a.created_at ASC, a.id ASC";

  const result = await db.execute({ sql, args });
  return result.rows.map((row) => ({
    id: String(row.id),
    type: String(row.type),
    startedAt: Number(row.started_at),
    createdAt: Number(row.created_at),
    details: parseActivityDetails(row.details),
  }));
}

export async function GET(request: NextRequest) {
  const householdId = request.cookies.get("mcphee_hh")?.value;

  if (!householdId) {
    return NextResponse.json({ activities: [] });
  }

  try {
    const db = createDB();
    const { searchParams } = new URL(request.url);
    const babyId = searchParams.get("babyId");
    const types = [...new Set(searchParams.getAll("type").filter(Boolean))];
    const date = searchParams.get("date");
    const limitParam = searchParams.get("limit") || "50";
    const unlimited = limitParam === "all";
    const requestedLimit = Number(limitParam);
    const limit = Number.isFinite(requestedLimit)
      ? Math.max(1, Math.min(500, Math.floor(requestedLimit)))
      : 50;

    if (types.some((type) => !VALID_TYPES.has(type))) {
      return NextResponse.json({ error: "Invalid activity type" }, { status: 400 });
    }
    if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json({ error: "Invalid date" }, { status: 400 });
    }

    let sql = `
      SELECT a.*, b.name as baby_name
      FROM activities a
      JOIN babies b ON a.baby_id = b.id
      WHERE b.household_id = ?
        AND a.type NOT IN ('bankfreeze', 'bankthaw', 'bankdiscard')
    `;
    const args: Array<string | number> = [householdId];

    if (babyId) {
      sql += " AND a.baby_id = ?";
      args.push(babyId);
    }
    if (types.length > 0) {
      sql += ` AND a.type IN (${types.map(() => "?").join(", ")})`;
      args.push(...types);
    }
    if (date) {
      const dayStart = Date.parse(date + "T00:00:00+08:00");
      if (!Number.isFinite(dayStart)) {
        return NextResponse.json({ error: "Invalid date" }, { status: 400 });
      }
      const dayEnd = dayStart + 24 * 60 * 60 * 1000;
      sql += " AND ((a.started_at >= ? AND a.started_at < ?) OR (a.type = 'sleep' AND a.ended_at >= ? AND a.ended_at < ?))";
      args.push(dayStart, dayEnd, dayStart, dayEnd);
    }

    sql += " ORDER BY a.started_at DESC";
    if (!unlimited) {
      sql += " LIMIT ?";
      args.push(limit);
    }

    const [result, users] = await db.batch([
      { sql, args },
      { sql: "SELECT name FROM users WHERE household_id = ?", args: [householdId] },
    ], "read");
    const normalizedActivities = normalizeActivityCreators(
      result.rows as unknown as Array<Record<string, unknown> & { created_by?: unknown }>,
      users.rows as unknown as Array<{ name?: unknown }>,
    );
    return NextResponse.json({ activities: normalizedActivities });
  } catch (error) {
    console.error("Activities API error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const householdId = request.cookies.get("mcphee_hh")?.value;

  if (!householdId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const inputError = validateActivityInput(body);
    if (inputError) return NextResponse.json({ error: inputError }, { status: 400 });

    const db = createDB();
    const isBottlefeed = body.type === "bottlefeed";
    const [babyError, createdBy] = await Promise.all([
      requireBabyInHousehold(db, body.babyId, householdId),
      userNameForHousehold(db, request.cookies.get("mcphee_user")?.value, householdId),
    ]);
    if (babyError) return babyError;

    // Bank reconciliation: the client sends the actual amount on hand; the
    // server computes the signed correction against its own replay so the
    // bank lands exactly on the target (repeat submissions are no-ops). The
    // replay + insert run in one write transaction so concurrent reconciles
    // from two devices serialize instead of double-applying the delta.
    if (body.type === "bankadjust") {
      const targetBankMl = Number(parseActivityDetails(body.details).targetBankMl);
      if (!Number.isFinite(targetBankMl) || targetBankMl < 0) {
        return NextResponse.json({ error: "targetBankMl must be a non-negative number" }, { status: 400 });
      }

      const tx = await db.transaction("write");
      try {
        const currentEvents = await milkLedgerForHousehold(tx, householdId);
        const currentBankMl = replayMilkLedger(currentEvents, Date.now(), new Set(currentEvents.map((event) => event.id))).availableMl;
        const deltaMl = Math.round((targetBankMl - currentBankMl) * 100) / 100;
        if (deltaMl === 0) {
          await tx.commit();
          return NextResponse.json({ id: null, deltaMl: 0, bankMl: currentBankMl });
        }

        const activityId = generateId();
        await tx.execute({
          sql: `INSERT INTO activities (id, baby_id, type, started_at, ended_at, details, created_at, created_by)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          args: [
            activityId,
            body.babyId,
            body.type,
            body.startedAt,
            null,
            JSON.stringify({
              ...parseActivityDetails(body.details),
              amount: deltaMl,
              bankBeforeMl: currentBankMl,
            }),
            Date.now(),
            createdBy,
          ],
        });
        await tx.commit();

        return NextResponse.json({ id: activityId, deltaMl, bankMl: targetBankMl });
      } catch (error) {
        try { await tx.rollback(); } catch {}
        throw error;
      }
    }

    if (isBottlefeed) {
      const tx = await db.transaction("write");
      try {
        const ledgerEvents = await milkLedgerForHousehold(tx, householdId);
        const requestedBreastmilkMl = bottleBreastmilkLibraryDeduction(parseActivityDetails(body.details));
        if (requestedBreastmilkMl > 0) {
          const preview = previewAvailableUse(ledgerEvents, requestedBreastmilkMl, Number(body.startedAt));
          if (preview.expiredMl > 0 && body.confirmExpired !== true) {
            await tx.rollback();
            return NextResponse.json({
              error: `This bottle would use ${preview.expiredMl} ml of expired Available milk. Confirm to continue.`,
              code: "EXPIRED_CONFIRMATION_REQUIRED",
              expiredMl: preview.expiredMl,
            }, { status: 409 });
          }
          replayMilkLedger([...ledgerEvents, {
            id: "__candidate_bottle__",
            type: "bottlefeed",
            startedAt: Number(body.startedAt),
            createdAt: Date.now(),
            details: parseActivityDetails(body.details),
          }], Date.now(), new Set(ledgerEvents.map((event) => event.id)));
        }
        const activityId = generateId();
        await tx.execute({
          sql: `INSERT INTO activities (id, baby_id, type, started_at, ended_at, details, created_at, created_by)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          args: [activityId, body.babyId, body.type, body.startedAt, body.endedAt || null, JSON.stringify(body.details || {}), Date.now(), createdBy],
        });
        await tx.commit();
        return NextResponse.json({ id: activityId });
      } catch (error) {
        try { await tx.rollback(); } catch {}
          if (error instanceof MilkLedgerError && error.code === "INSUFFICIENT_AVAILABLE") {
            return NextResponse.json({ error: "Breastmilk amount exceeds available breastmilk bank" }, { status: 400 });
          }
          if (error instanceof MilkLedgerError) {
            return NextResponse.json({ error: error.message, code: error.code }, { status: 409 });
          }
          throw error;
      } finally {
        tx.close();
      }
    }

    const activityId = generateId();

    await db.execute({
      sql: `INSERT INTO activities (id, baby_id, type, started_at, ended_at, details, created_at, created_by) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        activityId,
        body.babyId,
        body.type,
        body.startedAt,
        body.endedAt || null,
        JSON.stringify(body.details || {}),
        Date.now(),
        createdBy,
      ],
    });

    return NextResponse.json({ id: activityId });
  } catch (error) {
    console.error("Create activity error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  const householdId = request.cookies.get("mcphee_hh")?.value;

  if (!householdId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    if (typeof body.id !== "string" || !body.id) {
      return NextResponse.json({ error: "Activity ID required" }, { status: 400 });
    }

    const inputError = validateActivityInput(body);
    if (inputError) return NextResponse.json({ error: inputError }, { status: 400 });

    const db = createDB();

    // Fetch existing activity to merge details and verify household ownership.
    const existing = await db.execute({
      sql: "SELECT type, details, ended_at FROM activities WHERE id = ? AND baby_id IN (SELECT id FROM babies WHERE household_id = ?)",
      args: [body.id, householdId],
    });

    if (existing.rows.length === 0) {
      return NextResponse.json({ error: "Activity not found" }, { status: 404 });
    }
    if (["bankfreeze", "bankthaw", "bankdiscard"].includes(String(existing.rows[0].type))) {
      return NextResponse.json({ error: "Bank transfers must be changed through the milk bank" }, { status: 400 });
    }

    const babyError = await requireBabyInHousehold(db, body.babyId, householdId);
    if (babyError) return babyError;

    if (body.type === "sleep") {
      const sleepEnd = body.endedAt == null ? Number.MAX_SAFE_INTEGER : Number(body.endedAt);
      const overlap = await db.execute({
        sql: `SELECT id FROM activities
              WHERE baby_id = ? AND type = 'sleep' AND id != ?
                AND started_at < ? AND COALESCE(ended_at, 9223372036854775807) > ?
              LIMIT 1`,
        args: [body.babyId, body.id, sleepEnd, body.startedAt],
      });
      if (overlap.rows.length > 0) {
        return NextResponse.json({ error: "Sleep window overlaps an existing sleep window" }, { status: 409 });
      }
    }

    let mergedDetails = {};
    const existingRow = existing.rows[0] as unknown as { type: string; details: string | null; ended_at: number | null };
    const existingDetails = existingRow.details;
    if (existingDetails) {
      try {
        mergedDetails = JSON.parse(existingDetails);
      } catch {}
    }

    // Merge new details on top of existing
    mergedDetails = { ...mergedDetails, ...body.details };

    if (body.type === "bottlefeed") {
      const tx = await db.transaction("write");
      try {
        const requestedBreastmilkMl = bottleBreastmilkLibraryDeduction(parseActivityDetails(mergedDetails));
        const ledgerEvents = await milkLedgerForHousehold(tx, householdId, body.id);
        if (requestedBreastmilkMl > 0) {
          const preview = previewAvailableUse(ledgerEvents, requestedBreastmilkMl, Number(body.startedAt));
          if (preview.expiredMl > 0 && body.confirmExpired !== true) {
            await tx.rollback();
            return NextResponse.json({
              error: `This bottle would use ${preview.expiredMl} ml of expired Available milk. Confirm to continue.`,
              code: "EXPIRED_CONFIRMATION_REQUIRED",
              expiredMl: preview.expiredMl,
            }, { status: 409 });
          }
          replayMilkLedger([...ledgerEvents, {
            id: body.id,
            type: "bottlefeed",
            startedAt: Number(body.startedAt),
            createdAt: Date.now(),
            details: parseActivityDetails(mergedDetails),
          }], Date.now(), new Set(ledgerEvents.map((event) => event.id)));
        }
        await tx.execute({
          sql: `UPDATE activities SET type = ?, started_at = ?, ended_at = ?, details = ?
                WHERE id = ? AND baby_id IN (SELECT id FROM babies WHERE household_id = ?)`,
          args: [body.type, body.startedAt, "endedAt" in body ? body.endedAt ?? null : existingRow.ended_at, JSON.stringify(mergedDetails), body.id, householdId],
        });
        await tx.commit();
        return NextResponse.json({ success: true });
      } catch (error) {
        try { await tx.rollback(); } catch {}
          if (error instanceof MilkLedgerError && error.code === "INSUFFICIENT_AVAILABLE") {
            return NextResponse.json({ error: "Breastmilk amount exceeds available breastmilk bank" }, { status: 400 });
          }
          if (error instanceof MilkLedgerError) {
            return NextResponse.json({ error: error.message, code: error.code }, { status: 409 });
          }
          throw error;
      } finally {
        tx.close();
      }
    }

    await db.execute({
      sql: `UPDATE activities SET 
            type = ?,
            started_at = ?,
            ended_at = ?,
            details = ?
            WHERE id = ? AND baby_id IN (SELECT id FROM babies WHERE household_id = ?)`,
      args: [
        body.type,
        body.startedAt,
        "endedAt" in body ? body.endedAt ?? null : existingRow.ended_at,
        JSON.stringify(mergedDetails),
        body.id,
        householdId,
      ],
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Update activity error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  const householdId = request.cookies.get("mcphee_hh")?.value;

  if (!householdId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const activityId = searchParams.get("id");
    if (!activityId) {
      return NextResponse.json({ error: "Activity ID required" }, { status: 400 });
    }

    const db = createDB();

    const ownedActivity = await db.execute({
      sql: `SELECT id, type FROM activities WHERE id = ? AND baby_id IN (SELECT id FROM babies WHERE household_id = ?)`,
      args: [activityId, householdId],
    });

    if (ownedActivity.rows.length === 0) {
      return NextResponse.json({ error: "Activity not found" }, { status: 404 });
    }
    if (["bankfreeze", "bankthaw", "bankdiscard"].includes(String(ownedActivity.rows[0].type))) {
      return NextResponse.json({ error: "Bank transfers must be changed through the milk bank" }, { status: 400 });
    }

    await db.batch([
      {
        sql: `UPDATE paper_log_import_rows
              SET duplicate_activity_id = NULL
              WHERE duplicate_activity_id = ?
                AND batch_id IN (SELECT id FROM paper_log_import_batches WHERE household_id = ?)`,
        args: [activityId, householdId],
      },
      {
        sql: `UPDATE paper_log_import_rows
              SET imported_activity_id = NULL
              WHERE imported_activity_id = ?
                AND batch_id IN (SELECT id FROM paper_log_import_batches WHERE household_id = ?)`,
        args: [activityId, householdId],
      },
      {
        sql: "DELETE FROM activities WHERE id = ? AND baby_id IN (SELECT id FROM babies WHERE household_id = ?)",
        args: [activityId, householdId],
      },
    ], "write");

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Delete activity error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
