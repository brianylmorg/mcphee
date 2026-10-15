import type { Client } from "@libsql/client";

import { isCaretakerImportSchemaReady } from "@/db/caretaker-import-schema";
import type { TimelineRecord } from "@/lib/activity-timeline";
import { caretakerSleepCoverageFromAudit } from "@/lib/caretaker-sleep-audit";

/** Imports are shown as childcare; the stored uploader is never changed. */
const CARETAKER_CREATED_BY = "childcare";
const CARE_START_NOTES = "Care started";
const CARE_END_NOTES = "Care ended";
const MS_PER_DAY = 86400000;
const SGT_UTC_OFFSET = "+08:00";

export type CaretakerActivityLogOptions = {
  babyId?: string | null;
  types?: string[];
  date?: string | null;
  limit?: number | null;
};

type CaretakerBatchRow = {
  id: unknown;
  baby_id: unknown;
  committed_at: unknown;
  audit_metadata: unknown;
  baby_name: unknown;
};

/**
 * Usable batches are non-array JSON objects of version 1 or 2 whose `rows` is
 * an array. Unknown versions, malformed roots and missing rows yield null, so
 * the batch contributes neither ids nor markers.
 */
function committedImportedActivityIds(parsed: unknown): Set<string> | null {
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const payload = parsed as Record<string, unknown>;
  if (payload.version !== 1 && payload.version !== 2) return null;
  if (!Array.isArray(payload.rows)) return null;

  const ids = new Set<string>();
  for (const row of payload.rows) {
    if (row === null || typeof row !== "object" || Array.isArray(row)) continue;
    const entry = row as Record<string, unknown>;
    if (entry.status !== "committed") continue;
    if (typeof entry.importedActivityId !== "string") continue;
    const importedActivityId = entry.importedActivityId.trim();
    if (importedActivityId !== "") ids.add(importedActivityId);
  }
  return ids;
}

/** SQL timestamps are integer milliseconds; anything else uses the boundary. */
function committedAtMs(value: unknown, boundaryAt: number): number {
  const numeric = typeof value === "number"
    ? value
    : typeof value === "bigint"
      ? Number(value)
      : typeof value === "string" && value.trim() !== ""
        ? Number(value)
        : Number.NaN;
  return Number.isSafeInteger(numeric) && numeric > 0 ? numeric : boundaryAt;
}

/** Half-open day window in the household's fixed +08:00 reporting timezone. */
function sgtDayWindow(date: string | null | undefined): { start: number; end: number } | null {
  if (!date) return null;
  const start = Date.parse(`${date}T00:00:00${SGT_UTC_OFFSET}`);
  if (!Number.isFinite(start)) return null;
  return { start, end: start + MS_PER_DAY };
}

/** Deterministic ordering: started_at DESC, created_at DESC, id DESC. */
function compareTimelineDescending(a: TimelineRecord, b: TimelineRecord): number {
  const startedA = Number(a.started_at);
  const startedB = Number(b.started_at);
  const startedDelta =
    (Number.isFinite(startedB) ? startedB : 0) - (Number.isFinite(startedA) ? startedA : 0);
  if (startedDelta !== 0) return startedDelta;
  const createdA = Number(a.created_at);
  const createdB = Number(b.created_at);
  const createdDelta =
    (Number.isFinite(createdB) ? createdB : 0) - (Number.isFinite(createdA) ? createdA : 0);
  if (createdDelta !== 0) return createdDelta;
  const idA = String(a.id);
  const idB = String(b.id);
  if (idA === idB) return 0;
  return idA < idB ? 1 : -1;
}

