import { NextRequest, NextResponse } from "next/server";
import { createDB } from "@/db";
import { bottleBreastmilkLibraryDeduction } from "@/lib/milk-calculation";

export const runtime = "nodejs";

type MilkVolumes = { breastmilkMl: number; formulaMl: number };

function parseDetails(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function numericMl(value: unknown): number {
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0 ? amount : 0;
}

function bottleVolumes(details: Record<string, unknown>): MilkVolumes {
  const feeds = details.feeds;
  if (Array.isArray(feeds)) {
    return feeds.reduce<MilkVolumes>((total, item) => {
      if (!item || typeof item !== "object") return total;
      const feed = item as Record<string, unknown>;
      const amount = numericMl(feed.amount);
      if (feed.milkType === "formula") total.formulaMl += amount;
      else if (feed.milkType === "breastmilk") total.breastmilkMl += amount;
      return total;
    }, { breastmilkMl: 0, formulaMl: 0 });
  }

  const amount = numericMl(details.amount);
  const breastmilkAmount = numericMl(details.breastmilkAmount);
  const formulaAmount = numericMl(details.formulaAmount);

  if (breastmilkAmount || formulaAmount) {
    return {
      breastmilkMl: breastmilkAmount || (details.milkType === "breastmilk" ? amount : 0),
      formulaMl: formulaAmount || (details.milkType === "formula" ? amount : 0),
    };
  }

  if (details.milkType === "formula") return { breastmilkMl: 0, formulaMl: amount };
  return { breastmilkMl: amount, formulaMl: 0 };
}

function pumpAmount(details: Record<string, unknown>): number {
  return numericMl(details.amount);
}

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
    const sgtParts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Singapore",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(now);
    const sgtPart = (type: string) => sgtParts.find((part) => part.type === type)?.value ?? "00";
    const sgtDate = [sgtPart("year"), sgtPart("month"), sgtPart("day")].join("-");
    const dayStart = Date.parse(sgtDate + "T00:00:00+08:00");
    const dayEnd = dayStart + 24 * 60 * 60 * 1000;

    const [babies, activities, household, timers, measurements, dailyMilk, pumpedLedger] = await db.batch([
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
        sql: `SELECT a.type, a.details, a.started_at, a.created_at FROM activities a
              JOIN babies b ON a.baby_id = b.id
              WHERE b.household_id = ?
                AND a.type IN (?, ?)
              ORDER BY a.started_at ASC, a.created_at ASC`,
        args: [householdId, "bottlefeed", "pump"],
      },
    ], "write");

    const householdRow = household.rows[0];
    const dailyMilkTotals = dailyMilk.rows.reduce((total, row) => {
      const typedRow = row as unknown as { type: string; details: string | null; started_at?: number };
      const details = parseDetails(typedRow.details);
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
      const typedRow = row as unknown as { type: string; details: string | null; started_at?: number };
      const details = parseDetails(typedRow.details);
      if (typedRow.type === "pump") {
        const amount = pumpAmount(details);
        total.walletMl += amount;
        total.pumpedMl += amount;
        if (amount > 0) {
          total.lastPumpMl = amount;
          total.lastPumpAt = Number(typedRow.started_at) || null;
        }
        return total;
      }

      const deductedMl = Math.min(total.walletMl, bottleBreastmilkLibraryDeduction(details));
      total.walletMl -= deductedMl;
      total.breastmilkConsumedMl += deductedMl;
      return total;
    }, { walletMl: 0, pumpedMl: 0, breastmilkConsumedMl: 0, lastPumpMl: 0, lastPumpAt: null as number | null });
    const pumpedWalletMl = Math.max(0, pumpedTotals.walletMl);
    const latestWeightG = Number((measurements.rows[0] as { weight_g?: unknown } | undefined)?.weight_g);
    const expectedMilkMl = Number.isFinite(latestWeightG)
      ? Math.round((latestWeightG / 1000) * 150)
      : null;

    return NextResponse.json({
      babies: babies.rows,
      activities: activities.rows,
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
      },
    });
  } catch (error) {
    console.error("Dashboard API error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
