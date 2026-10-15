import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

import { createDB } from "@/db";
import { purgeExpiredCaretakerImports } from "@/db/caretaker-import-schema";
import {
  canonicalCaretakerActivity,
  findNapOverlaps,
  singaporeDateKey,
  validateCaretakerDraft,
} from "@/lib/caretaker-import";
import { planCaretakerSleepReconciliation } from "@/lib/caretaker-sleep-reconciliation";
import {
  CARETAKER_IMPORT_LOW_CONFIDENCE,
  type CaretakerActivityDraft,
  type CaretakerImportIssue,
  type CaretakerImportRow,
  type CaretakerReviewRequest,
} from "@/lib/caretaker-import-contract";
import {
  caretakerError,
  classifyCaretakerClashes,
  isBoundedCaretakerDetails,
  loadCaretakerRows,
  loadCaretakerSnapshot,
  loadClashCandidates,
  loadOwnedCaretakerBatch,
  loadRelevantSleepActivities,
  parseCaretakerDraftMetadata,
  requireCaretakerMember,
  requireCaretakerSchema,
  requireSameOrigin,
  readCaretakerJson,
  serializeCaretakerRow,
} from "@/lib/caretaker-import-server";

export const runtime = "nodejs";
const REVIEW_ACTIVITY_TYPES = new Set(["bottlefeed", "diaper", "sleep", "note"]);

function withIssue(row: CaretakerImportRow, issue: CaretakerImportIssue) {
  if (!row.issues.some((entry) => entry.code === issue.code && entry.message === issue.message)) row.issues.push(issue);
  row.status = "conflict";
  row.canInclude = false;
}

function reviewAudit(rows: CaretakerImportRow[]) {
  return {
    version: 1,
    rowCount: rows.length,
    rows: rows.map((row) => ({
      rowIndex: row.rowIndex,
      canonicalHash: createHash("sha256").update(canonicalCaretakerActivity(row.draft)).digest("hex"),
      origin: row.origin,
      confidence: row.confidence,
      status: row.status,
      importedActivityId: null,
    })),
  };
}

