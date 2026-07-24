import { NextRequest, NextResponse } from "next/server";
import { createDB } from "@/db";
import { bottleBreastmilkLibraryDeduction, bankAdjustmentMl } from "@/lib/milk-calculation";
import { normalizeActivityCreators } from "@/lib/activity-creators";
import { bottleVolumes, parseActivityDetails, pumpAmount } from "@/lib/milk-volumes";

const BREASTMILK_BATCH_TTL_MS = 4 * 60 * 60 * 1000;
// The bank is a lifetime tally: pumped minus fed over full history, replayed as
// FIFO batches so the batch list always sums to the bank total. The TTL only
// drives the per-batch expiry badge — it does not remove milk from the bank.

const sgtDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Singapore",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

type PumpedMilkBatch = {
  id: string;
  pumpedAt: number;
  amountMl: number;
  remainingMl: number;
  expiresAt: number;
  isExpired: boolean;
  isAdjustment?: boolean;
};

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

    const [babies, activities, household, timers, measurements, dailyMilk, pumpedLedger, users] = await db.batch([
      {
        sql: "SELECT * FROM babies WHERE household_id = ?",
        args: [householdId],
      },
      {
        sql: `SELECT a.*, b.name as baby_name
              FROM activities a
              JOIN babies b ON a.baby_id = b.id
              WHERE b.household_id = ?
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
                AND a.type IN (?, ?, ?)
              ORDER BY a.started_at ASC, a.created_at ASC`,
        args: [householdId, "bottlefeed", "pump", "bankadjust"],
      },
      {
        sql: "SELECT name FROM users WHERE household_id = ?",
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

    const pumpedTotals = pumpedLedger.rows.reduce((total, row) => {
      const typedRow = row as unknown as { id: string; type: string; details: string | null; started_at?: number; created_at?: number };
      const details = parseActivityDetails(typedRow.details);
      if (typedRow.type === "pump") {
        const amount = pumpAmount(details);
        const pumpedAt = Number(typedRow.started_at) || Number(typedRow.created_at) || 0;
        total.pumpedMl += amount;
        if (amount > 0 && pumpedAt > 0) {
          total.batches.push({
            id: typedRow.id,
            pumpedAt,
            amountMl: amount,
            remainingMl: amount,
            expiresAt: pumpedAt + BREASTMILK_BATCH_TTL_MS,
            isExpired: pumpedAt + BREASTMILK_BATCH_TTL_MS <= now.getTime(),
          });
          total.lastPumpMl = amount;
          total.lastPumpAt = pumpedAt;
        }
        return total;
      }

      let remainingDeductionMl: number;
      if (typedRow.type === "bankadjust") {
        const deltaMl = bankAdjustmentMl(details);
        if (deltaMl > 0) {
          const adjustedAt = Number(typedRow.started_at) || Number(typedRow.created_at) || 0;
          if (adjustedAt > 0) {
            // Virtual batch from a reconciliation top-up; feeds drain it FIFO
            // like real milk, but it never gets an expiry badge.
            total.batches.push({
              id: typedRow.id,
              pumpedAt: adjustedAt,
              amountMl: deltaMl,
              remainingMl: deltaMl,
              expiresAt: adjustedAt + BREASTMILK_BATCH_TTL_MS,
              isExpired: false,
              isAdjustment: true,
            });
          }
          return total;
        }
        // Negative correction: drain batches FIFO, but it is not consumption.
        remainingDeductionMl = -deltaMl;
        for (const batch of total.batches) {
          if (remainingDeductionMl <= 0) break;
          const deductedMl = Math.min(batch.remainingMl, remainingDeductionMl);
          batch.remainingMl -= deductedMl;
          remainingDeductionMl -= deductedMl;
        }
        return total;
      }

      remainingDeductionMl = bottleBreastmilkLibraryDeduction(details);
      for (const batch of total.batches) {
        if (remainingDeductionMl <= 0) break;
        const deductedMl = Math.min(batch.remainingMl, remainingDeductionMl);
        batch.remainingMl -= deductedMl;
        remainingDeductionMl -= deductedMl;
        total.breastmilkConsumedMl += deductedMl;
      }
      return total;
    }, { pumpedMl: 0, breastmilkConsumedMl: 0, lastPumpMl: 0, lastPumpAt: null as number | null, batches: [] as PumpedMilkBatch[] });
    const pumpedMilkBatches = pumpedTotals.batches.filter((batch) => batch.remainingMl > 0);
    const pumpedWalletMl = pumpedMilkBatches.reduce((total, batch) => total + batch.remainingMl, 0);
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
        walletMl: pumpedWalletMl,
        totalPumpedMl: pumpedTotals.pumpedMl,
        breastmilkConsumedMl: pumpedTotals.breastmilkConsumedMl,
        lastPumpMl: pumpedTotals.lastPumpMl,
        lastPumpAt: pumpedTotals.lastPumpAt,
        batches: pumpedMilkBatches,
      },
    });
  } catch (error) {
    console.error("Dashboard API error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
