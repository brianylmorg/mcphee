import { NextRequest, NextResponse } from "next/server";

import { createDB } from "@/db";
import { isChildcareModeSchemaReady } from "@/db/childcare-mode-schema";
import type { ChildcareModeCommandResponse } from "@/lib/childcare-mode-contract";
import { loadChildcareModeState, serializeChildcareSession } from "@/lib/childcare-mode-server";
import { requireCaretakerMember, requireSameOrigin } from "@/lib/caretaker-import-server";
import { babyBelongsToHousehold } from "@/lib/db/household";
import { generateId } from "@/lib/utils";
import { sgtDateKey } from "@/lib/milk-volumes";

export const runtime = "nodejs";

const REQUEST_ID = /^[A-Za-z0-9._:-]{8,128}$/;

function validAt(value: unknown, now: number): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value <= now + 2 * 60 * 1000;
}

async function commandResponse(
  db: ReturnType<typeof createDB>,
  householdId: string,
  babyId: string,
  row: Record<string, unknown>,
  idempotent: boolean,
): Promise<NextResponse<ChildcareModeCommandResponse>> {
  return NextResponse.json({
    ...await loadChildcareModeState(db, householdId, babyId),
    session: serializeChildcareSession(row as never),
    idempotent,
  }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
}

export async function GET(request: NextRequest) {
  const db = createDB();
  const member = await requireCaretakerMember(request, db);
  if (member instanceof NextResponse) return member;
  const babyId = new URL(request.url).searchParams.get("babyId") ?? "";
  if (!babyId || !await babyBelongsToHousehold(db, babyId, member.householdId)) {
    return NextResponse.json({ error: "Baby not found" }, { status: 404 });
  }
  return NextResponse.json(await loadChildcareModeState(db, member.householdId, babyId), {
    headers: { "Cache-Control": "private, no-store, max-age=0" },
  });
}

export async function POST(request: NextRequest) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const db = createDB();
  const member = await requireCaretakerMember(request, db);
  if (member instanceof NextResponse) return member;
  if (!await isChildcareModeSchemaReady(db)) {
    return NextResponse.json({ error: "Childcare mode database migration is required", code: "SCHEMA_NOT_READY" }, { status: 503 });
  }

  let body: Record<string, unknown>;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const expectedSessionId = typeof body.sessionId === "string" ? body.sessionId.trim() : "";
  const babyId = typeof body.babyId === "string" ? body.babyId.trim() : "";
  const requestId = typeof body.requestId === "string" ? body.requestId : "";
  const action = body.action;
  const now = Date.now();
  const atProvided = body.at != null;
  const at = atProvided ? body.at : now;
  if (!babyId || !REQUEST_ID.test(requestId) || (action !== "checkIn" && action !== "checkOut") || !validAt(at, now)) {
    return NextResponse.json({ error: "action, babyId, requestId, and a valid time are required" }, { status: 400 });
  }
  if (action === "checkOut" && !expectedSessionId) {
    return NextResponse.json({ error: "The childcare session is required. Refresh and try again." }, { status: 400 });
  }
  if (!await babyBelongsToHousehold(db, babyId, member.householdId)) {
    return NextResponse.json({ error: "Baby not found" }, { status: 404 });
  }

  const requestColumn = action === "checkIn" ? "check_in_request_id" : "check_out_request_id";
  const prior = await db.execute({
    sql: `SELECT * FROM childcare_sessions WHERE baby_id = ? AND ${requestColumn} = ? LIMIT 1`,
    args: [babyId, requestId],
  });
  if (prior.rows[0]) {
    const priorAt = action === "checkIn" ? Number(prior.rows[0].checked_in_at) : Number(prior.rows[0].checked_out_at);
    if ((atProvided && priorAt !== at) || (action === "checkOut" && String(prior.rows[0].id) !== expectedSessionId)) {
      return NextResponse.json({ error: "requestId was already used for a different childcare command", code: "REQUEST_ID_CONFLICT" }, { status: 409 });
    }
    return commandResponse(db, member.householdId, babyId, prior.rows[0] as Record<string, unknown>, true);
  }

  if (action === "checkIn") {
    const id = generateId();
    try {
      const inserted = await db.execute({
        sql: `INSERT INTO childcare_sessions
              (id, baby_id, checked_in_at, checked_out_at, checked_in_by, checked_out_by,
               check_in_request_id, check_out_request_id, pending_import, import_batch_id,
               import_completed_at, created_at, updated_at)
              SELECT ?, ?, ?, NULL, ?, NULL, ?, NULL, 0, NULL, NULL, ?, ?
              WHERE NOT EXISTS (
                SELECT 1 FROM childcare_sessions
                WHERE baby_id = ? AND COALESCE(checked_out_at, 9223372036854775807) > ?
              )`,
        args: [id, babyId, at, member.name, requestId, now, now, babyId, at],
      });
      if (inserted.rowsAffected !== 1) {
        const replay = await db.execute({
          sql: "SELECT * FROM childcare_sessions WHERE baby_id = ? AND check_in_request_id = ? LIMIT 1",
          args: [babyId, requestId],
        });
        if (replay.rows[0]) {
          if (atProvided && Number(replay.rows[0].checked_in_at) !== at) {
            return NextResponse.json({ error: "requestId was already used for a different childcare command", code: "REQUEST_ID_CONFLICT" }, { status: 409 });
          }
          return commandResponse(db, member.householdId, babyId, replay.rows[0] as Record<string, unknown>, true);
        }
        return NextResponse.json({ error: "That check-in time overlaps an existing childcare session", code: "SESSION_OVERLAP" }, { status: 409 });
      }
    } catch (error) {
      if (!(error instanceof Error) || !/UNIQUE|constraint/i.test(error.message)) throw error;
      const raced = await db.execute({
        sql: "SELECT * FROM childcare_sessions WHERE baby_id = ? AND check_in_request_id = ? LIMIT 1",
        args: [babyId, requestId],
      });
      if (raced.rows[0]) {
        const racedAt = Number(raced.rows[0].checked_in_at);
        if (atProvided && racedAt !== at) {
          return NextResponse.json({ error: "requestId was already used for a different childcare command", code: "REQUEST_ID_CONFLICT" }, { status: 409 });
        }
        return commandResponse(db, member.householdId, babyId, raced.rows[0] as Record<string, unknown>, true);
      }
      return NextResponse.json({ error: "This child is already checked in to childcare", code: "ALREADY_CHECKED_IN" }, { status: 409 });
    }
    return commandResponse(db, member.householdId, babyId, {
      id, baby_id: babyId, checked_in_at: at, checked_out_at: null,
      pending_import: 0, import_batch_id: null, import_completed_at: null,
    }, false);
  }

  const active = await db.execute({
    sql: "SELECT * FROM childcare_sessions WHERE baby_id = ? AND checked_out_at IS NULL LIMIT 1",
    args: [babyId],
  });
  if (!active.rows[0]) {
    return NextResponse.json({ error: "This child is not checked in to childcare", code: "NOT_CHECKED_IN" }, { status: 409 });
  }
  if (String(active.rows[0].id) !== expectedSessionId) {
    return NextResponse.json({ error: "Childcare state changed on another device. Refresh and try again.", code: "CHILDCARE_STATE_CHANGED" }, { status: 409 });
  }
  if (sgtDateKey(at) !== sgtDateKey(Number(active.rows[0].checked_in_at))) {
    return NextResponse.json({ error: "Record the actual check-out time on the check-in date using Record a different time.", code: "CHILDCARE_DATE_MISMATCH" }, { status: 400 });
  }
  if (at <= Number(active.rows[0].checked_in_at)) {
    return NextResponse.json({ error: "Check-out time must be after check-in time" }, { status: 400 });
  }
  try {
    const updated = await db.execute({
      sql: `UPDATE childcare_sessions
            SET checked_out_at = ?, checked_out_by = ?, check_out_request_id = ?,
                pending_import = 1, updated_at = ?
            WHERE id = ? AND checked_out_at IS NULL AND checked_in_at < ?`,
      args: [at, member.name, requestId, now, active.rows[0].id, at],
    });
    if (updated.rowsAffected !== 1) {
      const replay = await db.execute({
        sql: "SELECT * FROM childcare_sessions WHERE baby_id = ? AND check_out_request_id = ? LIMIT 1",
        args: [babyId, requestId],
      });
      if (replay.rows[0]) {
        if (String(replay.rows[0].id) !== expectedSessionId || (atProvided && Number(replay.rows[0].checked_out_at) !== at)) {
          return NextResponse.json({ error: "requestId was already used for a different childcare command", code: "REQUEST_ID_CONFLICT" }, { status: 409 });
        }
        return commandResponse(db, member.householdId, babyId, replay.rows[0] as Record<string, unknown>, true);
      }
      return NextResponse.json({ error: "Childcare state changed on another device", code: "CHILDCARE_STATE_CHANGED" }, { status: 409 });
    }
  } catch (error) {
    if (!(error instanceof Error) || !/UNIQUE|constraint/i.test(error.message)) throw error;
    const raced = await db.execute({
      sql: "SELECT * FROM childcare_sessions WHERE baby_id = ? AND check_out_request_id = ? LIMIT 1",
      args: [babyId, requestId],
    });
    if (raced.rows[0]) {
      if (String(raced.rows[0].id) !== expectedSessionId || (atProvided && Number(raced.rows[0].checked_out_at) !== at)) {
        return NextResponse.json({ error: "requestId was already used for a different childcare command", code: "REQUEST_ID_CONFLICT" }, { status: 409 });
      }
      return commandResponse(db, member.householdId, babyId, raced.rows[0] as Record<string, unknown>, true);
    }
    return NextResponse.json({ error: "Childcare state changed on another device", code: "CHILDCARE_STATE_CHANGED" }, { status: 409 });
  }
  return commandResponse(db, member.householdId, babyId, {
    ...active.rows[0], checked_out_at: at, pending_import: 1,
  } as Record<string, unknown>, false);
}
