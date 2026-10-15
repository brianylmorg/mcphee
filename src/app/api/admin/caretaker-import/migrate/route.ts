import { createHash, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

import { createDB } from "@/db";
import {
  applyCaretakerImportSchema,
  isCaretakerImportSchemaReady,
} from "@/db/caretaker-import-schema";

export const runtime = "nodejs";

function safeSecretEqual(provided: string, expected: string): boolean {
  const providedDigest = createHash("sha256").update(provided, "utf8").digest();
  const expectedDigest = createHash("sha256").update(expected, "utf8").digest();
  return timingSafeEqual(providedDigest, expectedDigest);
}

function bearerToken(request: NextRequest): string {
  const authorization = request.headers.get("authorization") ?? "";
  return authorization.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : "";
}

export async function POST(request: NextRequest) {
  const migrationKey = process.env.MIGRATION_KEY;
  if (!migrationKey) {
    return NextResponse.json(
      { error: "Migration authorization is not configured." },
      { status: 503 },
    );
  }

  if (!safeSecretEqual(bearerToken(request), migrationKey)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const db = createDB();
    await applyCaretakerImportSchema(db);
    const schemaReady = await isCaretakerImportSchemaReady(db);
    if (!schemaReady) {
      return NextResponse.json(
        { error: "Caretaker import schema did not pass its readiness check." },
        { status: 500 },
      );
    }

    return NextResponse.json({
      success: true,
      schemaReady: true,
      purgeCronConfigured: Boolean(process.env.CRON_SECRET),
    });
  } catch {
    console.error("Caretaker import additive migration failed.");
    return NextResponse.json(
      { error: "Caretaker import migration failed." },
      { status: 500 },
    );
  }
}
