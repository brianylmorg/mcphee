import { NextRequest, NextResponse } from "next/server";
import { createDB, syncDb } from "@/db";
import { requireBabyInHousehold } from "@/lib/db/household";
import { generateId } from "@/lib/utils";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const householdId = request.cookies.get("mcphee_hh")?.value;
  if (!householdId) {
    return NextResponse.json({ measurement: null });
  }

  try {
    const db = createDB();
    const { searchParams } = new URL(request.url);
    const babyId = searchParams.get("babyId");
    const history = searchParams.get("history") === "1";

    let sql = `
      SELECT m.* FROM measurements m
      JOIN babies b ON m.baby_id = b.id
      WHERE b.household_id = ? AND m.weight_g IS NOT NULL
    `;
    const args: string[] = [householdId];

    if (babyId) {
      sql += " AND m.baby_id = ?";
      args.push(babyId);
    }

    sql += history
      ? " ORDER BY m.measured_at ASC, m.created_at ASC"
      : " ORDER BY m.measured_at DESC, m.created_at DESC LIMIT 1";

    const result = await db.execute({ sql, args });
    return NextResponse.json(history
      ? { measurements: result.rows }
      : { measurement: result.rows.length > 0 ? result.rows[0] : null }
    );
  } catch (error) {
    console.error("Measurements API error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const householdId = request.cookies.get("mcphee_hh")?.value;
  if (!householdId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const measurementId = new URL(request.url).searchParams.get("id");
    if (!measurementId) {
      return NextResponse.json({ error: "Measurement id is required" }, { status: 400 });
    }

    const db = createDB();
    const result = await db.execute({
      sql: `DELETE FROM measurements
            WHERE id = ?
              AND baby_id IN (SELECT id FROM babies WHERE household_id = ?)`,
      args: [measurementId, householdId],
    });

    if (result.rowsAffected === 0) {
      return NextResponse.json({ error: "Measurement not found" }, { status: 404 });
    }
    await syncDb();

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Delete measurement error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
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
    const babyError = await requireBabyInHousehold(db, body.babyId, householdId);
    if (babyError) return babyError;

    const measuredAt = Number(body.measuredAt || Date.now());
    const weightG = Math.round(Number(body.weightG));
    if (!Number.isFinite(measuredAt) || !Number.isFinite(weightG) || weightG <= 0) {
      return NextResponse.json({ error: "Invalid measurement" }, { status: 400 });
    }

    const id = generateId();

    await db.execute({
      sql: `INSERT INTO measurements (id, baby_id, measured_at, weight_g, created_at)
            VALUES (?, ?, ?, ?, ?)`,
      args: [id, body.babyId, measuredAt, weightG, Date.now()],
    });
    await syncDb();

    return NextResponse.json({ id });
  } catch (error) {
    console.error("Create measurement error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
