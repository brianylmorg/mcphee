import { NextRequest, NextResponse } from "next/server";
import { createDB } from "@/db";
import { bottleBreastmilkLibraryDeduction } from "@/lib/milk-calculation";
import { normalizeActivityCreators } from "@/lib/activity-creators";
import { bottleVolumes, parseActivityDetails, pumpAmount } from "@/lib/milk-volumes";
import { replayMilkLedger, type MilkLedgerActivity } from "@/lib/milk-bank-ledger";

const sgtDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Singapore",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export const runtime = "nodejs";


export async function GET(request: NextRequest) {
  const householdId = request.cookies.get("mcphee_hh")?.value;

  if (!householdId) {
    return NextResponse.json({
      babies: [],
      activities: [],
      household: null,
      timers: [],
      measurement: null,
    });
  }

  try {
    const db = createDB();
    const now = new Date();
    const sgtParts = sgtDateFormatter.formatToParts(now);
    const sgtPart = (type: string) => sgtParts.find((part) => part.type === type)?.value ?? "00";
    const sgtDate = [sgtPart("year"), sgtPart("month"), sgtPart("day")].join("-");
    const dayStart = Date.parse(sgtDate + "T00:00:00+08:00");
    const dayEnd = dayStart + 24 * 60 * 60 * 1000;

    const [babies, activities, household, timers, measurements, dailyMilk, pumpedLedger, users, sleepActivities] = await db.batch([
      {
        sql: "SELECT * FROM babies WHERE household_id = ?",
        args: [householdId],
      },
      {
        sql: `SELECT a.*, b.name as baby_name
              FROM activities a
              JOIN babies b ON a.baby_id = b.id
              WHERE b.household_id = ?
                AND a.type NOT IN ('bankfreeze', 'bankthaw', 'bankdiscard')
              ORDER BY a.started_at DESC LIMIT 50`,
        args: [householdId],
      },
      {
        sql: "SELECT * FROM households WHERE id = ?",
        args: [householdId],
      },
      {
        sql: `SELECT t.*, b.name as baby_name
              FROM active_timers t
              JOIN babies b ON t.baby_id = b.id
              WHERE b.household_id = ?`,
        args: [householdId],
      },
      {
        sql: `SELECT m.* FROM measurements m
              JOIN babies b ON m.baby_id = b.id
              WHERE b.household_id = ? AND m.weight_g IS NOT NULL
              ORDER BY m.measured_at DESC, m.created_at DESC LIMIT 1`,
        args: [householdId],
      },
      {
        sql: `SELECT a.type, a.details FROM activities a
              JOIN babies b ON a.baby_id = b.id
              WHERE b.household_id = ?
                AND a.type IN (?, ?)
                AND a.started_at >= ?
                AND a.started_at < ?`,
        args: [householdId, "bottlefeed", "pump", dayStart, dayEnd],
      },
      {
        sql: `SELECT a.id, a.type, a.details, a.started_at, a.created_at FROM activities a
              JOIN babies b ON a.baby_id = b.id
              WHERE b.household_id = ?
                AND a.type IN (?, ?, ?, ?, ?, ?)
              ORDER BY a.started_at ASC, a.created_at ASC`,
        args: [householdId, "bottlefeed", "pump", "bankadjust", "bankfreeze", "bankthaw", "bankdiscard"],
      },
      {
        sql: "SELECT name FROM users WHERE household_id = ?",
        args: [householdId],
      },
      {
        sql: `SELECT a.id, a.baby_id, a.started_at, a.ended_at
              FROM activities a JOIN babies b ON b.id = a.baby_id
              WHERE b.household_id = ? AND a.type = 'sleep'
              ORDER BY (a.ended_at IS NULL) DESC, COALESCE(a.ended_at, a.started_at) DESC`,
        args: [householdId],
      },
    ], "read");

    const householdRow = household.rows[0];
    const dailyMilkTotals = dailyMilk.rows.reduce((total, row) => {
      const typedRow = row as unknown as { type: string; details: string | null; started_at?: number };
      const details = parseActivityDetails(typedRow.details);
      if (typedRow.type === "pump") {
        total.pumpedMl += pumpAmount(details);
        return total;
      }

      const volumes = bottleVolumes(details);
      total.breastmilkMl += volumes.breastmilkMl;
      total.formulaMl += volumes.formulaMl;
      return total;
    }, { breastmilkMl: 0, formulaMl: 0, pumpedMl: 0 });
    const dailyMilkMl = dailyMilkTotals.breastmilkMl + dailyMilkTotals.formulaMl;

    const ledgerEvents: MilkLedgerActivity[] = pumpedLedger.rows.map((row) => {
      const typedRow = row as unknown as { id: string; type: string; details: string | null; started_at?: number; created_at?: number };
      return {
        id: String(typedRow.id),
        type: String(typedRow.type),
        startedAt: Number(typedRow.started_at),
        createdAt: Number(typedRow.created_at),
        details: parseActivityDetails(typedRow.details),
      };
    });
    const bankState = replayMilkLedger(ledgerEvents, now.getTime(), new Set(ledgerEvents.map((event) => event.id)));
    const pumpEvents = ledgerEvents.filter((event) => event.type === "pump");
    const latestPump = pumpEvents[pumpEvents.length - 1];
    const totalPumpedMl = pumpEvents.reduce((sum, event) => sum + pumpAmount(event.details), 0);
    const breastmilkConsumedMl = ledgerEvents
      .filter((event) => event.type === "bottlefeed")
      .reduce((sum, event) => sum + bottleBreastmilkLibraryDeduction(event.details), 0);
    const pumpedMilkBatches = bankState.availableBatches.map((batch) => ({
      id: batch.id,
      addedAt: batch.addedAt,
      pumpedAt: batch.addedAt,
      amountMl: batch.amountMl,
      remainingMl: batch.remainingMl,
      expiresAt: batch.expiresAt,
      isExpired: batch.expiresAt != null && batch.expiresAt <= now.getTime(),
      isAdjustment: batch.source === "adjustment",
      source: batch.source,
    }));
    const latestWeightG = Number((measurements.rows[0] as { weight_g?: unknown } | undefined)?.weight_g);
    const expectedMilkMl = Number.isFinite(latestWeightG)
      ? Math.round((latestWeightG / 1000) * 150)
      : null;

    return NextResponse.json({
      babies: babies.rows,
      activities: normalizeActivityCreators(
        activities.rows as unknown as Array<Record<string, unknown> & { created_by?: unknown }>,
        users.rows as unknown as Array<{ name?: unknown }>,
      ),
      household: householdRow
        ? {
            id: householdRow.id,
            inviteCode: householdRow.invite_code,
            createdAt: householdRow.created_at,
          }
        : null,
      timers: timers.rows,
      sleepActivities: sleepActivities.rows,
      measurement: measurements.rows[0] ?? null,
      dailyMilk: {
        date: sgtDate,
        totalMl: dailyMilkMl,
        breastmilkMl: dailyMilkTotals.breastmilkMl,
        formulaMl: dailyMilkTotals.formulaMl,
        pumpedMl: dailyMilkTotals.pumpedMl,
        expectedMl: expectedMilkMl,
      },
      pumpedMilk: {
        walletMl: bankState.availableMl,
        availableMl: bankState.availableMl,
        expiredAvailableMl: bankState.expiredAvailableMl,
        frozenMl: bankState.frozenMl,
        frozenPackets: bankState.frozenPackets,
        bankHistory: bankState.history,
        totalPumpedMl,
        breastmilkConsumedMl,
        lastPumpMl: latestPump ? pumpAmount(latestPump.details) : 0,
        lastPumpAt: latestPump?.startedAt ?? null,
        batches: pumpedMilkBatches,
      },
    });
  } catch (error) {
    console.error("Dashboard API error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
