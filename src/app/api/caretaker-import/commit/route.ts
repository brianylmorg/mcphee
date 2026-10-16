import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

import { createDB } from "@/db";
import { purgeExpiredCaretakerImports } from "@/db/caretaker-import-schema";
import { milkLedgerForHousehold } from "@/lib/activity-input";
import {
  canonicalCaretakerActivity,
  findNapOverlaps,
  validateCaretakerDraft,
} from "@/lib/caretaker-import";
import type {
  CaretakerCommitRequest,
  CaretakerCommitResponse,
  CaretakerImportRow,
} from "@/lib/caretaker-import-contract";
import {
  planCaretakerSleepReconciliation,
  summarizeCaretakerSleepPlan,
} from "@/lib/caretaker-sleep-reconciliation";
import {
  caretakerError,
  classifyCaretakerClashes,
  loadCaretakerRows,
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
import { assertMilkLedgerMutation, MilkLedgerError } from "@/lib/milk-bank-ledger";
import { generateId } from "@/lib/utils";
import { loadPendingChildcareSession } from "@/lib/childcare-mode-server";

export const runtime = "nodejs";

function committedAudit(
  rows: CaretakerImportRow[],
  sleepPlan: ReturnType<typeof planCaretakerSleepReconciliation>,
) {
  return {
    version: 2,
    rowCount: rows.length,
    rows: rows.map((row) => ({
      rowIndex: row.rowIndex,
      canonicalHash: createHash("sha256").update(canonicalCaretakerActivity(row.draft)).digest("hex"),
      origin: row.origin,
      confidence: row.confidence,
      status: row.status,
      importedActivityId: row.status === "committed" ? row.duplicateActivityId : null,
    })),
    sleepReconciliation: {
      ...summarizeCaretakerSleepPlan(sleepPlan),
      fingerprint: sleepPlan.fingerprint,
      changedActivityHashes: [...sleepPlan.removedActivityIds, ...sleepPlan.updates.map((entry) => entry.activityId)]
        .map((id) => createHash("sha256").update(id).digest("hex")),
    },
  };
}

export async function POST(request: NextRequest) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const db = createDB();
  const schemaError = await requireCaretakerSchema(db);
  if (schemaError) return schemaError;
  const member = await requireCaretakerMember(request, db);
  if (member instanceof NextResponse) return member;
  const now = Date.now();
  await purgeExpiredCaretakerImports(db, now, now);

  const parsedBody = await readCaretakerJson<CaretakerCommitRequest>(request);
  if (parsedBody instanceof NextResponse) return parsedBody;
  const body = parsedBody;
  if (!body || typeof body.batchId !== "string" || !Number.isInteger(body.expectedRevision)
      || !/^[A-Za-z0-9._:-]{8,128}$/.test(String(body.requestId ?? ""))) {
    return caretakerError(400, "INVALID_COMMIT", "batchId, expectedRevision, and a safe requestId are required.");
  }

  const tx = await db.transaction("write");
  try {
    const batch = await loadOwnedCaretakerBatch(tx as unknown as ReturnType<typeof createDB>, body.batchId, member.householdId);
    if (!batch) {
      await tx.rollback();
      return caretakerError(404, "IMPORT_NOT_FOUND", "Caretaker import not found.");
    }
    if (batch.status === "committed") {
      if (batch.commit_request_id !== body.requestId) {
        await tx.rollback();
        return caretakerError(409, "ALREADY_COMMITTED", "This import was committed by a different request.");
      }
      const result = JSON.parse(batch.commit_result ?? "{}") as CaretakerCommitResponse;
      await tx.commit();
      return NextResponse.json({ ...result, idempotent: true });
    }
    if (batch.purged_at != null || Number(batch.expires_at) <= now) {
      await tx.rollback();
      return caretakerError(410, "IMPORT_EXPIRED", "This import's screenshot and draft have expired.");
    }
    if (Number(batch.revision) !== body.expectedRevision) {
      await tx.rollback();
      return caretakerError(409, "REVISION_CONFLICT", "The review changed. Reload it before committing.");
    }

    const stored = await loadCaretakerRows(tx as unknown as ReturnType<typeof createDB>, batch.id);
    const rows = stored.map(serializeCaretakerRow);
    const metadata = parseCaretakerDraftMetadata(batch.draft_metadata);
    const savedSleepPreview = metadata.sleepReconciliation;
    if (!savedSleepPreview || savedSleepPreview.napsChecked !== true) {
      await tx.rollback();
      return caretakerError(409, "SLEEP_REVIEW_REQUIRED", "Confirm the infant-care window and complete nap history before importing.");
    }
    const unresolved = rows.filter((row) => ["staged", "needs_review", "conflict"].includes(row.status));
    if (unresolved.length > 0) {
      await tx.rollback();
      return caretakerError(409, "REVIEW_INCOMPLETE", "Correct or exclude every unresolved row before importing.", unresolved.flatMap((row) => row.issues));
    }
    const included = rows.filter((row) => row.status === "reviewed");
    for (const row of included) {
      const issues = validateCaretakerDraft(row.draft, batch.baby_id, now, batch.selected_date);
      if (issues.some((issue) => issue.blocking) || (row.confidence < 0.82 && !row.lowConfidenceConfirmed)) {
        await tx.rollback();
        return caretakerError(409, "REVIEW_INCOMPLETE", "An included row no longer passes validation.", issues);
      }
    }

    const coverage = savedSleepPreview.coverage;
    if (batch.childcare_session_id) {
      const session = await loadPendingChildcareSession(
        tx, member.householdId, batch.baby_id, batch.childcare_session_id,
      );
      if (!session || session.checkedOutAt == null) {
        await tx.rollback();
        return caretakerError(409, "CHILDCARE_SESSION_UNAVAILABLE", "This childcare session was already imported or is no longer pending.");
      }
      if (coverage.startedAt !== session.checkedInAt || coverage.endedAt !== session.checkedOutAt) {
        await tx.rollback();
        return caretakerError(409, "CHILDCARE_SESSION_CHANGED", "The linked childcare session changed. Reload and review it again.");
      }
    }
    const authoritativeNaps = included
      .filter((row) => row.draft.type === "sleep" && row.draft.endedAt != null)
      .map((row) => ({ rowId: row.id, startedAt: row.draft.startedAt, endedAt: row.draft.endedAt! }));
    if (authoritativeNaps.some((nap) => nap.startedAt < coverage.startedAt || nap.endedAt > coverage.endedAt)) {
      await tx.rollback();
      return caretakerError(409, "SLEEP_REVIEW_REQUIRED", "A reviewed nap is outside the confirmed infant-care window.");
    }

    if (included.length > 0) {
      const min = Math.min(...included.map((row) => row.draft.startedAt));
      const max = Math.max(...included.map((row) => row.draft.startedAt));
      const finalClassified = classifyCaretakerClashes(
        included,
        await loadClashCandidates(tx as unknown as ReturnType<typeof createDB>, batch.baby_id, min, max, batch.id),
      );
      const clash = finalClassified.find((row) => row.status === "duplicate" || row.status === "conflict");
      if (clash) {
        await tx.rollback();
        return caretakerError(
          409,
          clash.status === "duplicate" ? "NEW_DUPLICATE" : "NEW_CONFLICT",
          "Activities changed after review. Review this import again before committing.",
          clash.issues,
        );
      }
    }

    const overlapping = findNapOverlaps(included.map((row) => row.draft));
    if (overlapping.size > 0) {
      await tx.rollback();
      return caretakerError(409, "NAP_OVERLAP", "Included naps overlap. Correct or exclude one before importing.");
    }
    const relevantSleeps = await loadRelevantSleepActivities(
      tx as unknown as ReturnType<typeof createDB>,
      batch.baby_id,
      coverage.startedAt,
      coverage.endedAt,
    );
    const sleepPlan = planCaretakerSleepReconciliation(coverage, authoritativeNaps, relevantSleeps);
    if (sleepPlan.fingerprint !== savedSleepPreview.fingerprint) {
      await tx.rollback();
      return caretakerError(
        409,
        "SLEEP_PLAN_CHANGED",
        "Sleep records changed after review. Reload and review the replacement preview again.",
      );
    }

    const retainedSleepIds = new Map(sleepPlan.retainedExact.map((nap) => [nap.rowId, nap.activityId]));
    const activityIds = included.map((row) => retainedSleepIds.get(row.id) ?? generateId());
    const ledgerEvents = await milkLedgerForHousehold(tx as unknown as ReturnType<typeof createDB>, member.householdId);
    const bottleEvents = included.flatMap((row, index) => row.draft.type === "bottlefeed" ? [{
      id: activityIds[index],
      type: "bottlefeed",
      startedAt: row.draft.startedAt,
      createdAt: now + index,
      details: row.draft.details,
    }] : []);
    if (bottleEvents.length > 0) {
      assertMilkLedgerMutation(ledgerEvents, [...ledgerEvents, ...bottleEvents], now);
    }

    const changedSleepIds = [...new Set([
      ...sleepPlan.removedActivityIds,
      ...sleepPlan.updates.map((entry) => entry.activityId),
    ])];
    for (const activityId of changedSleepIds) {
      for (const column of ["duplicate_activity_id", "imported_activity_id", "conflict_activity_id"] as const) {
        await tx.execute({
          sql: `UPDATE paper_log_import_rows SET ${column} = NULL WHERE ${column} = ?
                AND batch_id IN (SELECT id FROM paper_log_import_batches WHERE household_id = ?)`,
          args: [activityId, member.householdId],
        });
      }
    }
    for (const update of sleepPlan.updates) {
      await tx.execute({
        sql: `UPDATE activities SET started_at = ?, ended_at = ?
              WHERE id = ? AND baby_id = ? AND type = 'sleep'`,
        args: [update.startedAt, update.endedAt, update.activityId, batch.baby_id],
      });
    }
    for (const activityId of sleepPlan.removedActivityIds) {
      await tx.execute({
        sql: "DELETE FROM activities WHERE id = ? AND baby_id = ? AND type = 'sleep'",
        args: [activityId, batch.baby_id],
      });
    }
    for (const split of sleepPlan.splits) {
      await tx.execute({
        sql: `INSERT INTO activities (id, baby_id, type, started_at, ended_at, details, created_at, created_by)
              VALUES (?, ?, 'sleep', ?, ?, ?, ?, ?)`,
        args: [
          generateId(), batch.baby_id, split.startedAt, split.endedAt,
          split.details, split.createdAt, split.createdBy,
        ],
      });
    }

    for (let index = 0; index < included.length; index++) {
      const row = included[index];
      const activityId = activityIds[index];
      if (!retainedSleepIds.has(row.id)) {
        await tx.execute({
          sql: `INSERT INTO activities (id, baby_id, type, started_at, ended_at, details, created_at, created_by)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          args: [
            activityId, batch.baby_id, row.draft.type, row.draft.startedAt, row.draft.endedAt,
            JSON.stringify(row.draft.details), now + index, member.name,
          ],
        });
      } else if (typeof row.draft.details.notes === "string" && row.draft.details.notes.trim()) {
        const retained = relevantSleeps.find((sleep) => sleep.id === activityId)!;
        let existingDetails: Record<string, unknown> = {};
        try { existingDetails = JSON.parse(retained.details ?? "{}"); } catch {}
        await tx.execute({
          sql: "UPDATE activities SET details = ? WHERE id = ? AND baby_id = ? AND type = 'sleep'",
          args: [JSON.stringify({ ...existingDetails, ...row.draft.details }), activityId, batch.baby_id],
        });
      }
      await tx.execute({
        sql: `UPDATE paper_log_import_rows SET status = 'committed', imported_activity_id = ?
              WHERE id = ? AND batch_id = ? AND status = 'reviewed'`,
        args: [activityId, row.id, batch.id],
      });
      row.status = "committed";
      // Reuse the contract's activity pointer for the sanitized audit builder only.
      row.duplicateActivityId = activityId;
    }

    const sleepSummary = summarizeCaretakerSleepPlan(sleepPlan);
    const result: CaretakerCommitResponse = {
      batchId: batch.id,
      committedActivityIds: activityIds,
      committedCount: activityIds.length,
      idempotent: false,
      sleepReconciliation: sleepSummary,
    };
    const updated = await tx.execute({
      sql: `UPDATE paper_log_import_batches
            SET status = 'committed', commit_request_id = ?, commit_result = ?, committed_at = ?,
                revision = revision + 1, audit_metadata = ?
            WHERE id = ? AND household_id = ? AND status = 'staged' AND revision = ?`,
      args: [
        body.requestId, JSON.stringify(result), now, JSON.stringify(committedAudit(rows, sleepPlan)),
        batch.id, member.householdId, body.expectedRevision,
      ],
    });
    if (updated.rowsAffected !== 1) throw new Error("COMMIT_RACE");
    if (batch.childcare_session_id) {
      const linked = await tx.execute({
        sql: `UPDATE childcare_sessions
              SET pending_import = 0, import_batch_id = ?, import_completed_at = ?, updated_at = ?
              WHERE id = ? AND baby_id = ? AND pending_import = 1 AND import_batch_id IS NULL`,
        args: [batch.id, now, now, batch.childcare_session_id, batch.baby_id],
      });
      if (linked.rowsAffected !== 1) throw new Error("CHILDCARE_SESSION_RACE");
    }
    await tx.commit();
    return NextResponse.json(result);
  } catch (error) {
    try { await tx.rollback(); } catch {}
    if (error instanceof MilkLedgerError && error.code === "INSUFFICIENT_AVAILABLE") {
      return caretakerError(400, "INSUFFICIENT_BREASTMILK", "Imported breastmilk exceeds the available breastmilk bank.");
    }
    if (error instanceof MilkLedgerError) {
      return caretakerError(409, error.code, error.message);
    }
    if (error instanceof Error && error.message === "COMMIT_RACE") {
      return caretakerError(409, "COMMIT_RACE", "The import changed while committing. Reload before retrying.");
    }
    if (error instanceof Error && error.message === "CHILDCARE_SESSION_RACE") {
      return caretakerError(409, "CHILDCARE_SESSION_CHANGED", "The linked childcare session changed while importing. Reload before retrying.");
    }
    if (error instanceof Error && error.message.startsWith("INVALID_")) {
      return caretakerError(409, "SLEEP_REVIEW_INCOMPLETE", "The reviewed sleep replacement is invalid. Reload and review it again.");
    }
    throw error;
  } finally {
    tx.close();
  }
}
