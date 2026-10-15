import type { Client } from "@libsql/client";
import { NextRequest, NextResponse } from "next/server";

import { isCaretakerImportSchemaReady } from "@/db/caretaker-import-schema";
import { parseActivityDetails } from "./milk-volumes";
import {
  compareCaretakerActivities,
} from "./caretaker-import";
import {
  CARETAKER_IMPORT_MAX_JSON_BYTES,
  type CaretakerActivityDraft,
  type CaretakerImportBatch,
  type CaretakerImportError,
  type CaretakerImportIssue,
  type CaretakerImportRow,
  type CaretakerImportSnapshot,
  type CaretakerOcrLine,
  type CaretakerSleepReconciliationPreview,
} from "./caretaker-import-contract";
import type { ExistingSleepActivity } from "./caretaker-sleep-reconciliation";

type Executor = Pick<Client, "execute">;

export type CaretakerMember = {
  householdId: string;
  userId: string;
  name: string;
};

export type CaretakerBatchDb = {
  id: string;
  household_id: string;
  baby_id: string;
  status: string;
  created_at: number;
  created_by: string | null;
  source_hash: string;
  source_mime: string | null;
  expires_at: number;
  revision: number;
  stage_request_id: string;
  selected_date: string;
  commit_request_id: string | null;
  commit_result: string | null;
  committed_at: number | null;
  purged_at: number | null;
  source_available: number;
  draft_metadata: string | null;
  audit_metadata: string | null;
};

export type CaretakerDraftMetadata = {
  version: 2;
  lineCount: number;
  napSectionDetected: boolean;
  sleepReconciliation: CaretakerSleepReconciliationPreview | null;
};

type CaretakerRowDb = {
  id: string;
  batch_id: string;
  row_index: number;
  status: string;
  confidence: number | null;
  type: string;
  started_at: number;
  ended_at: number | null;
  details: string | null;
  note: string | null;
  raw_text: string | null;
  duplicate_activity_id: string | null;
  imported_activity_id: string | null;
  source_payload: string | null;
  reviewed_payload: string | null;
  origin: string | null;
  origin_evidence: string | null;
  issues: string | null;
  exclusion_reason: string | null;
  conflict_activity_id: string | null;
  low_confidence_confirmed: number;
};

export function caretakerError(
  status: number,
  code: string,
  error: string,
  issues?: CaretakerImportIssue[],
): NextResponse<CaretakerImportError> {
  return NextResponse.json({ error, code, ...(issues ? { issues } : {}) }, { status });
}

export async function readCaretakerJson<T>(request: NextRequest): Promise<T | NextResponse> {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return caretakerError(400, "INVALID_JSON", "Request data must be valid JSON.");
  }
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > CARETAKER_IMPORT_MAX_JSON_BYTES) {
    return caretakerError(413, "REQUEST_TOO_LARGE", "Request data is too large.");
  }
  if (!request.body) return caretakerError(400, "INVALID_JSON", "Request data must be valid JSON.");

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > CARETAKER_IMPORT_MAX_JSON_BYTES) {
        await reader.cancel();
        return caretakerError(413, "REQUEST_TOO_LARGE", "Request data is too large.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as T;
  } catch {
    return caretakerError(400, "INVALID_JSON", "Request data must be valid JSON.");
  }
}

export function isBoundedCaretakerDetails(value: unknown): value is Record<string, unknown> {
  let nodes = 0;
  const visit = (item: unknown, depth: number): boolean => {
    nodes++;
    if (nodes > 128 || depth > 4) return false;
    if (item == null || typeof item === "boolean") return true;
    if (typeof item === "number") return Number.isFinite(item);
    if (typeof item === "string") return item.length <= 500;
    if (Array.isArray(item)) return item.length <= 50 && item.every((entry) => visit(entry, depth + 1));
    if (typeof item !== "object") return false;
    const entries = Object.entries(item as Record<string, unknown>);
    return entries.length <= 30
      && entries.every(([key, entry]) => key.length > 0 && key.length <= 64 && visit(entry, depth + 1));
  };
  return Boolean(value) && !Array.isArray(value) && typeof value === "object" && visit(value, 0);
}

export async function requireCaretakerMember(
  request: NextRequest,
  db: Executor,
): Promise<CaretakerMember | NextResponse> {
  const householdId = request.cookies.get("mcphee_hh")?.value;
  const userId = request.cookies.get("mcphee_user")?.value;
  if (!householdId || !userId) return caretakerError(401, "UNAUTHORIZED", "A household member is required.");
  const member = await db.execute({
    sql: "SELECT name FROM users WHERE id = ? AND household_id = ? LIMIT 1",
    args: [userId, householdId],
  });
  if (member.rows.length === 0) return caretakerError(401, "UNAUTHORIZED", "A household member is required.");
  return { householdId, userId, name: String(member.rows[0].name) };
}

