import { NextRequest, NextResponse } from "next/server";

import { createDB } from "@/db";
import { isCaretakerImportSchemaReady, purgeExpiredCaretakerImports } from "@/db/caretaker-import-schema";
import {
  caretakerError,
  loadCaretakerSnapshot,
  loadOwnedCaretakerBatch,
  requireCaretakerMember,
} from "@/lib/caretaker-import-server";

export const runtime = "nodejs";
const NO_STORE = { "Cache-Control": "private, no-store, max-age=0" };

export async function GET(request: NextRequest) {
  const db = createDB();
  const member = await requireCaretakerMember(request, db);
  if (member instanceof NextResponse) return member;
  if (!(await isCaretakerImportSchemaReady(db))) {
    return NextResponse.json({ schemaReady: false, batch: null, rows: [] }, { headers: NO_STORE });
  }
  const now = Date.now();
  await purgeExpiredCaretakerImports(db, now, now);
  const batchId = request.nextUrl.searchParams.get("batchId");
  if (!batchId) return caretakerError(400, "BATCH_REQUIRED", "batchId is required.");
  const batch = await loadOwnedCaretakerBatch(db, batchId, member.householdId);
  if (!batch) return caretakerError(404, "IMPORT_NOT_FOUND", "Caretaker import not found.");
  if (Number(batch.expires_at) <= now || batch.purged_at != null) {
    return caretakerError(410, "IMPORT_EXPIRED", "This import's screenshot and draft have expired.");
  }
  return NextResponse.json(await loadCaretakerSnapshot(db, batch, now), { headers: NO_STORE });
}
