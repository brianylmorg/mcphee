import { NextRequest, NextResponse } from "next/server";
import { createDB } from "@/db";

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

    const [babies, activities, household, timers, measurements, dailyMilk] = await db.batch([
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
              ORDER BY m.measured_at DESC LIMIT 1`,
        args: [householdId],
      },
      {
        sql: `SELECT a.details FROM activities a
              JOIN babies b ON a.baby_id = b.id
              WHERE b.household_id = ?
                AND a.type = ?
                AND a.started_at >= ?
                AND a.started_at < ?`,
        args: [householdId, "bottlefeed", dayStart, dayEnd],
      },
    ], "read");

    const householdRow = household.rows[0];
    const dailyMilkMl = dailyMilk.rows.reduce((total, row) => {
      try {
        const details = JSON.parse(String((row as unknown as { details: string | null }).details ?? "{}"));
        const amount = Number(details.amount);
        return Number.isFinite(amount) ? total + amount : total;
      } catch {
        return total;
      }
    }, 0);

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
        expectedMl: null,
      },
    });
  } catch (error) {
    console.error("Dashboard API error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