export function requireSameOrigin(request: NextRequest): NextResponse | null {
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite === "cross-site") {
    return caretakerError(403, "CROSS_ORIGIN", "Cross-site import requests are not allowed.");
  }
  const origin = request.headers.get("origin");
  if (!origin) return caretakerError(403, "ORIGIN_REQUIRED", "A same-origin request is required.");
  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const expected = forwardedHost
    ? `${forwardedProto || request.nextUrl.protocol.replace(":", "") || "https"}://${forwardedHost}`
    : request.nextUrl.origin;
  if (origin !== expected) return caretakerError(403, "CROSS_ORIGIN", "Cross-site import requests are not allowed.");
  return null;
}

export async function requireCaretakerSchema(db: Executor): Promise<NextResponse | null> {
  if (await isCaretakerImportSchemaReady(db)) return null;
  return caretakerError(503, "SCHEMA_NOT_READY", "Caretaker screenshot import is not available until its additive migration runs.");
}

function safeJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string" || !value) return fallback;
  try { return JSON.parse(value) as T; } catch { return fallback; }
}

export function parseCaretakerDraftMetadata(value: unknown): CaretakerDraftMetadata {
  const parsed = safeJson<Partial<CaretakerDraftMetadata>>(value, {});
  const reconciliation = parsed.sleepReconciliation;
  const validCoverage = reconciliation?.coverage
    && Number.isFinite(reconciliation.coverage.startedAt)
    && Number.isFinite(reconciliation.coverage.endedAt)
    && reconciliation.coverage.startedAt < reconciliation.coverage.endedAt;
  const validCounts = reconciliation && [
    reconciliation.authoritativeNapCount,
    reconciliation.retainedExactCount,
    reconciliation.removedCount,
    reconciliation.trimmedCount,
    reconciliation.splitCount,
    reconciliation.insertedCount,
  ].every((count) => Number.isInteger(count) && count >= 0);
  const validReconciliation = validCoverage && validCounts
    && reconciliation.napsChecked === true
    && typeof reconciliation.napSectionDetected === "boolean"
    && typeof reconciliation.fingerprint === "string"
    && /^[a-f0-9]{64}$/.test(reconciliation.fingerprint);
  return {
    version: 2,
    lineCount: Number.isInteger(parsed.lineCount) && Number(parsed.lineCount) >= 0
      ? Number(parsed.lineCount) : 0,
    napSectionDetected: parsed.napSectionDetected === true,
    sleepReconciliation: validReconciliation
      ? reconciliation as CaretakerSleepReconciliationPreview
      : null,
  };
}

export function dbRowDraft(row: Pick<CaretakerRowDb, "type" | "started_at" | "ended_at" | "details" | "note" | "reviewed_payload">): CaretakerActivityDraft {
  const reviewed = safeJson<CaretakerActivityDraft | null>(row.reviewed_payload, null);
  if (reviewed) return reviewed;
  return {
    type: row.type as CaretakerActivityDraft["type"],
    startedAt: Number(row.started_at),
    endedAt: row.ended_at == null ? null : Number(row.ended_at),
    details: parseActivityDetails(row.details),
    note: row.note == null ? null : String(row.note),
  };
}

export function serializeCaretakerRow(row: CaretakerRowDb): CaretakerImportRow {
  const source = safeJson<{ sourceLineIds?: string[] }>(row.source_payload, {});
  let issues = safeJson<CaretakerImportIssue[]>(row.issues, []);
  const origin = row.origin === "household" || row.origin === "uncertain" ? row.origin : "caretaker";
  let status = row.status as CaretakerImportRow["status"];
  if (row.type === "sleep" && (status === "duplicate" || status === "conflict")) {
    // Older staged imports locked naps against the existing McPhee timer.
    // Let them enter the new explicit care-window review; source overlaps and
    // incomplete endpoints still remain blocking until corrected/excluded.
    status = "needs_review";
    issues = issues.filter((issue) => issue.code !== "EXACT_DUPLICATE" && issue.code !== "ACTIVITY_CONFLICT");
  }
  return {
    id: row.id,
    rowIndex: Number(row.row_index),
    status,
    sourceLineIds: Array.isArray(source.sourceLineIds) ? source.sourceLineIds.map(String) : [],
    sourceText: row.raw_text ?? "",
    confidence: Number(row.confidence ?? 0),
    origin,
    originEvidence: safeJson(row.origin_evidence, []),
    draft: dbRowDraft(row),
    issues,
    exclusionReason: row.exclusion_reason,
    duplicateActivityId: row.duplicate_activity_id,
    conflictActivityId: row.conflict_activity_id,
    canInclude: !["blue_excluded", "duplicate", "committed"].includes(status)
      && !issues.some((entry) => entry.blocking),
    lowConfidenceConfirmed: Number(row.low_confidence_confirmed) === 1,
  };
}

