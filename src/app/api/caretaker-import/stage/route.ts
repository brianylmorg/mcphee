import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

import { createDB } from "@/db";
import { purgeExpiredCaretakerImports } from "@/db/caretaker-import-schema";
import { babyBelongsToHousehold } from "@/lib/db/household";
import { generateId } from "@/lib/utils";
import {
  canonicalCaretakerActivity,
  isRealDateKey,
  parseCaretakerOcrLines,
  singaporeDateKey,
} from "@/lib/caretaker-import";
import {
  CARETAKER_IMPORT_IMAGE_TYPES,
  CARETAKER_IMPORT_MAX_IMAGE_BYTES,
  CARETAKER_IMPORT_MAX_OCR_LINES,
  CARETAKER_IMPORT_MAX_REQUEST_BYTES,
  CARETAKER_IMPORT_RETENTION_MS,
  type CaretakerImportRow,
  type CaretakerOcrLine,
} from "@/lib/caretaker-import-contract";
import {
  caretakerError,
  classifyCaretakerClashes,
  isCaretakerOcrLine,
  loadCaretakerSnapshot,
  loadClashCandidates,
  loadOwnedCaretakerBatch,
  requireCaretakerMember,
  requireCaretakerSchema,
  requireSameOrigin,
} from "@/lib/caretaker-import-server";

export const runtime = "nodejs";

function imageMatchesMime(bytes: Uint8Array, mime: string): boolean {
  if (mime === "image/png") {
    return bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10]
      .every((value, index) => bytes[index] === value);
  }
  if (mime === "image/jpeg") return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (mime === "image/webp") {
    return bytes.length >= 12
      && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF"
      && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP";
  }
  return false;
}

