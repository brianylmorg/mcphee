/**
 * Childcare history release migration, run in two phases around the deploy:
 *
 *   --phase=expand    Before deploying: back up the affected tables, add the
 *                     session-removal columns/index and the v4 screenshot
 *                     de-duplication index. Purely additive: the code already
 *                     in production keeps working (it still finds its v2 index).
 *   --phase=contract  After the new code is live and verified: drop the old
 *                     v2/v3 screenshot indexes, which block re-importing a
 *                     dismissed screenshot.
 *
 * Reads TURSO_DATABASE_URL / TURSO_AUTH_TOKEN from the environment and never
 * prints them. Every phase is idempotent and safe to re-run.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createClient, type Client } from "@libsql/client";

import { applyChildcareModeSchema, isChildcareModeSchemaReady } from "./childcare-mode-schema";
import { isCaretakerImportSchemaReady } from "./caretaker-import-schema";

const V4_INDEX = `CREATE UNIQUE INDEX IF NOT EXISTS idx_caretaker_import_source_hash_v4
  ON paper_log_import_batches(household_id, baby_id, source_hash)
  WHERE source_kind = 'caretaker_screenshot' AND status <> 'cancelled'`;

async function indexNames(db: Client): Promise<string[]> {
  const result = await db.execute(
    "SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_caretaker_import_source_hash%' ORDER BY name",
  );
  return result.rows.map((row) => String(row.name));
}

async function backup(db: Client): Promise<string> {
  const sessions = await db.execute("SELECT * FROM childcare_sessions");
  // Screenshot bytes are private and large; the backup keeps every other column.
  const batches = await db.execute(`SELECT id, household_id, baby_id, status, source_note, created_at, created_by,
      source_kind, source_hash, source_mime, expires_at, revision, stage_request_id, selected_date,
      draft_metadata, audit_metadata, childcare_session_id, committed_at, purged_at
    FROM paper_log_import_batches WHERE source_kind = 'caretaker_screenshot'`);
  const schema = await db.execute(
    "SELECT type, name, sql FROM sqlite_master WHERE name LIKE '%childcare%' OR name LIKE '%caretaker%' OR name = 'paper_log_import_batches'",
  );
  const dir = join(homedir(), "mcphee-backups");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = join(dir, `childcare-history-pre-migration-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  writeFileSync(file, JSON.stringify({
    takenAt: new Date().toISOString(),
    childcare_sessions: sessions.rows,
    paper_log_import_batches: batches.rows,
    schema: schema.rows,
  }, (_key, value) => (typeof value === "bigint" ? Number(value) : value), 2), { mode: 0o600 });
  console.log(`Backup: ${file} (${sessions.rows.length} sessions, ${batches.rows.length} screenshot imports)`);
  return file;
}

async function expand(db: Client) {
  await backup(db);

  const duplicates = await db.execute(`SELECT household_id, baby_id, source_hash, COUNT(*) AS n
    FROM paper_log_import_batches
    WHERE source_kind = 'caretaker_screenshot' AND status <> 'cancelled'
    GROUP BY household_id, baby_id, source_hash HAVING COUNT(*) > 1`);
  if (duplicates.rows.length > 0) {
    throw new Error(`Refusing to create the v4 index: ${duplicates.rows.length} duplicate screenshot groups exist`);
  }

  await applyChildcareModeSchema(db);
  await db.execute(V4_INDEX);

  if (!(await isChildcareModeSchemaReady(db))) throw new Error("Childcare schema failed its readiness check");
  console.log("Expand complete. Screenshot indexes now:", (await indexNames(db)).join(", "));
  console.log("Next: deploy the new code, verify it, then run --phase=contract.");
}

async function contract(db: Client) {
  if (!(await indexNames(db)).includes("idx_caretaker_import_source_hash_v4")) {
    throw new Error("v4 index missing: run --phase=expand first");
  }
  await db.execute("DROP INDEX IF EXISTS idx_caretaker_import_source_hash_v2");
  await db.execute("DROP INDEX IF EXISTS idx_caretaker_import_source_hash_v3");
  if (!(await isCaretakerImportSchemaReady(db))) throw new Error("Caretaker import schema failed its readiness check");
  if (!(await isChildcareModeSchemaReady(db))) throw new Error("Childcare schema failed its readiness check");
  console.log("Contract complete. Screenshot indexes now:", (await indexNames(db)).join(", "));
}

async function main() {
  const phase = process.argv.find((arg) => arg.startsWith("--phase="))?.slice("--phase=".length);
  if (phase !== "expand" && phase !== "contract") {
    throw new Error("Usage: tsx src/db/migrate-childcare-history.ts --phase=expand|contract");
  }
  const url = process.env.TURSO_DATABASE_URL;
  if (!url) throw new Error("TURSO_DATABASE_URL is required");
  console.log(`Target database host: ${new URL(url.replace(/^libsql:/, "https:")).host || url}`);
  const db = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });
  try {
    if (phase === "expand") await expand(db);
    else await contract(db);
  } finally {
    db.close();
  }
}

main().catch((error) => {
  console.error("Childcare history migration failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