export function serializeCaretakerBatch(row: CaretakerBatchDb, now = Date.now()): CaretakerImportBatch {
  const sourceAvailable = Boolean(row.source_available) && row.purged_at == null && Number(row.expires_at) > now;
  const status = row.status === "committed" ? "committed" : sourceAvailable ? "staged" : "expired";
  const metadata = parseCaretakerDraftMetadata(row.draft_metadata);
  return {
    id: row.id,
    babyId: row.baby_id,
    selectedDate: row.selected_date,
    status,
    revision: Number(row.revision),
    createdAt: Number(row.created_at),
    expiresAt: Number(row.expires_at),
    committedAt: row.committed_at == null ? null : Number(row.committed_at),
    sourceAvailable,
    sourceMime: sourceAvailable ? row.source_mime as CaretakerImportBatch["sourceMime"] : null,
    sleepCoverage: metadata.sleepReconciliation?.coverage ?? null,
    napSectionDetected: metadata.napSectionDetected,
  };
}

export async function loadOwnedCaretakerBatch(
  db: Executor,
  batchId: string,
  householdId: string,
): Promise<CaretakerBatchDb | null> {
  const result = await db.execute({
    sql: `SELECT id, household_id, baby_id, status, created_at, created_by,
                 source_hash, source_mime, expires_at, revision, stage_request_id,
                 selected_date, commit_request_id, commit_result, committed_at,
                 purged_at, draft_metadata, audit_metadata,
                 CASE WHEN source_image IS NULL THEN 0 ELSE 1 END AS source_available
          FROM paper_log_import_batches
          WHERE id = ? AND household_id = ? AND source_kind = 'caretaker_screenshot'
          LIMIT 1`,
    args: [batchId, householdId],
  });
  return result.rows.length ? result.rows[0] as unknown as CaretakerBatchDb : null;
}

export async function loadCaretakerRows(db: Executor, batchId: string): Promise<CaretakerRowDb[]> {
  const result = await db.execute({
    sql: `SELECT id, batch_id, row_index, status, confidence, type, started_at, ended_at,
                 details, note, raw_text, duplicate_activity_id, imported_activity_id,
                 source_payload, reviewed_payload, origin, origin_evidence, issues,
                 exclusion_reason, conflict_activity_id, low_confidence_confirmed
          FROM paper_log_import_rows WHERE batch_id = ? ORDER BY row_index ASC`,
    args: [batchId],
  });
  return result.rows as unknown as CaretakerRowDb[];
}

export async function loadCaretakerSnapshot(
  db: Executor,
  batch: CaretakerBatchDb,
  now = Date.now(),
): Promise<CaretakerImportSnapshot> {
  const serializedBatch = serializeCaretakerBatch(batch, now);
  const rows = serializedBatch.status === "expired" && batch.status !== "committed"
    ? []
    : (await loadCaretakerRows(db, batch.id)).map(serializeCaretakerRow);
  return {
    schemaReady: true,
    batch: serializedBatch,
    rows,
    sleepReconciliation: parseCaretakerDraftMetadata(batch.draft_metadata).sleepReconciliation,
  };
}

export async function loadRelevantSleepActivities(
  db: Executor,
  babyId: string,
  startedAt: number,
  endedAt: number,
): Promise<ExistingSleepActivity[]> {
  const result = await db.execute({
    sql: `SELECT id, started_at, ended_at, details, created_at, created_by
          FROM activities
          WHERE baby_id = ? AND type = 'sleep'
            AND started_at < ?
            AND COALESCE(ended_at, 9223372036854775807) > ?
          ORDER BY started_at ASC, created_at ASC, id ASC`,
    args: [babyId, endedAt, startedAt],
  });
  return result.rows.map((row) => ({
    id: String(row.id),
    startedAt: Number(row.started_at),
    endedAt: row.ended_at == null ? null : Number(row.ended_at),
    details: row.details == null ? null : String(row.details),
    createdAt: Number(row.created_at),
    createdBy: row.created_by == null ? null : String(row.created_by),
  }));
}

