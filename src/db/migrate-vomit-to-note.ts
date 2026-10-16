/**
 * One-off migration: vomit is no longer its own activity type, so every
 * `vomit` activity becomes a `note` whose text describes it.
 *
 * Backs up the affected rows to ~/mcphee-backups first. The original details
 * (vomitType, source, notes) are kept and tagged `legacyType: "vomit"`, so the
 * change can be reversed. Idempotent: re-running finds no vomit rows.
 *
 * Reads TURSO_DATABASE_URL / TURSO_AUTH_TOKEN from the environment and never
 * prints them. Pass --dry-run to print the planned notes without writing.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createClient } from "@libsql/client";

import { parseActivityDetails } from "../lib/milk-volumes";
import { vomitToNoteDetails } from "../lib/vomit-note";

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const url = process.env.TURSO_DATABASE_URL;
  if (!url) throw new Error("TURSO_DATABASE_URL is required");
  console.log(`Target database host: ${new URL(url.replace(/^libsql:/, "https:")).host || url}`);
  const db = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });
  try {
    const rows = (await db.execute("SELECT * FROM activities WHERE type = 'vomit' ORDER BY started_at")).rows;
    const planned = rows.map((row) => ({
      id: String(row.id),
      details: vomitToNoteDetails(parseActivityDetails(row.details)),
    }));
    for (const item of planned) console.log(`${item.id}: ${item.details.notes}`);
    if (dryRun || planned.length === 0) {
      console.log(dryRun ? `Dry run: ${planned.length} vomit activities would become notes.` : "No vomit activities left.");
      return;
    }

    const dir = join(homedir(), "mcphee-backups");
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const file = join(dir, `vomit-to-note-pre-migration-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
    writeFileSync(file, JSON.stringify({ takenAt: new Date().toISOString(), activities: rows },
      (_key, value) => (typeof value === "bigint" ? Number(value) : value), 2), { mode: 0o600 });
    console.log(`Backup: ${file} (${rows.length} vomit activities)`);

    await db.batch(planned.map((item) => ({
      sql: "UPDATE activities SET type = 'note', details = ? WHERE id = ? AND type = 'vomit'",
      args: [JSON.stringify(item.details), item.id],
    })), "write");
    const left = await db.execute("SELECT COUNT(*) AS n FROM activities WHERE type = 'vomit'");
    console.log(`Converted ${planned.length} vomit activities to notes. Vomit rows left: ${left.rows[0].n}`);
  } finally {
    db.close();
  }
}

main().catch((error) => {
  console.error("Vomit-to-note migration failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