export async function PATCH(request: NextRequest) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const db = createDB();
  const schemaError = await requireCaretakerSchema(db);
  if (schemaError) return schemaError;
  const member = await requireCaretakerMember(request, db);
  if (member instanceof NextResponse) return member;
  const now = Date.now();
  await purgeExpiredCaretakerImports(db, now, now);

  const parsedBody = await readCaretakerJson<CaretakerReviewRequest>(request);
  if (parsedBody instanceof NextResponse) return parsedBody;
  const body = parsedBody;
  if (!body || typeof body.batchId !== "string" || !Number.isInteger(body.expectedRevision)
      || !Array.isArray(body.rows) || body.rows.length > 60) {
    return caretakerError(400, "INVALID_REVIEW", "batchId, expectedRevision, and bounded row decisions are required.");
  }
  const batch = await loadOwnedCaretakerBatch(db, body.batchId, member.householdId);
  if (!batch) return caretakerError(404, "IMPORT_NOT_FOUND", "Caretaker import not found.");
  if (batch.status === "committed") return caretakerError(409, "ALREADY_COMMITTED", "This import is already committed.");
  if (batch.purged_at != null || Number(batch.expires_at) <= now) {
    return caretakerError(410, "IMPORT_EXPIRED", "This import's screenshot and draft have expired.");
  }
  if (Number(batch.revision) !== body.expectedRevision) {
    return caretakerError(409, "REVISION_CONFLICT", "The review changed on another device. Reload it before saving.");
  }
  const coverage = body.sleepCoverage;
  if (!coverage || coverage.napsChecked !== true
      || typeof coverage.startedAt !== "number" || !Number.isSafeInteger(coverage.startedAt)
      || typeof coverage.endedAt !== "number" || !Number.isSafeInteger(coverage.endedAt)
      || coverage.startedAt <= 0 || coverage.startedAt >= coverage.endedAt
      || coverage.endedAt > now
      || singaporeDateKey(coverage.startedAt) !== batch.selected_date
      || singaporeDateKey(coverage.endedAt) !== batch.selected_date) {
    return caretakerError(
      400,
      "INVALID_SLEEP_COVERAGE",
      "Refresh McPhee, then confirm a valid, non-future care start and end on the selected Singapore date.",
    );
  }

  const stored = await loadCaretakerRows(db, batch.id);
  const storedById = new Map(stored.map((row) => [row.id, row]));
  const updatesById = new Map<string, CaretakerReviewRequest["rows"][number]>();
  for (const update of body.rows) {
    if (!update || typeof update.id !== "string" || (update.action !== "include" && update.action !== "exclude")
        || update.id.length > 128 || updatesById.has(update.id) || !storedById.has(update.id)) {
      return caretakerError(400, "INVALID_REVIEW_ROW", "Every review decision must identify one row in this batch exactly once.");
    }
    if ((update.type != null && !REVIEW_ACTIVITY_TYPES.has(String(update.type)))
        || (update.startedAt != null && (typeof update.startedAt !== "number" || !Number.isFinite(update.startedAt)))
        || (update.endedAt != null && (typeof update.endedAt !== "number" || !Number.isFinite(update.endedAt)))
        || (update.details != null && !isBoundedCaretakerDetails(update.details))
        || (update.note != null && (typeof update.note !== "string" || update.note.length > 500))
        || (update.confirmLowConfidence != null && typeof update.confirmLowConfidence !== "boolean")
        || (update.resolvedOrigin != null
          && update.resolvedOrigin !== "caretaker" && update.resolvedOrigin !== "household")) {
      return caretakerError(400, "INVALID_REVIEW_ROW", "A review row contains invalid or oversized activity data.");
    }
    updatesById.set(update.id, update);
  }

  const reviewed: CaretakerImportRow[] = [];
  for (const storedRow of stored) {
    const row = serializeCaretakerRow(storedRow);
    const update = updatesById.get(row.id);
    if (row.origin === "household") {
      if (update?.action === "include") {
        return caretakerError(409, "BLUE_ENTRY_LOCKED", "Household entry (blue) — excluded and cannot be included.");
      }
      row.status = "blue_excluded";
      row.exclusionReason = "Household entry (blue) — excluded";
      row.canInclude = false;
      reviewed.push(row);
      continue;
    }
    if (row.status === "duplicate" && update?.action === "include") {
      return caretakerError(409, "DUPLICATE_LOCKED", "Exact duplicates cannot be included.");
    }
    if (row.status === "duplicate" && !update) {
      reviewed.push(row);
      continue;
    }
    if (!update) {
      return caretakerError(400, "DECISION_REQUIRED", "Include or exclude every non-blue, non-duplicate row.");
    }
    if (update.action === "exclude") {
      row.status = "skipped";
      row.exclusionReason = "Excluded during review";
      row.canInclude = false;
      reviewed.push(row);
      continue;
    }

    if (row.origin === "uncertain") {
      if (update.resolvedOrigin !== "caretaker" && update.resolvedOrigin !== "household") {
        return caretakerError(400, "ORIGIN_REQUIRED", "Resolve uncertain source colour or exclude the row.");
      }
      row.origin = update.resolvedOrigin;
      if (update.resolvedOrigin === "household") {
        row.status = "blue_excluded";
        row.exclusionReason = "Household entry — excluded after origin review";
        row.canInclude = false;
        reviewed.push(row);
        continue;
      }
    }

    const draft: CaretakerActivityDraft = {
      type: update.type ?? row.draft.type,
      startedAt: update.startedAt ?? row.draft.startedAt,
      endedAt: Object.prototype.hasOwnProperty.call(update, "endedAt") ? update.endedAt ?? null : row.draft.endedAt,
      details: update.details ?? row.draft.details,
      note: Object.prototype.hasOwnProperty.call(update, "note") ? update.note ?? null : row.draft.note,
    };
    if (!isBoundedCaretakerDetails(draft.details)) {
      return caretakerError(400, "INVALID_DETAILS", "Activity details must be a bounded object.");
    }
    const changed = canonicalCaretakerActivity(draft) !== canonicalCaretakerActivity(row.draft);
    // Parser uncertainty is not a normal activity validation error. Saving an
    // unchanged fallback must not turn missing source data into a valid entry.
    const unresolvedSourceIssues = row.issues.filter((issue) => {
      if (issue.code === "MISSING_TIME") return update.startedAt == null;
      if (issue.code !== "UNSUPPORTED_LAYOUT") return false;
      const before = row.draft;
      const activityChanged = draft.type !== before.type
        || draft.startedAt !== before.startedAt || draft.endedAt !== before.endedAt
        || (draft.type === "bottlefeed" && (Number(draft.details.amount) !== Number(before.details.amount)
          || draft.details.milkType !== before.details.milkType))
        || (draft.type === "diaper" && (Number(draft.details.peeUnits) !== Number(before.details.peeUnits)
          || draft.details.poop !== before.details.poop))
        || (draft.type === "note" && String(draft.details.notes ?? draft.note ?? "")
          !== String(before.details.notes ?? before.note ?? ""));
      return !activityChanged;
    });
    row.draft = draft;
    row.lowConfidenceConfirmed = row.confidence >= CARETAKER_IMPORT_LOW_CONFIDENCE
      || update.confirmLowConfidence === true || changed;
    row.issues = [...unresolvedSourceIssues, ...validateCaretakerDraft(draft, batch.baby_id, now, batch.selected_date)];
    if (row.confidence < CARETAKER_IMPORT_LOW_CONFIDENCE && !row.lowConfidenceConfirmed) {
      row.issues.unshift({ code: "LOW_CONFIDENCE", message: "OCR confidence is low; confirm or correct this entry.", blocking: true });
    }
    row.status = row.issues.some((entry) => entry.blocking) ? "needs_review" : "reviewed";
    row.exclusionReason = null;
    row.duplicateActivityId = null;
    row.conflictActivityId = null;
    row.canInclude = row.status === "reviewed";
    reviewed.push(row);
  }

  let included = reviewed.filter((row) => row.status === "reviewed" || row.status === "needs_review");
  if (included.length > 0) {
    const min = Math.min(...included.map((row) => row.draft.startedAt));
    const max = Math.max(...included.map((row) => row.draft.startedAt));
    included = classifyCaretakerClashes(included, await loadClashCandidates(db, batch.baby_id, min, max, batch.id));
    const classifiedById = new Map(included.map((row) => [row.id, row]));
    for (let index = 0; index < reviewed.length; index++) reviewed[index] = classifiedById.get(reviewed[index].id) ?? reviewed[index];
  }

  const activelyIncluded = reviewed.filter((row) => row.status !== "skipped"
    && row.status !== "blue_excluded" && row.status !== "duplicate");
  const napOverlapIndexes = findNapOverlaps(activelyIncluded.map((row) => row.draft));
  for (const index of napOverlapIndexes) {
    withIssue(activelyIncluded[index], {
      code: "NAP_OVERLAP",
      message: "This nap overlaps another included nap; correct or exclude one entry.",
      blocking: true,
    });
  }
  for (const row of activelyIncluded.filter((entry) => entry.draft.type === "sleep" && entry.draft.endedAt != null)) {
    if (row.draft.startedAt < coverage.startedAt || row.draft.endedAt! > coverage.endedAt) {
      withIssue(row, {
        code: "INVALID_TIME",
        message: "This nap must be inside the confirmed infant-care window.",
        blocking: true,
      });
    }
  }

  const nextRevision = Number(batch.revision) + 1;
  const tx = await db.transaction("write");
  try {
    const authoritativeNaps = reviewed
      .filter((row) => row.status === "reviewed" && row.draft.type === "sleep" && row.draft.endedAt != null)
      .map((row) => ({ rowId: row.id, startedAt: row.draft.startedAt, endedAt: row.draft.endedAt! }));
    const existingSleeps = await loadRelevantSleepActivities(
      tx as unknown as ReturnType<typeof createDB>,
      batch.baby_id,
      coverage.startedAt,
      coverage.endedAt,
    );
    const sleepPlan = planCaretakerSleepReconciliation(coverage, authoritativeNaps, existingSleeps);
    const existingMetadata = parseCaretakerDraftMetadata(batch.draft_metadata);
    const sleepReconciliation = {
      coverage: sleepPlan.coverage,
      napsChecked: true,
      napSectionDetected: existingMetadata.napSectionDetected,
      authoritativeNapCount: sleepPlan.authoritativeNapCount,
      retainedExactCount: sleepPlan.retainedExactCount,
      removedCount: sleepPlan.removedCount,
      trimmedCount: sleepPlan.trimmedCount,
      splitCount: sleepPlan.splitCount,
      insertedCount: sleepPlan.insertedCount,
      fingerprint: sleepPlan.fingerprint,
    };
    for (const row of reviewed) {
      const canonicalHash = createHash("sha256").update(canonicalCaretakerActivity(row.draft)).digest("hex");
      await tx.execute({
        sql: `UPDATE paper_log_import_rows
              SET status = ?, type = ?, started_at = ?, ended_at = ?, details = ?, note = ?,
                  reviewed_payload = ?, origin = ?, issues = ?, exclusion_reason = ?,
                  duplicate_activity_id = ?, conflict_activity_id = ?,
                  low_confidence_confirmed = ?, canonical_hash = ?
              WHERE id = ? AND batch_id = ?`,
        args: [
          row.status, row.draft.type, row.draft.startedAt, row.draft.endedAt,
          JSON.stringify(row.draft.details), row.draft.note, JSON.stringify(row.draft),
          row.origin, JSON.stringify(row.issues), row.exclusionReason,
          row.duplicateActivityId, row.conflictActivityId, row.lowConfidenceConfirmed ? 1 : 0,
          canonicalHash, row.id, batch.id,
        ],
      });
    }
    const updated = await tx.execute({
      sql: `UPDATE paper_log_import_batches SET revision = ?, audit_metadata = ?, draft_metadata = ?
            WHERE id = ? AND household_id = ? AND revision = ? AND status = 'staged'`,
      args: [
        nextRevision,
        JSON.stringify(reviewAudit(reviewed)),
        JSON.stringify({ ...existingMetadata, sleepReconciliation }),
        batch.id,
        member.householdId,
        body.expectedRevision,
      ],
    });
    if (updated.rowsAffected !== 1) throw new Error("REVISION_CONFLICT");
    await tx.commit();
  } catch (error) {
    try { await tx.rollback(); } catch {}
    if (error instanceof Error && error.message === "REVISION_CONFLICT") {
      return caretakerError(409, "REVISION_CONFLICT", "The review changed on another device. Reload it before saving.");
    }
    if (error instanceof Error && error.message.startsWith("INVALID_")) {
      return caretakerError(409, "SLEEP_REVIEW_INCOMPLETE", "The sleep replacement preview is invalid. Reload and review it again.");
    }
    throw error;
  } finally {
    tx.close();
  }

  const updatedBatch = await loadOwnedCaretakerBatch(db, batch.id, member.householdId);
  return NextResponse.json(await loadCaretakerSnapshot(db, updatedBatch!, now), {
    headers: { "Cache-Control": "private, no-store, max-age=0" },
  });
}
