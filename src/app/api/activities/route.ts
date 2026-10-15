import { NextRequest, NextResponse } from "next/server";
import { createDB } from "@/db";
import { hasCaretakerConflictActivityColumn } from "@/db/caretaker-import-schema";
import { requireBabyInHousehold, userNameForHousehold } from "@/lib/db/household";
import { generateId } from "@/lib/utils";
import { parseActivityDetails } from "@/lib/milk-volumes";
import { bottleBreastmilkLibraryDeduction } from "@/lib/milk-calculation";
import { assertMilkLedgerMutation, MilkLedgerError, replayMilkLedger } from "@/lib/milk-bank-ledger";
import { readActivityTimeline, TIMELINE_TYPES } from "@/lib/activity-timeline";
import { projectCaretakerActivityLog } from "@/lib/caretaker-activity-log";
import { parseHistoricalMedicationDetails } from "@/lib/historical-medication";
import { milkLedgerForHousehold, validateActivityInput } from "@/lib/activity-input";

export const runtime = "nodejs";

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

    if (types.some((type) => !TIMELINE_TYPES.has(type))) {
      return NextResponse.json({ error: "Invalid activity type" }, { status: 400 });
    }
    if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json({ error: "Invalid date" }, { status: 400 });
    }

    if (date) {
      const dayStart = Date.parse(date + "T00:00:00+08:00");
      if (!Number.isFinite(dayStart)) {
        return NextResponse.json({ error: "Invalid date" }, { status: 400 });
      }
    }
    // Read the full diary first, then let the display-only caretaker projector
    // merge its imported attribution and virtual care markers before the
    // caller's limit is applied.
    const timeline = await readActivityTimeline(db, householdId, {
      babyId, types, date, limit: null,
    });
    const activities = await projectCaretakerActivityLog(db, householdId, timeline, {
      babyId, types, date, limit: unlimited ? null : limit,
    });
    return NextResponse.json({ activities }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
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
          assertMilkLedgerMutation(ledgerEvents, [...ledgerEvents, {
            id: "__candidate_bottle__",
            type: "bottlefeed",
            startedAt: Number(body.startedAt),
            createdAt: Date.now(),
            details: parseActivityDetails(body.details),
          }], Date.now());
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

    const db = createDB();

    // Fetch existing activity to merge details and verify household ownership.
    const existing = await db.execute({
      sql: "SELECT type, details, ended_at FROM activities WHERE id = ? AND baby_id IN (SELECT id FROM babies WHERE household_id = ?)",
      args: [body.id, householdId],
    });

    if (existing.rows.length === 0) {
      return NextResponse.json({ error: "Activity not found" }, { status: 404 });
    }
    if (String(existing.rows[0].type) === "medication"
      && parseHistoricalMedicationDetails(existing.rows[0].details)) {
      return NextResponse.json(
        { error: "Historical medication activities must be changed through the historical medication editor" },
        { status: 400 },
      );
    }
    if (["bankfreeze", "bankthaw", "bankdiscard"].includes(String(existing.rows[0].type))) {
      return NextResponse.json({ error: "Bank transfers must be changed through the milk bank" }, { status: 400 });
    }

    const inputError = validateActivityInput(body);
    if (inputError) return NextResponse.json({ error: inputError }, { status: 400 });

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
        const ledgerEvents = await milkLedgerForHousehold(tx, householdId);
        if (requestedBreastmilkMl > 0) {
          assertMilkLedgerMutation(ledgerEvents, [...ledgerEvents.filter((event) => event.id !== body.id), {
            id: body.id,
            type: "bottlefeed",
            startedAt: Number(body.startedAt),
            createdAt: Date.now(),
            details: parseActivityDetails(mergedDetails),
          }], Date.now());
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
      sql: `SELECT id, type, details FROM activities WHERE id = ? AND baby_id IN (SELECT id FROM babies WHERE household_id = ?)`,
      args: [activityId, householdId],
    });

    if (ownedActivity.rows.length === 0) {
      return NextResponse.json({ error: "Activity not found" }, { status: 404 });
    }
    if (String(ownedActivity.rows[0].type) === "medication"
      && parseHistoricalMedicationDetails(ownedActivity.rows[0].details)) {
      return NextResponse.json(
        { error: "Historical medication activities must be changed through the historical medication editor" },
        { status: 400 },
      );
    }
    if (["bankfreeze", "bankthaw", "bankdiscard"].includes(String(ownedActivity.rows[0].type))) {
      return NextResponse.json({ error: "Bank transfers must be changed through the milk bank" }, { status: 400 });
    }

    const referenceCleanup: Parameters<typeof db.batch>[0] = [
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
    ];
    if (await hasCaretakerConflictActivityColumn(db)) {
      referenceCleanup.push({
        sql: `UPDATE paper_log_import_rows
              SET conflict_activity_id = NULL
              WHERE conflict_activity_id = ?
                AND batch_id IN (SELECT id FROM paper_log_import_batches WHERE household_id = ?)`,
        args: [activityId, householdId],
      });
    }
    referenceCleanup.push({
        sql: "DELETE FROM activities WHERE id = ? AND baby_id IN (SELECT id FROM babies WHERE household_id = ?)",
        args: [activityId, householdId],
    });
    await db.batch(referenceCleanup, "write");

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Delete activity error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
