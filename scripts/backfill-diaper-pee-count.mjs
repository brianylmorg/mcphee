#!/usr/bin/env node
import { createClient } from "@libsql/client";

const url = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;
const dryRun = process.argv.includes("--dry-run");

if (!url) {
  console.error("TURSO_DATABASE_URL is required");
  process.exit(1);
}

function parsePeeCount(details) {
  if (details.peeCount != null) return null;
  const peeText = typeof details.peeText === "string" ? details.peeText.trim() : "";
  const match = peeText.match(/^x\s*(\d+)\b/i);
  return match ? Number(match[1]) : null;
}

async function backfillTable(db, table) {
  const result = await db.execute({
    sql: `SELECT id, details FROM ${table} WHERE type = 'diaper'`,
    args: [],
  });

  const updates = [];
  const skipped = [];
  for (const row of result.rows) {
    let details;
    try {
      details = row.details ? JSON.parse(String(row.details)) : {};
    } catch {
      skipped.push({ id: row.id, reason: "invalid_json" });
      continue;
    }

    const peeCount = parsePeeCount(details);
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
    updated: updates.length,
    skipped: skipped.length,
    peeCounts: updates.reduce((acc, update) => {
      acc[update.peeCount] = (acc[update.peeCount] ?? 0) + 1;
      return acc;
    }, {}),
    dryRun,
  };
}

const db = createClient({ url, authToken });
try {
  const results = [];
  results.push(await backfillTable(db, "paper_log_import_rows"));
  results.push(await backfillTable(db, "activities"));
  console.log(JSON.stringify({ ok: true, results }, null, 2));
} finally {
  db.close();
}