export function isCaretakerOcrLine(value: unknown): value is CaretakerOcrLine {
  if (!value || typeof value !== "object") return false;
  const line = value as Partial<CaretakerOcrLine>;
  const bounds = line.bounds;
  const origin = line.origin;
  return typeof line.id === "string" && line.id.length > 0 && line.id.length <= 100
    && typeof line.text === "string" && line.text.length > 0 && line.text.length <= 500
    && typeof line.confidence === "number" && Number.isFinite(line.confidence)
    && line.confidence >= 0 && line.confidence <= 1
    && Boolean(bounds) && [bounds?.x, bounds?.y, bounds?.width, bounds?.height]
      .every((number) => typeof number === "number" && Number.isFinite(number) && number >= 0)
    && Number(bounds?.width) > 0 && Number(bounds?.height) > 0
    && Boolean(origin)
    && ["caretaker", "household", "uncertain"].includes(String(origin?.classification))
    && typeof origin?.confidence === "number" && Number.isFinite(origin.confidence)
    && origin.confidence >= 0 && origin.confidence <= 1
    && (origin.blueRatio == null || (typeof origin.blueRatio === "number" && Number.isFinite(origin.blueRatio)
      && origin.blueRatio >= 0 && origin.blueRatio <= 1))
    && (origin.evidence == null || (typeof origin.evidence === "string" && origin.evidence.length <= 160));
}

type ClashCandidate = { id: string | null; draft: CaretakerActivityDraft };

export async function loadClashCandidates(
  db: Executor,
  babyId: string,
  minStartedAt: number,
  maxStartedAt: number,
  excludeBatchId?: string,
): Promise<ClashCandidate[]> {
  const activities = await db.execute({
    sql: `SELECT id, type, started_at, ended_at, details FROM activities
          WHERE baby_id = ? AND started_at BETWEEN ? AND ?`,
    args: [babyId, minStartedAt - 60_000, maxStartedAt + 60_000],
  });
  const candidates: ClashCandidate[] = activities.rows.map((row) => ({
    id: String(row.id),
    draft: {
      type: String(row.type) as CaretakerActivityDraft["type"],
      startedAt: Number(row.started_at),
      endedAt: row.ended_at == null ? null : Number(row.ended_at),
      details: parseActivityDetails(row.details),
      note: null,
    },
  }));

  const staged = await db.execute({
    sql: `SELECT r.type, r.started_at, r.ended_at, r.details, r.note, r.reviewed_payload
          FROM paper_log_import_rows r
          JOIN paper_log_import_batches b ON b.id = r.batch_id
          WHERE b.baby_id = ? AND b.source_kind = 'caretaker_screenshot'
            AND b.purged_at IS NULL AND b.expires_at > ?
            AND (? IS NULL OR b.id != ?)
            AND r.status NOT IN ('skipped', 'blue_excluded', 'duplicate', 'committed')
            AND r.started_at BETWEEN ? AND ?`,
    args: [babyId, Date.now(), excludeBatchId ?? null, excludeBatchId ?? null, minStartedAt - 60_000, maxStartedAt + 60_000],
  });
  for (const row of staged.rows as unknown as CaretakerRowDb[]) {
    candidates.push({ id: null, draft: dbRowDraft(row) });
  }
  return candidates;
}

export function classifyCaretakerClashes(
  rows: CaretakerImportRow[],
  candidates: ClashCandidate[],
): CaretakerImportRow[] {
  const preceding: ClashCandidate[] = [...candidates];
  return rows.map((sourceRow) => {
    const row = structuredClone(sourceRow);
    if (row.origin === "household") return row;
    // Reviewed caretaker naps replace the McPhee sleep record inside their
    // confirmed care window. Existing or separately staged sleeps therefore
    // cannot turn a source nap into a locked duplicate/conflict here.
    if (row.draft.type === "sleep") return row;
    let exact: ClashCandidate | null = null;
    let conflict: ClashCandidate | null = null;
    for (const candidate of preceding) {
      const comparison = compareCaretakerActivities(row.draft, candidate.draft);
      if (comparison === "exact") { exact = candidate; break; }
      if (comparison === "conflict") conflict ??= candidate;
    }
    if (exact) {
      row.status = "duplicate";
      row.duplicateActivityId = exact.id;
      row.canInclude = false;
      row.issues = [...row.issues.filter((item) => item.code !== "EXACT_DUPLICATE"), {
        code: "EXACT_DUPLICATE",
        message: "This exact activity is already present and will not be imported again.",
        blocking: true,
      }];
    } else if (conflict) {
      row.status = "conflict";
      row.conflictActivityId = conflict.id;
      row.canInclude = false;
      row.issues = [...row.issues.filter((item) => item.code !== "ACTIVITY_CONFLICT"), {
        code: "ACTIVITY_CONFLICT",
        message: "A nearby activity has different details; correct or exclude this entry.",
        blocking: true,
      }];
    }
    preceding.push({ id: null, draft: row.draft });
    return row;
  });
}
