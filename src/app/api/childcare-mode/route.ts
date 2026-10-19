import { NextRequest, NextResponse } from "next/server";

import { createDB } from "@/db";
import { isChildcareModeSchemaReady } from "@/db/childcare-mode-schema";
import type { ChildcareModeCommandResponse } from "@/lib/childcare-mode-contract";
import { loadChildcareModeState, serializeChildcareSession } from "@/lib/childcare-mode-server";
import { requireCaretakerMember, requireSameOrigin } from "@/lib/caretaker-import-server";
import { babyBelongsToHousehold } from "@/lib/db/household";
import { generateId } from "@/lib/utils";
import { sgtDateKey } from "@/lib/milk-volumes";
import { caretakerSleepCoverageFromAudit } from "@/lib/caretaker-sleep-audit";

export const runtime = "nodejs";

const REQUEST_ID = /^[A-Za-z0-9._:-]{8,128}$/;

function validAt(value: unknown, now: number): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value <= now + 2 * 60 * 1000;
}

function importedActivityIds(audit: unknown): string[] | null {
  if (typeof audit !== "string" || audit.trim() === "") return null;
  try {
    const parsed = JSON.parse(audit) as { version?: unknown; rows?: unknown };
    if (parsed.version !== 2 || !Array.isArray(parsed.rows)) return null;
    return [...new Set(parsed.rows.flatMap((row) => {
      if (!row || typeof row !== "object" || Array.isArray(row)) return [];
      const id = (row as Record<string, unknown>).importedActivityId;
      return typeof id === "string" && id.trim() ? [id.trim()] : [];
    }))];
  } catch {
    return null;
  }
}

async function cancelLinkedDrafts(
  tx: { execute: (...args: any[]) => Promise<any> },
  householdId: string,
  sessionId: string,
  now: number,
) {
  const linked = await tx.execute({
    sql: `SELECT id FROM paper_log_import_batches
          WHERE household_id = ? AND childcare_session_id = ?
            AND source_kind = 'caretaker_screenshot' AND status = 'staged'`,
    args: [householdId, sessionId],
  });
  for (const row of linked.rows) {
    const batchId = String(row.id);
    await tx.execute({ sql: "DELETE FROM paper_log_import_rows WHERE batch_id = ?", args: [batchId] });
    await tx.execute({
      sql: `UPDATE paper_log_import_batches
            SET status = 'cancelled', source_image = NULL, source_mime = NULL,
                source_note = NULL, draft_metadata = NULL, purged_at = ?, revision = revision + 1
            WHERE id = ? AND household_id = ? AND status = 'staged'`,
      args: [now, batchId, householdId],
    });
  }
}

