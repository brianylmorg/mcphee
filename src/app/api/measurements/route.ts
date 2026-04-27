import { NextRequest, NextResponse } from "next/server";
import { createDB } from "@/db";
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

    sql += " ORDER BY m.measured_at DESC LIMIT 1";

    const result = await db.execute({ sql, args });
    return NextResponse.json({
      measurement: result.rows.length > 0 ? result.rows[0] : null,
    });
  } catch (error) {
    console.error("Measurements API error:", error);
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
    const id = generateId();

    await db.execute({
      sql: `INSERT INTO measurements (id, baby_id, measured_at, weight_g, created_at)
            VALUES (?, ?, ?, ?, ?)`,
      args: [id, body.babyId, body.measuredAt || Date.now(), body.weightG, Date.now()],
    });

    return NextResponse.json({ id });
  } catch (error) {
    console.error("Create measurement error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
