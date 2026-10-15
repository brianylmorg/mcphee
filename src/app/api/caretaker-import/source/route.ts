import { NextRequest, NextResponse } from "next/server";

import { createDB } from "@/db";
import { purgeExpiredCaretakerImports } from "@/db/caretaker-import-schema";
import {
  caretakerError,
  loadOwnedCaretakerBatch,
  requireCaretakerMember,
  requireCaretakerSchema,
} from "@/lib/caretaker-import-server";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const db = createDB();
  const schemaError = await requireCaretakerSchema(db);
  if (schemaError) return schemaError;
  const member = await requireCaretakerMember(request, db);
  if (member instanceof NextResponse) return member;
  const now = Date.now();
  await purgeExpiredCaretakerImports(db, now, now);
  const batchId = request.nextUrl.searchParams.get("batchId");
  if (!batchId) return caretakerError(400, "BATCH_REQUIRED", "batchId is required.");
  const batch = await loadOwnedCaretakerBatch(db, batchId, member.householdId);
  if (!batch) return caretakerError(404, "IMPORT_NOT_FOUND", "Caretaker import not found.");
  if (batch.purged_at != null || Number(batch.expires_at) <= now || !batch.source_available) {
    return caretakerError(410, "SOURCE_EXPIRED", "This screenshot is no longer available.");
  }
  const source = await db.execute({
    sql: `SELECT source_image, source_mime FROM paper_log_import_batches
          WHERE id = ? AND household_id = ? AND source_kind = 'caretaker_screenshot'
            AND purged_at IS NULL AND expires_at > ? LIMIT 1`,
    args: [batchId, member.householdId, now],
  });
  if (source.rows.length === 0 || source.rows[0].source_image == null) {
    return caretakerError(410, "SOURCE_EXPIRED", "This screenshot is no longer available.");
  }
  const raw: unknown = source.rows[0].source_image;
  const bytes = raw instanceof ArrayBuffer
    ? new Uint8Array(raw)
    : raw instanceof Uint8Array
      ? raw
      : null;
  if (!bytes) return caretakerError(500, "SOURCE_INVALID", "The stored screenshot could not be read.");
  const body = Uint8Array.from(bytes).buffer;
  return new NextResponse(body, {
    headers: {
      "Content-Type": String(source.rows[0].source_mime),
      "Content-Length": String(bytes.byteLength),
      "Cache-Control": "private, no-store, max-age=0",
      "Content-Disposition": "inline; filename=caretaker-source",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
