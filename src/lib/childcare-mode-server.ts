import type { Client } from "@libsql/client";
import { NextResponse } from "next/server";

import { isChildcareModeSchemaReady } from "@/db/childcare-mode-schema";
import {
  CHILDCARE_CONFIRMATION_REQUIRED,
  type ChildcareModeState,
  type ChildcareSessionSummary,
} from "@/lib/childcare-mode-contract";

type Executor = { execute: (...args: any[]) => Promise<any> };

type ChildcareSessionRow = {
  id: unknown;
  baby_id: unknown;
  checked_in_at: unknown;
  checked_out_at: unknown;
  pending_import: unknown;
  import_batch_id: unknown;
  import_completed_at: unknown;
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
  };
}

export async function loadChildcareModeState(
  db: Executor,
  householdId: string,
  babyId: string,
): Promise<ChildcareModeState> {
  if (!await isChildcareModeSchemaReady(db)) {
    return { schemaReady: false, activeSession: null, pendingSessions: [] };
  }
  const result = await db.execute({
    sql: `SELECT cs.id, cs.baby_id, cs.checked_in_at, cs.checked_out_at,
                 cs.pending_import, cs.import_batch_id, cs.import_completed_at
          FROM childcare_sessions cs
          JOIN babies b ON b.id = cs.baby_id
          WHERE cs.baby_id = ? AND b.household_id = ?
            AND (cs.checked_out_at IS NULL OR cs.pending_import = 1)
          ORDER BY cs.checked_out_at IS NULL DESC, cs.checked_out_at DESC, cs.created_at DESC, cs.id DESC`,
    args: [babyId, householdId],
  });
  const sessions: ChildcareSessionSummary[] = result.rows.map((row: unknown) => serializeChildcareSession(row as ChildcareSessionRow));
  return {
    schemaReady: true,
    activeSession: sessions.find((session) => session.checkedOutAt == null) ?? null,
    pendingSessions: sessions.filter((session) => session.checkedOutAt != null && session.pendingImport),
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
                 cs.pending_import, cs.import_batch_id, cs.import_completed_at
          FROM childcare_sessions cs
          JOIN babies b ON b.id = cs.baby_id
          WHERE cs.baby_id = ? AND b.household_id = ? AND cs.checked_out_at IS NULL
          LIMIT 1`,
    args: [babyId, householdId],
  });
  return result.rows[0] ? serializeChildcareSession(result.rows[0] as unknown as ChildcareSessionRow) : null;
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
                 cs.pending_import, cs.import_batch_id, cs.import_completed_at
          FROM childcare_sessions cs JOIN babies b ON b.id = cs.baby_id
          WHERE cs.id = ? AND cs.baby_id = ? AND b.household_id = ?
            AND cs.checked_out_at IS NOT NULL AND cs.pending_import = 1
          LIMIT 1`,
    args: [sessionId, babyId, householdId],
  });
  return result.rows[0] ? serializeChildcareSession(result.rows[0] as unknown as ChildcareSessionRow) : null;
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
                 cs.pending_import, cs.import_batch_id, cs.import_completed_at
          FROM childcare_sessions cs JOIN babies b ON b.id = cs.baby_id
          WHERE cs.id = ? AND cs.baby_id = ? AND b.household_id = ? LIMIT 1`,
    args: [sessionId, babyId, householdId],
  });
  return result.rows[0] ? serializeChildcareSession(result.rows[0] as unknown as ChildcareSessionRow) : null;
}
