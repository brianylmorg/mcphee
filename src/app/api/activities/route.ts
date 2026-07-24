import { NextRequest, NextResponse } from "next/server";
import { createDB } from "@/db";
import { requireBabyInHousehold, userNameForHousehold } from "@/lib/db/household";
import { generateId } from "@/lib/utils";
import { normalizeActivityCreators } from "@/lib/activity-creators";
import { parseActivityDetails, pumpAmount } from "@/lib/milk-volumes";
import { bottleBreastmilkLibraryDeduction, bankAdjustmentMl } from "@/lib/milk-calculation";

export const runtime = "nodejs";

const VALID_TYPES = new Set(["bottlefeed", "breastfeed", "pump", "diaper", "vomit", "sleep", "bankadjust"]);

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
  return null;
}

type DB = ReturnType<typeof createDB>;

// Lifetime running balance (pumped minus fed, plus manual bankadjust
// corrections, over full history), matching the dashboard's breastmilk bank
// so the two never disagree.
function replayBankBalance(rows: Array<unknown>): number {
  const balance = rows.reduce<number>((running, row) => {
    const typedRow = row as unknown as { type: string; details: string | null };
    const details = parseActivityDetails(typedRow.details);
    if (typedRow.type === "pump") {
      return running + pumpAmount(details);
    }
    if (typedRow.type === "bankadjust") {
      return Math.max(0, running + bankAdjustmentMl(details));
    }
    if (typedRow.type === "bottlefeed") {
      return Math.max(0, running - bottleBreastmilkLibraryDeduction(details));
    }
    return running;
  }, 0);

  return Math.max(0, balance);
}

async function breastmilkLibraryForBaby(db: DB, babyId: string, householdId: string, excludeActivityId?: string): Promise<number> {
  let sql = `SELECT a.id, a.type, a.details, a.started_at, a.created_at FROM activities a
             WHERE a.baby_id = ?
               AND a.baby_id IN (SELECT id FROM babies WHERE household_id = ?)
               AND a.type IN (?, ?, ?)`;
  const args: Array<string | number> = [babyId, householdId, "pump", "bottlefeed", "bankadjust"];
  if (excludeActivityId) {
    sql += " AND a.id != ?";
    args.push(excludeActivityId);
  }
  sql += " ORDER BY a.started_at ASC, a.created_at ASC";

  const result = await db.execute({ sql, args });
  return replayBankBalance(result.rows);
}

// Household-wide balance, matching what the dashboard bank card shows.
async function breastmilkLibraryForHousehold(db: DB, householdId: string): Promise<number> {
  const result = await db.execute({
    sql: `SELECT a.type, a.details FROM activities a
          JOIN babies b ON b.id = a.baby_id
          WHERE b.household_id = ? AND a.type IN (?, ?, ?)
          ORDER BY a.started_at ASC, a.created_at ASC`,
    args: [householdId, "pump", "bottlefeed", "bankadjust"],
  });
  return replayBankBalance(result.rows);
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
      sql += " AND a.started_at >= ? AND a.started_at < ?";
      args.push(dayStart, dayStart + 24 * 60 * 60 * 1000);
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
    const [babyError, availableBreastmilkMl, createdBy] = await Promise.all([
      requireBabyInHousehold(db, body.babyId, householdId),
      isBottlefeed
        ? breastmilkLibraryForBaby(db, body.babyId, householdId)
        : Promise.resolve(0),
      userNameForHousehold(db, request.cookies.get("mcphee_user")?.value, householdId),
    ]);
    if (babyError) return babyError;

    // Bank reconciliation: the client sends the actual amount on hand; the
    // server computes the signed correction against its own replay so the
    // bank lands exactly on the target (repeat submissions are no-ops).
    if (body.type === "bankadjust") {
      const targetBankMl = Number(parseActivityDetails(body.details).targetBankMl);
      if (!Number.isFinite(targetBankMl) || targetBankMl < 0) {
        return NextResponse.json({ error: "targetBankMl must be a non-negative number" }, { status: 400 });
      }

      const currentBankMl = await breastmilkLibraryForHousehold(db, householdId);
      const deltaMl = Math.round((targetBankMl - currentBankMl) * 100) / 100;
      if (deltaMl === 0) {
        return NextResponse.json({ id: null, deltaMl: 0, bankMl: currentBankMl });
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

      return NextResponse.json({ id: activityId, deltaMl, bankMl: targetBankMl });
    }

    if (isBottlefeed) {
      const requestedBreastmilkMl = bottleBreastmilkLibraryDeduction(parseActivityDetails(body.details));
      if (requestedBreastmilkMl > availableBreastmilkMl) {
        return NextResponse.json(
          { error: "Breastmilk amount exceeds available breastmilk bank" },
          { status: 400 }
        );
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

    const babyError = await requireBabyInHousehold(db, body.babyId, householdId);
    if (babyError) return babyError;

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
      const requestedBreastmilkMl = bottleBreastmilkLibraryDeduction(parseActivityDetails(mergedDetails));
      const availableBreastmilkMl = await breastmilkLibraryForBaby(db, body.babyId, householdId, body.id);
      if (requestedBreastmilkMl > availableBreastmilkMl) {
        return NextResponse.json(
          { error: "Breastmilk amount exceeds available breastmilk bank" },
          { status: 400 }
        );
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
      sql: `SELECT id FROM activities WHERE id = ? AND baby_id IN (SELECT id FROM babies WHERE household_id = ?)`,
      args: [activityId, householdId],
    });

    if (ownedActivity.rows.length === 0) {
      return NextResponse.json({ error: "Activity not found" }, { status: 404 });
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
