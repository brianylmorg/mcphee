import { NextRequest, NextResponse } from "next/server";
import { createDB } from "@/db";
import { requireBabyInHousehold, userNameForHousehold } from "@/lib/db/household";
import { generateId } from "@/lib/utils";

export const runtime = "nodejs";

const VALID_TYPES = new Set(["bottlefeed", "breastfeed", "pump", "diaper", "vomit", "sleep"]);

function isValidTimestamp(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function validateActivityInput(body: Record<string, unknown>) {
  if (typeof body.babyId !== "string" || !body.babyId) return "babyId is required";
  if (typeof body.type !== "string" || !VALID_TYPES.has(body.type)) return "Invalid activity type";
  if (!isValidTimestamp(body.startedAt)) return "startedAt must be a timestamp";
  if (body.endedAt != null && !isValidTimestamp(body.endedAt)) return "endedAt must be a timestamp";
  if (body.endedAt != null && Number(body.endedAt) < Number(body.startedAt)) {
    return "endedAt must be after startedAt";
  }
  if (body.details != null && (typeof body.details !== "object" || Array.isArray(body.details))) {
    return "details must be an object";
  }
  return null;
}

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
      SELECT a.*, b.name as baby_name
      FROM activities a
      JOIN babies b ON a.baby_id = b.id
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
    const inputError = validateActivityInput(body);
    if (inputError) return NextResponse.json({ error: inputError }, { status: 400 });

    const db = createDB();
    const babyError = await requireBabyInHousehold(db, body.babyId, householdId);
    if (babyError) return babyError;

    const activityId = generateId();
    const createdBy = await userNameForHousehold(db, body.userId, householdId);

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
    if (typeof body.id !== "string" || !body.id) {
      return NextResponse.json({ error: "Activity ID required" }, { status: 400 });
    }

    const inputError = validateActivityInput(body);
    if (inputError) return NextResponse.json({ error: inputError }, { status: 400 });

    const db = createDB();

    // Fetch existing activity to merge details and verify household ownership.
    const existing = await db.execute({
      sql: "SELECT details FROM activities WHERE id = ? AND baby_id IN (SELECT id FROM babies WHERE household_id = ?)",
      args: [body.id, householdId],
    });

    if (existing.rows.length === 0) {
      return NextResponse.json({ error: "Activity not found" }, { status: 404 });
    }

    const babyError = await requireBabyInHousehold(db, body.babyId, householdId);
    if (babyError) return babyError;

    let mergedDetails = {};
    const existingDetails = (existing.rows[0] as unknown as { details: string | null }).details;
    if (existingDetails) {
      try {
        mergedDetails = JSON.parse(existingDetails);
      } catch {}
    }

    // Merge new details on top of existing
    mergedDetails = { ...mergedDetails, ...body.details };

    await db.execute({
      sql: `UPDATE activities SET 
            type = ?,
            started_at = ?,
            ended_at = ?,
            details = ?
            WHERE id = ? AND baby_id IN (SELECT id FROM babies WHERE household_id = ?)`,
      args: [
        body.type,
        body.startedAt,
        body.endedAt ?? null,
        JSON.stringify(mergedDetails),
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
    if (!activityId) {
      return NextResponse.json({ error: "Activity ID required" }, { status: 400 });
    }

    const db = createDB();

    const result = await db.execute({
      sql: `DELETE FROM activities WHERE id = ? AND baby_id IN (SELECT id FROM babies WHERE household_id = ?)`,
      args: [activityId, householdId],
    });

    if (result.rowsAffected === 0) {
      return NextResponse.json({ error: "Activity not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Delete activity error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
