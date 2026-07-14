import { NextRequest, NextResponse } from "next/server";
import { createDB } from "@/db";
import { requireBabyInHousehold } from "@/lib/db/household";
import { generateId } from "@/lib/utils";

export const runtime = "nodejs";

const VALID_SIDES = new Set(["L", "R"]);

function isValidSide(side: unknown): side is string {
  return typeof side === "string" && VALID_SIDES.has(side);
}

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
    if (typeof body.babyId !== "string" || !body.babyId) {
      return NextResponse.json({ error: "babyId is required" }, { status: 400 });
    }
    if (body.type !== "breastfeed") {
      return NextResponse.json({ error: "Invalid timer type" }, { status: 400 });
    }

    const side = body.side == null ? "L" : body.side;
    if (!isValidSide(side)) {
      return NextResponse.json({ error: "Invalid side" }, { status: 400 });
    }

    const db = createDB();
    const babyError = await requireBabyInHousehold(db, body.babyId, householdId);
    if (babyError) return babyError;

    const timerId = generateId();
    const now = Date.now();
    const startedBy = typeof body.startedBy === "string" ? body.startedBy : null;

    await db.batch([
      {
        sql: `DELETE FROM active_timers
              WHERE baby_id = ? AND baby_id IN (SELECT id FROM babies WHERE household_id = ?)`,
        args: [body.babyId, householdId],
      },
      {
        sql: `INSERT INTO active_timers (id, baby_id, type, started_at, current_side, side_switches, started_by)
              VALUES (?, ?, ?, ?, ?, ?, ?)`,
        args: [timerId, body.babyId, body.type, now, side, JSON.stringify([]), startedBy],
      },
    ], "write");

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
    if (typeof body.babyId !== "string" || !body.babyId) {
      return NextResponse.json({ error: "babyId is required" }, { status: 400 });
    }
    if (!isValidSide(body.side)) {
      return NextResponse.json({ error: "Invalid side" }, { status: 400 });
    }

    const db = createDB();
    const babyError = await requireBabyInHousehold(db, body.babyId, householdId);
    if (babyError) return babyError;

    // Get current timer to read existing side_switches
    const timerResult = await db.execute({
      sql: `SELECT t.side_switches FROM active_timers t
            JOIN babies b ON b.id = t.baby_id
            WHERE t.baby_id = ? AND b.household_id = ?`,
      args: [body.babyId, householdId],
    });

    if (timerResult.rows.length === 0) {
      return NextResponse.json({ error: "Timer not found" }, { status: 404 });
    }

    let sideSwitches: string[] = [];
    if (timerResult.rows.length > 0) {
      const existing = timerResult.rows[0].side_switches;
      if (existing) {
        try {
          sideSwitches = JSON.parse(existing as string);
        } catch {}
      }
    }

    // Append new side switch
    sideSwitches.push(body.side);

    await db.execute({
      sql: `UPDATE active_timers SET current_side = ?, side_switches = ?
            WHERE baby_id = ? AND baby_id IN (SELECT id FROM babies WHERE household_id = ?)`,
      args: [body.side, JSON.stringify(sideSwitches), body.babyId, householdId],
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
    if (!timerId || !babyId) {
      return NextResponse.json({ error: "Timer ID and baby ID required" }, { status: 400 });
    }

    const db = createDB();
    const babyError = await requireBabyInHousehold(db, babyId, householdId);
    if (babyError) return babyError;

    const tx = await db.transaction("write");
    try {
      const timerResult = await tx.execute({
        sql: `SELECT t.* FROM active_timers t
              JOIN babies b ON b.id = t.baby_id
              WHERE t.id = ? AND t.baby_id = ? AND b.household_id = ?`,
        args: [timerId, babyId, householdId],
      });

      if (timerResult.rows.length === 0) {
        await tx.rollback();
        return NextResponse.json({ error: "Timer not found" }, { status: 404 });
      }

      const timer = timerResult.rows[0] as Record<string, unknown>;
      let createdBy: string | null = null;
      if (timer.started_by) {
        const userResult = await tx.execute({
          sql: "SELECT name FROM users WHERE id = ? AND household_id = ? LIMIT 1",
          args: [String(timer.started_by), householdId],
        });
        if (userResult.rows.length > 0) {
          createdBy = String((userResult.rows[0] as unknown as { name: string }).name);
        }
      }

      const now = Date.now();
      await tx.execute({
        sql: `INSERT INTO activities (id, baby_id, type, started_at, ended_at, details, created_at, created_by)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          generateId(),
          babyId,
          String(timer.type),
          Number(timer.started_at),
          now,
          JSON.stringify({ side: timer.current_side, sideSwitches: timer.side_switches }),
          now,
          createdBy,
        ],
      });

      await tx.execute({
        sql: `DELETE FROM active_timers
              WHERE id = ? AND baby_id = ? AND baby_id IN (SELECT id FROM babies WHERE household_id = ?)`,
        args: [timerId, babyId, householdId],
      });

      await tx.commit();
    } finally {
      tx.close();
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Delete timer error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
