import { NextRequest, NextResponse } from "next/server";
import { createDB } from "@/db";
import { requireBabyInHousehold, userNameForHousehold } from "@/lib/db/household";
import { generateId } from "@/lib/utils";
import { canUndoBlip, isBlipSettledBy, isSleepBlipUndoToken } from "@/lib/sleep-blips";

export const runtime = "nodejs";

/**
 * Sleep blips (crying in his sleep without fully waking).
 * POST { babyId, action: "start" }                      → blip starts now, inside the open sleep
 * POST { babyId, action: "stop", settledBy: self|us }   → ends the open blip now
 * POST { babyId, action: "undo", undoToken }            → reverses the last start or stop (30 s)
 * No childcare guard: a blip lives inside an open sleep, which already passed it.
 */
export async function POST(request: NextRequest) {
  const householdId = request.cookies.get("mcphee_hh")?.value;
  if (!householdId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const body = await request.json();
    if (typeof body.babyId !== "string" || !body.babyId) {
      return NextResponse.json({ error: "babyId is required" }, { status: 400 });
    }
    if (body.action !== "start" && body.action !== "stop" && body.action !== "undo") {
      return NextResponse.json({ error: "Invalid blip action" }, { status: 400 });
    }
    if (body.action === "stop" && !isBlipSettledBy(body.settledBy)) {
      return NextResponse.json({ error: "settledBy must be self or us" }, { status: 400 });
    }
    if (body.action === "undo" && !isSleepBlipUndoToken(body.undoToken)) {
      return NextResponse.json({ error: "A valid undo token is required" }, { status: 400 });
    }

    const db = createDB();
    const [babyError, createdBy] = await Promise.all([
      requireBabyInHousehold(db, body.babyId, householdId),
      userNameForHousehold(db, request.cookies.get("mcphee_user")?.value, householdId),
    ]);
    if (babyError) return babyError;

    const now = Date.now();
    const tx = await db.transaction("write");
    try {
      if (body.action === "undo") {
        const token = body.undoToken;
        const found = await tx.execute({
          sql: "SELECT started_at, ended_at FROM activities WHERE id = ? AND baby_id = ? AND type = 'sleepblip'",
          args: [token.activityId, body.babyId],
        });
        const raw = found.rows[0];
        const row = raw ? { startedAt: Number(raw.started_at), endedAt: raw.ended_at == null ? null : Number(raw.ended_at) } : null;
        if (!canUndoBlip(token, row, now)) {
          await tx.rollback();
          return NextResponse.json({ error: "The blip changed elsewhere. Refreshed to the latest state.", code: "STALE_UNDO" }, { status: 409 });
        }
        if (token.kind === "started-blip") {
          await tx.execute({
            sql: "DELETE FROM activities WHERE id = ? AND baby_id = ? AND type = 'sleepblip' AND ended_at IS NULL",
            args: [token.activityId, body.babyId],
          });
        } else {
          // A newer blip opened since would make two open blips: refuse instead.
          const otherOpen = await tx.execute({
            sql: "SELECT id FROM activities WHERE baby_id = ? AND type = 'sleepblip' AND ended_at IS NULL LIMIT 1",
            args: [body.babyId],
          });
          if (otherOpen.rows.length > 0) {
            await tx.rollback();
            return NextResponse.json({ error: "Another blip has started since. Refreshed to the latest state.", code: "STALE_UNDO" }, { status: 409 });
          }
          await tx.execute({
            sql: `UPDATE activities SET ended_at = NULL, details = json_remove(COALESCE(details, '{}'), '$.ending')
                  WHERE id = ? AND baby_id = ? AND type = 'sleepblip' AND ended_at = ?`,
            args: [token.activityId, body.babyId, token.changedAt],
          });
        }
        await tx.commit();
        return NextResponse.json({ success: true, blipOpen: token.kind === "ended-blip" });
      }

      const openSleep = await tx.execute({
        sql: `SELECT id, started_at FROM activities
              WHERE baby_id = ? AND type = 'sleep' AND ended_at IS NULL
              ORDER BY started_at DESC LIMIT 1`,
        args: [body.babyId],
      });
      const openBlip = await tx.execute({
        sql: `SELECT id, started_at FROM activities
              WHERE baby_id = ? AND type = 'sleepblip' AND ended_at IS NULL
              ORDER BY started_at DESC LIMIT 1`,
        args: [body.babyId],
      });

      if (body.action === "start") {
        if (openSleep.rows.length === 0) {
          await tx.rollback();
          return NextResponse.json({ error: "Blips can only start while he is asleep", code: "NOT_SLEEPING" }, { status: 409 });
        }
        if (openBlip.rows.length > 0) {
          await tx.rollback();
          return NextResponse.json({ error: "A blip is already going", code: "BLIP_OPEN" }, { status: 409 });
        }
        const startedAt = Math.max(now, Number(openSleep.rows[0].started_at));
        const id = generateId();
        await tx.execute({
          sql: `INSERT INTO activities (id, baby_id, type, started_at, ended_at, details, created_at, created_by)
                VALUES (?, ?, 'sleepblip', ?, NULL, '{}', ?, ?)`,
          args: [id, body.babyId, startedAt, now, createdBy],
        });
        await tx.commit();
        return NextResponse.json({
          id,
          startedAt,
          undoToken: { kind: "started-blip", activityId: id, changedAt: startedAt, issuedAt: now },
        });
      }

      if (openBlip.rows.length === 0) {
        await tx.rollback();
        return NextResponse.json({ error: "No blip is going", code: "NO_OPEN_BLIP" }, { status: 409 });
      }
      const blip = openBlip.rows[0];
      const endedAt = Math.max(now, Number(blip.started_at));
      await tx.execute({
        sql: `UPDATE activities SET ended_at = ?, details = json_set(COALESCE(details, '{}'), '$.ending', ?)
              WHERE id = ? AND ended_at IS NULL`,
        args: [endedAt, body.settledBy, String(blip.id)],
      });
      await tx.commit();
      return NextResponse.json({
        id: String(blip.id),
        endedAt,
        undoToken: { kind: "ended-blip", activityId: String(blip.id), changedAt: endedAt, issuedAt: now },
      });
    } catch (error) {
      try { await tx.rollback(); } catch {}
      throw error;
    } finally {
      tx.close();
    }
  } catch (error) {
    console.error("Sleep blip error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
