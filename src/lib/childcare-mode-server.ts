import type { Client } from "@libsql/client";
import { NextResponse } from "next/server";

import { isChildcareModeSchemaReady } from "@/db/childcare-mode-schema";
import { isCaretakerImportSchemaReady } from "@/db/caretaker-import-schema";
import { caretakerSleepCoverageFromAudit } from "@/lib/caretaker-sleep-audit";
import {
  CHILDCARE_CONFIRMATION_REQUIRED,
  type ChildcareModeState,
  type ChildcareSessionSummary,
} from "@/lib/childcare-mode-contract";
import { matchUnlinkedImports, type MatchableBatch } from "@/lib/childcare-import-match";

type Executor = { execute: (...args: any[]) => Promise<any> };

type ChildcareSessionRow = {
  id: unknown;
  baby_id: unknown;
  checked_in_at: unknown;
  checked_out_at: unknown;
  pending_import: unknown;
  import_batch_id: unknown;
  import_completed_at: unknown;
  removed_at: unknown;
};

export function serializeChildcareSession(row: ChildcareSessionRow): ChildcareSessionSummary {
  return {
    id: String(row.id),
    babyId: String(row.baby_id),
    checkedInAt: Number(row.checked_in_at),
    checkedOutAt: row.checked_out_at == null ? null : Number(row.checked_out_at),
    pendingImport: Number(row.pending_import) === 1,
    importBatchId: row.import_batch_id == null ? null : String(row.import_batch_id),
    importCompletedAt: row.import_completed_at == null ? null : Number(row.import_completed_at),
    removedAt: row.removed_at == null ? null : Number(row.removed_at),
    reviewedCareWindow: null,
  };
}

async function addReviewedCareWindows(
  db: Executor,
  householdId: string,
  sessions: ChildcareSessionSummary[],
): Promise<ChildcareSessionSummary[]> {
  const batchIds = [...new Set(sessions.flatMap((session) => session.importBatchId ? [session.importBatchId] : []))];
  if (batchIds.length === 0 || !await isCaretakerImportSchemaReady(db)) return sessions;
  const placeholders = batchIds.map(() => "?").join(",");
  const batches = await db.execute({
    sql: `SELECT id, audit_metadata FROM paper_log_import_batches
          WHERE household_id = ? AND status = 'committed' AND id IN (${placeholders})`,
    args: [householdId, ...batchIds],
  });
  const byBatch = new Map<string, { startedAt: number; endedAt: number }>();
  for (const row of batches.rows) {
    const coverage = caretakerSleepCoverageFromAudit(row.audit_metadata);
    if (coverage) byBatch.set(String(row.id), coverage);
  }
  return sessions.map((session) => ({
    ...session,
    reviewedCareWindow: session.importBatchId ? byBatch.get(session.importBatchId) ?? null : null,
  }));
}

/**
 * Committed caretaker imports for one baby that were never linked to a session.
 * They are paired with their closed session by `matchUnlinkedImports`, so the
 * session reads as imported instead of leaving a dead "import pending" prompt.
 */
export async function loadUnlinkedCommittedImports(
  db: Executor,
  householdId: string,
  babyId: string | null,
): Promise<MatchableBatch[]> {
  if (!await isCaretakerImportSchemaReady(db)) return [];
  const args: string[] = [householdId];
  let where = `household_id = ? AND source_kind = 'caretaker_screenshot'
               AND status = 'committed' AND childcare_session_id IS NULL`;
  if (babyId) {
    where += " AND baby_id = ?";
    args.push(babyId);
  }
  const result = await db.execute({
    sql: `SELECT id, baby_id, selected_date, committed_at, audit_metadata
          FROM paper_log_import_batches WHERE ${where}`,
    args,
  });
  return result.rows.map((row: Record<string, unknown>) => ({
    id: String(row.id),
    babyId: String(row.baby_id),
    childcareSessionId: null,
    selectedDate: typeof row.selected_date === "string" && row.selected_date ? row.selected_date : null,
    committedAt: row.committed_at == null ? null : Number(row.committed_at),
    coverage: caretakerSleepCoverageFromAudit(row.audit_metadata),
  }));
}

/** Applies matched unlinked imports: the session reads as imported by that batch. */
function withMatchedImports(
  sessions: ChildcareSessionSummary[],
  batches: MatchableBatch[],
): ChildcareSessionSummary[] {
  const matches = matchUnlinkedImports(sessions, batches);
  if (matches.size === 0) return sessions;
  return sessions.map((session) => {
    const batch = matches.get(session.id);
    if (!batch) return session;
    return {
      ...session,
      pendingImport: false,
      importBatchId: batch.id,
      importCompletedAt: batch.committedAt ?? session.checkedOutAt,
    };
  });
}

