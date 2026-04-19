import { NextRequest, NextResponse } from "next/server";
import { createDB } from "@/db";
import { generateId } from "@/lib/utils";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const householdId = request.cookies.get("mcphee_hh")?.value;

  if (!householdId) {
    return NextResponse.json({ babies: [] });
  }

  try {
    const db = createDB();

    const result = await db.execute({
      sql: "SELECT * FROM babies WHERE household_id = ?",
      args: [householdId],
    });

    const babies = result.rows;
    return NextResponse.json({ babies });
  } catch (error) {
    console.error("Babies API error:", error);
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
    const babyId = generateId();

    await db.execute({
      sql: "INSERT INTO babies (id, household_id, name, birth_date, created_at) VALUES (?, ?, ?, ?, ?)",
      args: [babyId, householdId, body.name, body.birthDate || null, Date.now()],
    });

    return NextResponse.json({ id: babyId, name: body.name, birthDate: body.birthDate });
  } catch (error) {
    console.error("Create baby error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
