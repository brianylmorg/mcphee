import { NextRequest, NextResponse } from "next/server";
import { createDB } from "@/db";

export const runtime = "nodejs";

type BackfillRow = {
  id: string;
  details: string | Record<string, unknown> | null;
};

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

function validateKey(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  return searchParams.get("key") === process.env.MIGRATION_KEY;
}

function parseDetails(value: BackfillRow["details"]): Record<string, unknown> | null {
  if (value == null) return {};
  if (typeof value === "object") return value;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function parsePeeCount(details: Record<string, unknown>) {
  if (details.peeCount != null) return null;
  const peeText = typeof details.peeText === "string" ? details.peeText.trim() : "";
  const match = peeText.match(/^x\s*(\d+)\b/i);
  return match ? Number(match[1]) : null;
}

async function backfillTable(table: "paper_log_import_rows" | "activities", dryRun: boolean) {
  const db = createDB();
  const result = await db.execute({
    sql: `SELECT id, details FROM ${table} WHERE type = 'diaper'`,
    args: [],
  });

  const updates: Array<{ id: string; details: string; peeCount: number }> = [];
  let invalidJson = 0;
  let alreadyCounted = 0;
  let unparseable = 0;

  for (const row of result.rows as unknown as BackfillRow[]) {
    const details = parseDetails(row.details);
    if (!details) {
      invalidJson++;
      continue;
    }
    if (details.peeCount != null) {
      alreadyCounted++;
      continue;
    }

    const peeText = typeof details.peeText === "string" ? details.peeText.trim() : "";
    const peeCount = parsePeeCount(details);
    if (peeText && peeCount == null) unparseable++;
    if (peeCount == null) continue;

    updates.push({
      id: row.id,
      details: JSON.stringify({ ...details, peeCount }),
      peeCount,
    });
  }

  if (!dryRun && updates.length > 0) {
    await db.batch(
      updates.map((update) => ({
        sql: `UPDATE ${table} SET details = ? WHERE id = ?`,
        args: [update.details, update.id],
      })),
      "write"
    );
  }

  return {
    table,
    scanned: result.rows.length,
    updated: dryRun ? 0 : updates.length,
    wouldUpdate: updates.length,
    alreadyCounted,
    invalidJson,
    unparseable,
    peeCounts: updates.reduce<Record<string, number>>((acc, update) => {
      acc[String(update.peeCount)] = (acc[String(update.peeCount)] ?? 0) + 1;
      return acc;
    }, {}),
  };
}

async function handle(request: NextRequest, dryRun: boolean) {
  if (!validateKey(request)) return unauthorized();

  try {
    const results = [
      await backfillTable("paper_log_import_rows", dryRun),
      await backfillTable("activities", dryRun),
    ];
    return NextResponse.json({ ok: true, dryRun, results });
  } catch (error) {
    console.error("Backfill diaper peeCount error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  return handle(request, true);
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  return handle(request, body.action !== "run");
}
