import { NextRequest, NextResponse } from "next/server";
import { createDB } from "@/db";
import { generateId } from "@/lib/utils";

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
    const limit = searchParams.get("limit") || "50";

    let sql = `
      SELECT a.*, b.name as baby_name, u.name as user_name
      FROM activities a 
      JOIN babies b ON a.baby_id = b.id 
      LEFT JOIN users u ON a.created_by = u.name
      WHERE b.household_id = ?
    `;
    const args: string[] = [householdId];

    if (babyId) {
      sql += " AND a.baby_id = ?";
      args.push(babyId);
    }

    sql += " ORDER BY a.started_at DESC LIMIT ?";
    args.push(limit);

    const result = await db.execute({ sql, args });
    return NextResponse.json({ activities: result.rows });
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
    const db = createDB();
    const activityId = generateId();

    // Get userId from household's users table
    let createdBy: string | null = null;
    if (body.userId) {
      try {
        const userResult = await db.execute({
          sql: "SELECT name FROM users WHERE id = ? AND household_id = ?",
          args: [body.userId, householdId],
        });
        if (userResult.rows.length > 0) {
          createdBy = (userResult.rows[0] as unknown as { name: string }).name;
        }
      } catch (e) {
        // user lookup failed, skip createdBy
      }
    }

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
    const db = createDB();

    await db.execute({
      sql: `UPDATE activities SET 
            type = COALESCE(?, type),
            started_at = COALESCE(?, started_at),
            ended_at = ?,
            details = COALESCE(?, details)
            WHERE id = ? AND baby_id IN (SELECT id FROM babies WHERE household_id = ?)`,
      args: [
        body.type || null,
        body.startedAt || null,
        body.endedAt,
        body.details ? JSON.stringify(body.details) : null,
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
    const db = createDB();

    await db.execute({
      sql: `DELETE FROM activities WHERE id = ? AND baby_id IN (SELECT id FROM babies WHERE household_id = ?)`,
      args: [activityId, householdId],
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Delete activity error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
