import { NextRequest, NextResponse } from "next/server";
import { createDB } from "@/db";
import { generateId } from "@/lib/utils";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const householdId = request.cookies.get("mcphee_hh")?.value;

  if (!householdId) {
    return NextResponse.json({ timers: [] });
  }

  try {
    const db = createDB();

    const result = await db.execute({
      sql: `
        SELECT t.*, b.name as baby_name 
        FROM active_timers t 
        JOIN babies b ON t.baby_id = b.id 
        WHERE b.household_id = ?`,
      args: [householdId],
    });

    return NextResponse.json({ timers: result.rows });
  } catch (error) {
    console.error("Active timers API error:", error);
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
    const db = createDB();
    const timerId = generateId();

    // Delete any existing timer for this baby
    await db.execute({
      sql: "DELETE FROM active_timers WHERE baby_id = ?",
      args: [body.babyId],
    });

    await db.execute({
      sql: `INSERT INTO active_timers (id, baby_id, type, started_at, current_side, side_switches, started_by) 
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: [
        timerId,
        body.babyId,
        body.type,
        Date.now(),
        body.side || null,
        JSON.stringify([]),
        body.startedBy || null,
      ],
    });

    return NextResponse.json({ id: timerId });
  } catch (error) {
    console.error("Create timer error:", error);
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
    const db = createDB();

    await db.execute({
      sql: `UPDATE active_timers SET current_side = ? WHERE baby_id = ?`,
      args: [body.side, body.babyId],
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Update timer error:", error);
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
    const timerId = searchParams.get("id");
    const babyId = searchParams.get("babyId");
    const db = createDB();

    // Get timer info before deleting
    const timerResult = await db.execute({
      sql: "SELECT * FROM active_timers WHERE id = ?",
      args: [timerId],
    });

    if (timerResult.rows.length > 0) {
      const timer = timerResult.rows[0] as Record<string, unknown>;
      
      // Create activity from timer
      const activityId = generateId();
      await db.execute({
        sql: `INSERT INTO activities (id, baby_id, type, started_at, ended_at, details, created_at, created_by) 
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          activityId,
          babyId,
          String(timer.type),
          Number(timer.started_at),
          Date.now(),
          JSON.stringify({ side: timer.current_side, sideSwitches: timer.side_switches }),
          Date.now(),
          timer.started_by ? String(timer.started_by) : null,
        ],
      });
    }

    // Delete the timer
    await db.execute({
      sql: "DELETE FROM active_timers WHERE id = ?",
      args: [timerId],
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Delete timer error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
