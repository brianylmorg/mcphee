import { NextRequest, NextResponse } from "next/server";
import { createDB } from "@/db";
import { requireBabyInHousehold } from "@/lib/db/household";
import { generateId } from "@/lib/utils";

export const runtime = "nodejs";

function validTimestamp(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

export async function POST(request: NextRequest) {
  const householdId = request.cookies.get("mcphee_hh")?.value;
  if (!householdId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const body = await request.json();
    if (typeof body.babyId !== "string" || !body.babyId) {
      return NextResponse.json({ error: "babyId is required" }, { status: 400 });
    }
    if (body.action !== "sleep" && body.action !== "wake") {
      return NextResponse.json({ error: "Invalid sleep action" }, { status: 400 });
    }
    const changedAt = body.at == null ? Date.now() : body.at;
    if (!validTimestamp(changedAt) || changedAt > Date.now() + 2 * 60 * 1000) {
      return NextResponse.json({ error: "Invalid transition time" }, { status: 400 });
    }

    const db = createDB();
    const babyError = await requireBabyInHousehold(db, body.babyId, householdId);
    if (babyError) return babyError;
    const tx = await db.transaction("write");
    try {
      const open = await tx.execute({
        sql: `SELECT id, started_at FROM activities
              WHERE baby_id = ? AND type = 'sleep' AND ended_at IS NULL
              ORDER BY started_at DESC LIMIT 1`,
        args: [body.babyId],
      });

      if (body.action === "sleep") {
        if (open.rows.length > 0) {
          await tx.rollback();
          return NextResponse.json({ error: "Baby is already sleeping" }, { status: 409 });
        }
        const overlap = await tx.execute({
          sql: `SELECT id FROM activities
                WHERE baby_id = ? AND type = 'sleep'
                  AND started_at <= ? AND COALESCE(ended_at, 9223372036854775807) > ?
                LIMIT 1`,
          args: [body.babyId, changedAt, changedAt],
        });
        if (overlap.rows.length > 0) {
          await tx.rollback();
          return NextResponse.json({ error: "That time overlaps an existing sleep window" }, { status: 409 });
        }
        const id = generateId();
        const userId = request.cookies.get("mcphee_user")?.value;
        const user = userId ? await tx.execute({
          sql: "SELECT name FROM users WHERE id = ? AND household_id = ? LIMIT 1",
          args: [userId, householdId],
        }) : null;
        const createdBy = user?.rows[0]?.name ? String(user.rows[0].name) : null;
        await tx.execute({
          sql: `INSERT INTO activities (id, baby_id, type, started_at, ended_at, details, created_at, created_by)
                VALUES (?, ?, 'sleep', ?, NULL, '{}', ?, ?)`,
          args: [id, body.babyId, changedAt, Date.now(), createdBy],
        });
        await tx.commit();
        return NextResponse.json({ id, state: "sleeping", startedAt: changedAt });
      }

      if (open.rows.length === 0) {
        await tx.rollback();
        return NextResponse.json({ error: "Baby is already awake" }, { status: 409 });
      }
      const row = open.rows[0] as unknown as { id: string; started_at: number };
      if (changedAt < Number(row.started_at)) {
        await tx.rollback();
        return NextResponse.json({ error: "Wake time must be after sleep time" }, { status: 400 });
      }
      await tx.execute({
        sql: "UPDATE activities SET ended_at = ? WHERE id = ? AND ended_at IS NULL",
        args: [changedAt, row.id],
      });
      await tx.commit();
      return NextResponse.json({ id: row.id, state: "awake", startedAt: changedAt });
    } finally {
      tx.close();
    }
  } catch (error) {
    console.error("Sleep state error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
