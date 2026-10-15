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
  caretakerError,
  classifyCaretakerClashes,
  loadCaretakerRows,
  loadClashCandidates,
  loadOwnedCaretakerBatch,
  requireCaretakerMember,
  requireCaretakerSchema,
  requireSameOrigin,
  readCaretakerJson,
  serializeCaretakerRow,
} from "@/lib/caretaker-import-server";
import { assertMilkLedgerMutation, MilkLedgerError } from "@/lib/milk-bank-ledger";
import { generateId } from "@/lib/utils";

export const runtime = "nodejs";

function committedAudit(rows: CaretakerImportRow[]) {
  return {
    version: 1,
    rowCount: rows.length,
    rows: rows.map((row) => ({
      rowIndex: row.rowIndex,
      canonicalHash: createHash("sha256").update(canonicalCaretakerActivity(row.draft)).digest("hex"),
      origin: row.origin,
      confidence: row.confidence,
      status: row.status,
      importedActivityId: row.status === "committed" ? row.duplicateActivityId : null,
    })),
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
    for (const row of included.filter((entry) => entry.draft.type === "sleep")) {
      const overlap = await tx.execute({
        sql: `SELECT id FROM activities WHERE baby_id = ? AND type = 'sleep'
              AND started_at < ? AND COALESCE(ended_at, 9223372036854775807) > ? LIMIT 1`,
        args: [batch.baby_id, row.draft.endedAt!, row.draft.startedAt],
      });
      if (overlap.rows.length > 0) {
        await tx.rollback();
        return caretakerError(409, "NAP_OVERLAP", "A reviewed nap now overlaps an existing McPhee nap.");
      }
    }

    const activityIds = included.map(() => generateId());
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

    for (let index = 0; index < included.length; index++) {
      const row = included[index];
      const activityId = activityIds[index];
      await tx.execute({
        sql: `INSERT INTO activities (id, baby_id, type, started_at, ended_at, details, created_at, created_by)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          activityId, batch.baby_id, row.draft.type, row.draft.startedAt, row.draft.endedAt,
          JSON.stringify(row.draft.details), now + index, member.name,
        ],
      });
      await tx.execute({
        sql: `UPDATE paper_log_import_rows SET status = 'committed', imported_activity_id = ?
              WHERE id = ? AND batch_id = ? AND status = 'reviewed'`,
        args: [activityId, row.id, batch.id],
      });
      row.status = "committed";
      // Reuse the contract's activity pointer for the sanitized audit builder only.
      row.duplicateActivityId = activityId;
    }

    const result: CaretakerCommitResponse = {
      batchId: batch.id,
      committedActivityIds: activityIds,
      committedCount: activityIds.length,
      idempotent: false,
    };
    const updated = await tx.execute({
      sql: `UPDATE paper_log_import_batches
            SET status = 'committed', commit_request_id = ?, commit_result = ?, committed_at = ?,
                revision = revision + 1, audit_metadata = ?
            WHERE id = ? AND household_id = ? AND status = 'staged' AND revision = ?`,
      args: [
        body.requestId, JSON.stringify(result), now, JSON.stringify(committedAudit(rows)),
        batch.id, member.householdId, body.expectedRevision,
      ],
    });
    if (updated.rowsAffected !== 1) throw new Error("COMMIT_RACE");
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
    throw error;
  } finally {
    tx.close();
  }
}