export async function projectCaretakerActivityLog(
  db: Pick<Client, "execute">,
  householdId: string,
  activities: TimelineRecord[],
  options: CaretakerActivityLogOptions = {},
): Promise<TimelineRecord[]> {
  const { babyId = null, types = [], date = null, limit = null } = options;

  const capToLimit = (rows: TimelineRecord[]): TimelineRecord[] =>
    limit == null ? rows : rows.slice(0, limit);

  if (!await isCaretakerImportSchemaReady(db)) return capToLimit(activities);

  const batchArgs: string[] = [householdId, householdId];
  let batchWhere =
    "cb.household_id = ? AND b.household_id = ?"
    + " AND cb.source_kind = 'caretaker_screenshot'"
    + " AND cb.status = 'committed'";
  if (babyId) {
    batchWhere += " AND cb.baby_id = ?";
    batchArgs.push(babyId);
  }

  let batches: CaretakerBatchRow[];
  try {
    const result = await db.execute({
      sql: `SELECT cb.id, cb.baby_id, cb.committed_at, cb.audit_metadata, b.name AS baby_name
        FROM paper_log_import_batches cb
        JOIN babies b ON b.id = cb.baby_id
        WHERE ${batchWhere}
        ORDER BY cb.committed_at ASC, cb.id ASC`,
      args: batchArgs,
    });
    batches = result.rows as unknown as CaretakerBatchRow[];
  } catch (error) {
    // An unreadable batch table degrades to the plain diary.
    console.error("Caretaker activity log projection unavailable:", error);
    return capToLimit(activities);
  }

  const importedByBaby = new Map<string, Set<string>>();
  const markers: TimelineRecord[] = [];
  const seenCoverage = new Set<string>();
  const dayWindow = sgtDayWindow(date);
  const includeMarkers = types.length === 0 || types.includes("note");

  for (const batch of batches) {
    const metadata = batch.audit_metadata;
    if (typeof metadata !== "string" || metadata.trim() === "") continue;

    let parsed: unknown;
    try {
      parsed = JSON.parse(metadata);
    } catch {
      continue;
    }

    const batchImportedIds = committedImportedActivityIds(parsed);
    if (!batchImportedIds) continue;

    if (batchImportedIds.size > 0) {
      const babyKey = String(batch.baby_id);
      const existing = importedByBaby.get(babyKey) ?? new Set<string>();
      for (const id of batchImportedIds) existing.add(id);
      importedByBaby.set(babyKey, existing);
    }

    if (!includeMarkers) continue;

    const coverage = caretakerSleepCoverageFromAudit(metadata);
    if (!coverage) continue;
    const { startedAt, endedAt } = coverage;
    if (!Number.isSafeInteger(startedAt) || !Number.isSafeInteger(endedAt)) continue;
    if (startedAt <= 0 || endedAt <= startedAt) continue;

    // Batches arrive in stable order, so the first batch owns a window's markers.
    const coverageKey = JSON.stringify([batch.baby_id, startedAt, endedAt]);
    if (seenCoverage.has(coverageKey)) continue;
    seenCoverage.add(coverageKey);

    const markerBabyId = String(batch.baby_id);
    const batchId = String(batch.id);
    const babyName = typeof batch.baby_name === "string" ? batch.baby_name : null;

    for (const boundary of ["start", "end"] as const) {
      const boundaryAt = boundary === "start" ? startedAt : endedAt;
      if (dayWindow && (boundaryAt < dayWindow.start || boundaryAt >= dayWindow.end)) continue;
      markers.push({
        id: `caretaker-care:${batchId}:${boundary}`,
        baby_id: markerBabyId,
        type: "note",
        started_at: boundaryAt,
        ended_at: null,
        details: JSON.stringify({
          notes: boundary === "start" ? CARE_START_NOTES : CARE_END_NOTES,
        }),
        created_at: committedAtMs(batch.committed_at, boundaryAt),
        created_by: CARETAKER_CREATED_BY,
        baby_name: babyName,
        careBoundary: boundary,
      });
    }
  }

  const attributed = activities.map((record) => {
    const imported = importedByBaby.get(String(record.baby_id));
    if (!imported || !imported.has(String(record.id))) return record;
    return { ...record, created_by: CARETAKER_CREATED_BY };
  });

  const merged = [...attributed, ...markers];
  merged.sort(compareTimelineDescending);
  return capToLimit(merged);
}