export async function loadChildcareModeState(
  db: Executor,
  householdId: string,
  babyId: string,
): Promise<ChildcareModeState> {
  if (!await isChildcareModeSchemaReady(db)) {
    return { schemaReady: false, activeSession: null, pendingSessions: [], historySessions: [] };
  }
  const result = await db.execute({
    sql: `SELECT cs.id, cs.baby_id, cs.checked_in_at, cs.checked_out_at,
                 cs.pending_import, cs.import_batch_id, cs.import_completed_at, cs.removed_at
          FROM childcare_sessions cs
          JOIN babies b ON b.id = cs.baby_id
          WHERE cs.baby_id = ? AND b.household_id = ?
            AND cs.removed_at IS NULL
          ORDER BY cs.checked_out_at IS NULL DESC, cs.checked_out_at DESC, cs.created_at DESC, cs.id DESC`,
    args: [babyId, householdId],
  });
  const sessions = await addReviewedCareWindows(
    db,
    householdId,
    withMatchedImports(
      result.rows.map((row: unknown) => serializeChildcareSession(row as ChildcareSessionRow)),
      await loadUnlinkedCommittedImports(db, householdId, babyId),
    ),
  );
  return {
    schemaReady: true,
    activeSession: sessions.find((session) => session.checkedOutAt == null) ?? null,
    pendingSessions: sessions.filter((session) => session.checkedOutAt != null && session.pendingImport),
    historySessions: sessions.filter((session) => session.checkedOutAt != null),
  };
}

export async function activeChildcareSession(
  db: Executor,
  householdId: string,
  babyId: string,
): Promise<ChildcareSessionSummary | null> {
  if (!await isChildcareModeSchemaReady(db)) return null;
  const result = await db.execute({
    sql: `SELECT cs.id, cs.baby_id, cs.checked_in_at, cs.checked_out_at,
                 cs.pending_import, cs.import_batch_id, cs.import_completed_at, cs.removed_at
          FROM childcare_sessions cs
          JOIN babies b ON b.id = cs.baby_id
          WHERE cs.baby_id = ? AND b.household_id = ? AND cs.checked_out_at IS NULL
            AND cs.removed_at IS NULL
          LIMIT 1`,
    args: [babyId, householdId],
  });
  if (!result.rows[0]) return null;
  return (await addReviewedCareWindows(db, householdId, [
    serializeChildcareSession(result.rows[0] as unknown as ChildcareSessionRow),
  ]))[0];
}

export async function childcareCreationGuard(
  db: Executor,
  householdId: string,
  babyId: string,
  override: unknown,
): Promise<NextResponse | null> {
  if (override === true) return null;
  const session = await activeChildcareSession(db, householdId, babyId);
  if (!session) return null;
  return NextResponse.json({
    error: "This child is checked in to childcare. Confirm if you still want to add this activity.",
    code: CHILDCARE_CONFIRMATION_REQUIRED,
    childcareSession: session,
  }, { status: 409 });
}

export async function loadPendingChildcareSession(
  db: Executor,
  householdId: string,
  babyId: string,
  sessionId: string,
): Promise<ChildcareSessionSummary | null> {
  if (!await isChildcareModeSchemaReady(db)) return null;
  const result = await db.execute({
    sql: `SELECT cs.id, cs.baby_id, cs.checked_in_at, cs.checked_out_at,
                 cs.pending_import, cs.import_batch_id, cs.import_completed_at, cs.removed_at
          FROM childcare_sessions cs JOIN babies b ON b.id = cs.baby_id
          WHERE cs.id = ? AND cs.baby_id = ? AND b.household_id = ?
            AND cs.checked_out_at IS NOT NULL AND cs.pending_import = 1
            AND cs.removed_at IS NULL
          LIMIT 1`,
    args: [sessionId, babyId, householdId],
  });
  if (!result.rows[0]) return null;
  return (await addReviewedCareWindows(db, householdId, [
    serializeChildcareSession(result.rows[0] as unknown as ChildcareSessionRow),
  ]))[0];
}

export async function loadChildcareSessionById(
  db: Executor,
  householdId: string,
  babyId: string,
  sessionId: string,
): Promise<ChildcareSessionSummary | null> {
  if (!await isChildcareModeSchemaReady(db)) return null;
  const result = await db.execute({
    sql: `SELECT cs.id, cs.baby_id, cs.checked_in_at, cs.checked_out_at,
                 cs.pending_import, cs.import_batch_id, cs.import_completed_at, cs.removed_at
          FROM childcare_sessions cs JOIN babies b ON b.id = cs.baby_id
          WHERE cs.id = ? AND cs.baby_id = ? AND b.household_id = ?
            AND cs.removed_at IS NULL LIMIT 1`,
    args: [sessionId, babyId, householdId],
  });
  if (!result.rows[0]) return null;
  return (await addReviewedCareWindows(db, householdId, [
    serializeChildcareSession(result.rows[0] as unknown as ChildcareSessionRow),
  ]))[0];
}