async function invalidateLinkedDraftSleepReview(
  tx: { execute: (...args: any[]) => Promise<any> },
  householdId: string,
  sessionId: string,
) {
  const linked = await tx.execute({
    sql: `SELECT id, draft_metadata FROM paper_log_import_batches
          WHERE household_id = ? AND childcare_session_id = ?
            AND source_kind = 'caretaker_screenshot' AND status = 'staged'`,
    args: [householdId, sessionId],
  });
  for (const row of linked.rows) {
    let metadata: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(String(row.draft_metadata ?? "{}"));
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) metadata = parsed;
    } catch {}
    await tx.execute({
      sql: `UPDATE paper_log_import_batches
            SET draft_metadata = ?, revision = revision + 1
            WHERE id = ? AND household_id = ? AND status = 'staged'`,
      args: [JSON.stringify({ ...metadata, sleepReconciliation: null }), String(row.id), householdId],
    });
  }
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
  const historicalAction = action === "editSession" || action === "dismissImport" || action === "removeSession";
  const atProvided = body.at != null;
  const rawAt = atProvided ? body.at : now;
  const expectedCheckedInAt = body.expectedCheckedInAt;
  if (!babyId || !REQUEST_ID.test(requestId)
      || (action !== "checkIn" && action !== "checkOut" && action !== "editCheckIn" && !historicalAction)
      || (!historicalAction && !validAt(rawAt, now))) {
    return NextResponse.json({ error: "action, babyId, requestId, and a valid time are required" }, { status: 400 });
  }
  // Validated above for every action that uses it; historical actions ignore it.
  const at = Number(rawAt);
  if ((action === "checkOut" || action === "editCheckIn" || historicalAction) && !expectedSessionId) {
    return NextResponse.json({ error: "The childcare session is required. Refresh and try again." }, { status: 400 });
  }
  if (action === "editCheckIn" && (!atProvided || !validAt(expectedCheckedInAt, now))) {
    return NextResponse.json({ error: "The new and expected check-in times are required. Refresh and try again." }, { status: 400 });
  }
  if (!await babyBelongsToHousehold(db, babyId, member.householdId)) {
    return NextResponse.json({ error: "Baby not found" }, { status: 404 });
  }

  if (historicalAction) {
    const expectedCheckedOutAt = body.expectedCheckedOutAt;
    if (!validAt(expectedCheckedInAt, now) || !validAt(expectedCheckedOutAt, now)
        || Number(expectedCheckedOutAt) <= Number(expectedCheckedInAt)) {
      return NextResponse.json({ error: "The expected closed childcare times are required. Refresh and try again." }, { status: 400 });
    }
    const proposedCheckedInAt = action === "editSession" ? body.checkedInAt : expectedCheckedInAt;
    const proposedCheckedOutAt = action === "editSession" ? body.checkedOutAt : expectedCheckedOutAt;
    if (action === "editSession" && (!validAt(proposedCheckedInAt, now) || !validAt(proposedCheckedOutAt, now)
        || Number(proposedCheckedOutAt) <= Number(proposedCheckedInAt)
        || sgtDateKey(Number(proposedCheckedInAt)) !== sgtDateKey(Number(proposedCheckedOutAt)))) {
      return NextResponse.json({
        error: "Enter care start and end times on the same Singapore date, with care end after care start.",
        code: "INVALID_SESSION_BOUNDS",
      }, { status: 400 });
    }

    const tx = await db.transaction("write");
    try {
      if (action === "removeSession") {
        const replay = await tx.execute({
          sql: `SELECT * FROM childcare_sessions
                WHERE baby_id = ? AND remove_request_id = ? AND removed_at IS NOT NULL LIMIT 1`,
          args: [babyId, requestId],
        });
        if (replay.rows[0]) {
          if (String(replay.rows[0].id) !== expectedSessionId
              || Number(replay.rows[0].checked_in_at) !== Number(expectedCheckedInAt)
              || Number(replay.rows[0].checked_out_at) !== Number(expectedCheckedOutAt)) {
            await tx.rollback();
            return NextResponse.json({ error: "requestId was already used for a different childcare command", code: "REQUEST_ID_CONFLICT" }, { status: 409 });
          }
          await tx.commit();
          return commandResponse(db, member.householdId, babyId, replay.rows[0] as Record<string, unknown>, true);
        }
      }

      const currentResult = await tx.execute({
        sql: `SELECT * FROM childcare_sessions
              WHERE id = ? AND baby_id = ? AND removed_at IS NULL LIMIT 1`,
        args: [expectedSessionId, babyId],
      });
      const current = currentResult.rows[0];
      if (!current || current.checked_out_at == null) {
        await tx.rollback();
        return NextResponse.json({ error: "This closed childcare session was not found. Refresh and try again.", code: "CHILDCARE_STATE_CHANGED" }, { status: 409 });
      }
      const currentStart = Number(current.checked_in_at);
      const currentEnd = Number(current.checked_out_at);
      const proposedStart = Number(proposedCheckedInAt);
      const proposedEnd = Number(proposedCheckedOutAt);
      const imported = current.import_completed_at != null || current.import_batch_id != null;

      if (currentStart !== Number(expectedCheckedInAt) || currentEnd !== Number(expectedCheckedOutAt)) {
        if (action === "editSession" && currentStart === proposedStart && currentEnd === proposedEnd) {
          await tx.commit();
          return commandResponse(db, member.householdId, babyId, current as Record<string, unknown>, true);
        }
        await tx.rollback();
        return NextResponse.json({ error: "Childcare times changed on another device. Refresh and try again.", code: "CHILDCARE_STATE_CHANGED" }, { status: 409 });
      }

      if (action !== "editSession" && imported) {
        await tx.rollback();
        return NextResponse.json({
          error: "This care log has already been imported. Its session cannot be dismissed or removed.",
          code: "SESSION_IMPORT_LOCKED",
        }, { status: 409 });
      }

      if (action === "editSession") {
        const overlap = await tx.execute({
          sql: `SELECT id FROM childcare_sessions
                WHERE baby_id = ? AND id <> ? AND removed_at IS NULL
                  AND checked_in_at < ?
                  AND COALESCE(checked_out_at, 9223372036854775807) > ?
                LIMIT 1`,
          args: [babyId, expectedSessionId, proposedEnd, proposedStart],
        });
        if (overlap.rows[0]) {
          await tx.rollback();
          return NextResponse.json({ error: "Those times overlap another childcare session.", code: "SESSION_OVERLAP" }, { status: 409 });
        }

        if (imported) {
          const batch = await tx.execute({
            sql: `SELECT audit_metadata FROM paper_log_import_batches
                  WHERE id = ? AND household_id = ? AND baby_id = ?
                    AND source_kind = 'caretaker_screenshot' AND status = 'committed' LIMIT 1`,
            args: [String(current.import_batch_id ?? ""), member.householdId, babyId],
          });
          const audit = batch.rows[0]?.audit_metadata;
          const reviewedCareWindow = caretakerSleepCoverageFromAudit(audit);
          const activityIds = importedActivityIds(audit);
          if (!reviewedCareWindow || activityIds == null) {
            await tx.rollback();
            return NextResponse.json({
              error: "The approved care-window audit is unavailable, so these attendance times cannot be changed safely.",
              code: "SESSION_IMPORT_AUDIT_UNAVAILABLE",
            }, { status: 409 });
          }
          if (activityIds.length > 0) {
            const placeholders = activityIds.map(() => "?").join(",");
            const naps = await tx.execute({
              sql: `SELECT started_at, ended_at FROM activities
                    WHERE baby_id = ? AND type = 'sleep' AND id IN (${placeholders})`,
              args: [babyId, ...activityIds],
            });
            if (naps.rows.some((nap: Record<string, unknown>) => nap.ended_at == null
                || Number(nap.started_at) < proposedStart || Number(nap.ended_at) > proposedEnd)) {
              await tx.rollback();
              return NextResponse.json({
                error: "The corrected attendance times must still contain every imported nap.",
                code: "SESSION_NAP_OUTSIDE_BOUNDS",
              }, { status: 409 });
            }
          }
        }

        const updated = await tx.execute({
          sql: `UPDATE childcare_sessions SET checked_in_at = ?, checked_out_at = ?, updated_at = ?
                WHERE id = ? AND baby_id = ? AND removed_at IS NULL
                  AND checked_in_at = ? AND checked_out_at = ?`,
          args: [proposedStart, proposedEnd, now, expectedSessionId, babyId, currentStart, currentEnd],
        });
        if (updated.rowsAffected !== 1) {
          await tx.rollback();
          return NextResponse.json({ error: "Childcare times changed on another device. Refresh and try again.", code: "CHILDCARE_STATE_CHANGED" }, { status: 409 });
        }
        if (!imported) await invalidateLinkedDraftSleepReview(tx, member.householdId, expectedSessionId);
        const saved = { ...current, checked_in_at: proposedStart, checked_out_at: proposedEnd, updated_at: now };
        await tx.commit();
        return commandResponse(db, member.householdId, babyId, saved as Record<string, unknown>, false);
      }

      if (action === "dismissImport") {
        if (Number(current.pending_import) !== 1) {
          await tx.commit();
          return commandResponse(db, member.householdId, babyId, current as Record<string, unknown>, true);
        }
        await cancelLinkedDrafts(tx, member.householdId, expectedSessionId, now);
        const updated = await tx.execute({
          sql: `UPDATE childcare_sessions SET pending_import = 0, updated_at = ?
                WHERE id = ? AND baby_id = ? AND removed_at IS NULL AND pending_import = 1
                  AND checked_in_at = ? AND checked_out_at = ?
                  AND import_batch_id IS NULL AND import_completed_at IS NULL`,
          args: [now, expectedSessionId, babyId, currentStart, currentEnd],
        });
        if (updated.rowsAffected !== 1) {
          await tx.rollback();
          return NextResponse.json({ error: "This care-log status changed on another device. Refresh and try again.", code: "CHILDCARE_STATE_CHANGED" }, { status: 409 });
        }
        const saved = { ...current, pending_import: 0, updated_at: now };
        await tx.commit();
        return commandResponse(db, member.householdId, babyId, saved as Record<string, unknown>, false);
      }

      await cancelLinkedDrafts(tx, member.householdId, expectedSessionId, now);
      const removed = await tx.execute({
        sql: `UPDATE childcare_sessions
              SET pending_import = 0, removed_at = ?, removed_by = ?, remove_request_id = ?, updated_at = ?
              WHERE id = ? AND baby_id = ? AND removed_at IS NULL
                AND checked_in_at = ? AND checked_out_at = ?
                AND import_batch_id IS NULL AND import_completed_at IS NULL`,
        args: [now, member.name, requestId, now, expectedSessionId, babyId, currentStart, currentEnd],
      });
      if (removed.rowsAffected !== 1) {
        await tx.rollback();
        return NextResponse.json({ error: "This childcare session changed on another device. Refresh and try again.", code: "CHILDCARE_STATE_CHANGED" }, { status: 409 });
      }
      const saved = { ...current, pending_import: 0, removed_at: now, remove_request_id: requestId, updated_at: now };
      await tx.commit();
      return commandResponse(db, member.householdId, babyId, saved as Record<string, unknown>, false);
    } catch (error) {
      try { await tx.rollback(); } catch {}
      throw error;
    } finally {
      tx.close();
    }
  }

  if (action !== "editCheckIn") {
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
                WHERE baby_id = ? AND removed_at IS NULL
                  AND COALESCE(checked_out_at, 9223372036854775807) > ?
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

  if (action === "editCheckIn") {
    const active = await db.execute({
      sql: "SELECT * FROM childcare_sessions WHERE baby_id = ? AND checked_out_at IS NULL AND removed_at IS NULL LIMIT 1",
      args: [babyId],
    });
    const activeRow = active.rows[0];
    if (!activeRow || String(activeRow.id) !== expectedSessionId) {
      return NextResponse.json({ error: "Childcare state changed on another device. Refresh and try again.", code: "CHILDCARE_STATE_CHANGED" }, { status: 409 });
    }
    if (Number(activeRow.checked_in_at) === at) {
      return commandResponse(db, member.householdId, babyId, activeRow as Record<string, unknown>, true);
    }
    if (Number(activeRow.checked_in_at) !== expectedCheckedInAt) {
      return NextResponse.json({ error: "Childcare state changed on another device. Refresh and try again.", code: "CHILDCARE_STATE_CHANGED" }, { status: 409 });
    }

    const updated = await db.execute({
      sql: `UPDATE childcare_sessions
            SET checked_in_at = ?, updated_at = ?
            WHERE id = ? AND baby_id = ? AND checked_out_at IS NULL AND checked_in_at = ?
              AND NOT EXISTS (
                SELECT 1 FROM childcare_sessions AS other
                WHERE other.baby_id = ? AND other.id <> ?
                  AND other.removed_at IS NULL
                  AND COALESCE(other.checked_out_at, 9223372036854775807) > ?
              )`,
      args: [at, now, activeRow.id, babyId, expectedCheckedInAt, babyId, activeRow.id, at],
    });
    if (updated.rowsAffected !== 1) {
      const current = await db.execute({
        sql: "SELECT * FROM childcare_sessions WHERE baby_id = ? AND checked_out_at IS NULL AND removed_at IS NULL LIMIT 1",
        args: [babyId],
      });
      const currentRow = current.rows[0];
      if (currentRow && String(currentRow.id) === expectedSessionId && Number(currentRow.checked_in_at) === at) {
        return commandResponse(db, member.householdId, babyId, currentRow as Record<string, unknown>, true);
      }
      if (!currentRow || String(currentRow.id) !== expectedSessionId || Number(currentRow.checked_in_at) !== expectedCheckedInAt) {
        return NextResponse.json({ error: "Childcare state changed on another device. Refresh and try again.", code: "CHILDCARE_STATE_CHANGED" }, { status: 409 });
      }
      return NextResponse.json({ error: "That check-in time overlaps an existing childcare session", code: "SESSION_OVERLAP" }, { status: 409 });
    }
    return commandResponse(db, member.householdId, babyId, {
      ...activeRow, checked_in_at: at,
    } as Record<string, unknown>, false);
  }

  const active = await db.execute({
    sql: "SELECT * FROM childcare_sessions WHERE baby_id = ? AND checked_out_at IS NULL AND removed_at IS NULL LIMIT 1",
    args: [babyId],
  });
  if (!active.rows[0]) {
    return NextResponse.json({ error: "This child is not checked in to childcare", code: "NOT_CHECKED_IN" }, { status: 409 });
  }
  if (String(active.rows[0].id) !== expectedSessionId) {
    return NextResponse.json({ error: "Childcare state changed on another device. Refresh and try again.", code: "CHILDCARE_STATE_CHANGED" }, { status: 409 });
  }
  if (sgtDateKey(at) !== sgtDateKey(Number(active.rows[0].checked_in_at))) {
    return NextResponse.json({ error: "Check-out has to be on the same day as check-in. Enter the time they left on the check-in day.", code: "CHILDCARE_DATE_MISMATCH" }, { status: 400 });
  }
  if (at <= Number(active.rows[0].checked_in_at)) {
    return NextResponse.json({ error: "Check-out time must be after check-in time" }, { status: 400 });
  }
  try {
    const updated = await db.execute({
      sql: `UPDATE childcare_sessions
            SET checked_out_at = ?, checked_out_by = ?, check_out_request_id = ?,
                pending_import = 1, updated_at = ?
            WHERE id = ? AND checked_out_at IS NULL AND checked_in_at = ? AND checked_in_at < ?`,
      args: [at, member.name, requestId, now, active.rows[0].id, active.rows[0].checked_in_at, at],
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