function auditMetadata(rows: CaretakerImportRow[]) {
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

async function existingResponse(
  db: ReturnType<typeof createDB>,
  batchId: string,
  householdId: string,
  now: number,
) {
  const batch = await loadOwnedCaretakerBatch(db, batchId, householdId);
  if (!batch) return null;
  const snapshot = await loadCaretakerSnapshot(db, batch, now);
  if (snapshot.batch.status === "expired" && batch.status !== "committed") {
    return caretakerError(410, "IMPORT_EXPIRED", "This screenshot import expired and cannot be restaged.");
  }
  return NextResponse.json({ ...snapshot, idempotent: true });
}

async function readBoundedRequestBody(request: NextRequest): Promise<Uint8Array | null> {
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > CARETAKER_IMPORT_MAX_REQUEST_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

export async function POST(request: NextRequest) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > CARETAKER_IMPORT_MAX_REQUEST_BYTES) {
    return caretakerError(413, "REQUEST_TOO_LARGE", "The complete upload must be smaller than 4.4 MB.");
  }

  const db = createDB();
  const schemaError = await requireCaretakerSchema(db);
  if (schemaError) return schemaError;
  const member = await requireCaretakerMember(request, db);
  if (member instanceof NextResponse) return member;
  const now = Date.now();
  await purgeExpiredCaretakerImports(db, now, now);

  const contentType = request.headers.get("content-type");
  if (!contentType?.toLowerCase().startsWith("multipart/form-data")) {
    return caretakerError(400, "INVALID_MULTIPART", "Upload a screenshot and its local OCR result as multipart form data.");
  }
  const requestBody = await readBoundedRequestBody(request);
  if (!requestBody) {
    return caretakerError(413, "REQUEST_TOO_LARGE", "The complete upload must be smaller than 4.4 MB.");
  }

  let form: FormData;
  try {
    form = await new Response(Uint8Array.from(requestBody).buffer, {
      headers: { "Content-Type": contentType },
    }).formData();
  } catch {
    return caretakerError(400, "INVALID_MULTIPART", "Upload a screenshot and its local OCR result as multipart form data.");
  }
  const babyId = String(form.get("babyId") ?? "");
  const date = String(form.get("date") ?? "");
  const requestId = String(form.get("requestId") ?? "");
  const rawLines = String(form.get("lines") ?? "");
  const image = form.get("image");
  if (!babyId || !isRealDateKey(date) || date > String(singaporeDateKey(now))) {
    return caretakerError(400, "INVALID_DATE_OR_BABY", "Choose a baby and a non-future Singapore activity date.");
  }
  if (!/^[A-Za-z0-9._:-]{8,128}$/.test(requestId)) {
    return caretakerError(400, "INVALID_REQUEST_ID", "requestId must be 8–128 safe characters.");
  }
  if (!(await babyBelongsToHousehold(db, babyId, member.householdId))) {
    return caretakerError(404, "BABY_NOT_FOUND", "Baby not found.");
  }
  if (!(image instanceof File)) return caretakerError(400, "IMAGE_REQUIRED", "A screenshot is required.");
  if (!(CARETAKER_IMPORT_IMAGE_TYPES as readonly string[]).includes(image.type)) {
    return caretakerError(415, "UNSUPPORTED_IMAGE", "Choose a PNG, JPEG, or WebP screenshot.");
  }
  if (image.size <= 0 || image.size > CARETAKER_IMPORT_MAX_IMAGE_BYTES) {
    return caretakerError(413, "IMAGE_TOO_LARGE", "The screenshot must be 3 MiB or smaller.");
  }
  if (rawLines.length > 256_000) return caretakerError(413, "OCR_TOO_LARGE", "The OCR result is too large.");

  let lines: unknown;
  try { lines = JSON.parse(rawLines); } catch {
    return caretakerError(400, "INVALID_OCR", "The local OCR result is not valid JSON.");
  }
  if (!Array.isArray(lines) || lines.length === 0 || lines.length > CARETAKER_IMPORT_MAX_OCR_LINES
      || lines.some((line) => !isCaretakerOcrLine(line))) {
    return caretakerError(400, "INVALID_OCR", `Provide 1–${CARETAKER_IMPORT_MAX_OCR_LINES} valid OCR lines.`);
  }
  const typedLines = lines as CaretakerOcrLine[];
  if (new Set(typedLines.map((line) => line.id)).size !== typedLines.length) {
    return caretakerError(400, "INVALID_OCR", "OCR line IDs must be unique.");
  }

  const bytes = new Uint8Array(await image.arrayBuffer());
  if (!imageMatchesMime(bytes, image.type)) {
    return caretakerError(415, "IMAGE_MISMATCH", "The screenshot bytes do not match its declared image type.");
  }
  const sourceHash = createHash("sha256").update(bytes).digest("hex");

  const byRequest = await db.execute({
    sql: `SELECT id, source_hash, baby_id, selected_date FROM paper_log_import_batches
          WHERE household_id = ? AND stage_request_id = ? AND source_kind = 'caretaker_screenshot' LIMIT 1`,
    args: [member.householdId, requestId],
  });
  if (byRequest.rows.length > 0) {
    const prior = byRequest.rows[0];
    if (String(prior.source_hash) !== sourceHash || String(prior.baby_id) !== babyId || String(prior.selected_date) !== date) {
      return caretakerError(409, "REQUEST_ID_CONFLICT", "This requestId was already used for a different upload.");
    }
    return (await existingResponse(db, String(prior.id), member.householdId, now))!;
  }
  const byHash = await db.execute({
    sql: `SELECT id FROM paper_log_import_batches
          WHERE household_id = ? AND baby_id = ? AND source_hash = ?
            AND source_kind = 'caretaker_screenshot' LIMIT 1`,
    args: [member.householdId, babyId, sourceHash],
  });
  if (byHash.rows.length > 0) {
    const existing = await loadOwnedCaretakerBatch(db, String(byHash.rows[0].id), member.householdId);
    if (existing?.selected_date !== date) {
      return NextResponse.json({
        error: `This screenshot was already staged for ${existing?.selected_date}.`,
        code: "SCREENSHOT_DATE_CONFLICT",
        existingBatchId: existing?.id,
        selectedDate: existing?.selected_date,
      }, { status: 409 });
    }
    return (await existingResponse(db, String(byHash.rows[0].id), member.householdId, now))!;
  }

  const recent = await db.execute({
    sql: `SELECT COUNT(*) AS count FROM paper_log_import_batches
          WHERE household_id = ? AND source_kind = 'caretaker_screenshot' AND created_at >= ?`,
    args: [member.householdId, now - 24 * 60 * 60 * 1000],
  });
  if (Number(recent.rows[0]?.count ?? 0) >= 20) {
    return caretakerError(429, "UPLOAD_LIMIT", "This household has reached the daily screenshot import limit.");
  }

  let parsed: CaretakerImportRow[];
  try { parsed = parseCaretakerOcrLines(typedLines, date); } catch {
    return caretakerError(422, "UNSUPPORTED_LAYOUT", "The local OCR result could not be parsed for this date.");
  }
  if (parsed.length === 0 || parsed.length > 60) {
    return caretakerError(422, "UNSUPPORTED_LAYOUT", "No supported activity groups were found. Keep the section heading in the screenshot.");
  }
  const minStartedAt = Math.min(...parsed.map((row) => row.draft.startedAt));
  const maxStartedAt = Math.max(...parsed.map((row) => row.draft.startedAt));
  const candidates = await loadClashCandidates(db, babyId, minStartedAt, maxStartedAt);
  parsed = classifyCaretakerClashes(parsed, candidates);

  const batchId = generateId();
  const expiresAt = now + CARETAKER_IMPORT_RETENTION_MS;
  const lineById = new Map(typedLines.map((line) => [line.id, line]));
  const rows = parsed.map((row) => ({ ...row, id: generateId() }));
  const statements: Parameters<typeof db.batch>[0] = [{
    sql: `INSERT INTO paper_log_import_batches
          (id, household_id, baby_id, status, source_note, created_at, created_by,
           source_kind, source_hash, source_image, source_mime, expires_at, revision,
           stage_request_id, selected_date, draft_metadata, audit_metadata)
          VALUES (?, ?, ?, 'staged', NULL, ?, ?, 'caretaker_screenshot', ?, ?, ?, ?, 1, ?, ?, ?, ?)`,
    args: [
      batchId, member.householdId, babyId, now, member.name, sourceHash, bytes,
      image.type, expiresAt, requestId, date,
      JSON.stringify({ version: 1, lineCount: typedLines.length }),
      JSON.stringify(auditMetadata(rows)),
    ],
  }];
  for (const row of rows) {
    const canonicalHash = createHash("sha256").update(canonicalCaretakerActivity(row.draft)).digest("hex");
    statements.push({
      sql: `INSERT INTO paper_log_import_rows
            (id, batch_id, row_index, status, source_ref, confidence, type, started_at,
             ended_at, details, note, raw_text, duplicate_activity_id, imported_activity_id,
             created_at, source_payload, reviewed_payload, origin, origin_evidence, issues,
             exclusion_reason, conflict_activity_id, low_confidence_confirmed, canonical_hash)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, NULL, ?, ?, ?, ?, ?, 0, ?)`,
      args: [
        row.id, batchId, row.rowIndex, row.status, row.sourceLineIds.join(","), row.confidence,
        row.draft.type, row.draft.startedAt, row.draft.endedAt, JSON.stringify(row.draft.details),
        row.draft.note, row.sourceText, row.duplicateActivityId, now,
        JSON.stringify({ sourceLineIds: row.sourceLineIds, lines: row.sourceLineIds.map((id) => lineById.get(id)).filter(Boolean) }),
        row.origin, JSON.stringify(row.originEvidence), JSON.stringify(row.issues),
        row.exclusionReason, row.conflictActivityId, canonicalHash,
      ],
    });
  }

  try {
    await db.batch(statements, "write");
  } catch (error) {
    const raced = await db.execute({
      sql: `SELECT id FROM paper_log_import_batches
            WHERE household_id = ? AND baby_id = ? AND source_hash = ?
              AND source_kind = 'caretaker_screenshot' LIMIT 1`,
      args: [member.householdId, babyId, sourceHash],
    });
    if (raced.rows.length > 0) {
      const existing = await loadOwnedCaretakerBatch(db, String(raced.rows[0].id), member.householdId);
      if (existing?.selected_date !== date) {
        return NextResponse.json({
          error: `This screenshot was already staged for ${existing?.selected_date}.`,
          code: "SCREENSHOT_DATE_CONFLICT",
          existingBatchId: existing?.id,
          selectedDate: existing?.selected_date,
        }, { status: 409 });
      }
      return (await existingResponse(db, String(raced.rows[0].id), member.householdId, now))!;
    }
    throw error;
  }
  const batch = await loadOwnedCaretakerBatch(db, batchId, member.householdId);
  return NextResponse.json({ ...await loadCaretakerSnapshot(db, batch!, now), idempotent: false });
}
