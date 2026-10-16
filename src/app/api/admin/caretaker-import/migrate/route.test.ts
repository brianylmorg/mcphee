import assert from "node:assert/strict";
import test from "node:test";

import { createClient, type Client } from "@libsql/client";
import { NextRequest } from "next/server";

import { createDB } from "@/db";
import { isCaretakerImportSchemaReady } from "@/db/caretaker-import-schema";
import { POST } from "./route";

async function createLegacySchema(db: Client) {
  for (const sql of [
    "CREATE TABLE households (id TEXT PRIMARY KEY, invite_code TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL)",
    "CREATE TABLE users (id TEXT PRIMARY KEY, household_id TEXT NOT NULL, name TEXT NOT NULL, created_at INTEGER NOT NULL)",
    "CREATE TABLE babies (id TEXT PRIMARY KEY, household_id TEXT NOT NULL, name TEXT NOT NULL, birth_date INTEGER, created_at INTEGER NOT NULL)",
    "CREATE TABLE activities (id TEXT PRIMARY KEY, baby_id TEXT NOT NULL, type TEXT NOT NULL, started_at INTEGER NOT NULL, ended_at INTEGER, details TEXT, created_at INTEGER NOT NULL, created_by TEXT)",
    "CREATE TABLE paper_log_import_batches (id TEXT PRIMARY KEY, household_id TEXT NOT NULL, baby_id TEXT NOT NULL, status TEXT NOT NULL, source_note TEXT, created_at INTEGER NOT NULL, created_by TEXT)",
    "CREATE TABLE paper_log_import_rows (id TEXT PRIMARY KEY, batch_id TEXT NOT NULL, row_index INTEGER NOT NULL, status TEXT NOT NULL, source_ref TEXT, confidence INTEGER, type TEXT NOT NULL, started_at INTEGER NOT NULL, ended_at INTEGER, details TEXT, note TEXT, raw_text TEXT, duplicate_activity_id TEXT, imported_activity_id TEXT, created_at INTEGER NOT NULL)",
  ]) {
    await db.execute(sql);
  }

  await db.batch([
    { sql: "INSERT INTO households VALUES (?, ?, ?)", args: ["house-1", "INVITE", 1] },
    { sql: "INSERT INTO users VALUES (?, ?, ?, ?)", args: ["user-1", "house-1", "Parent", 1] },
    { sql: "INSERT INTO users VALUES (?, ?, ?, ?)", args: ["user-2", "house-1", "Parent", 2] },
    { sql: "INSERT INTO babies VALUES (?, ?, ?, NULL, ?)", args: ["baby-1", "house-1", "Baby", 1] },
    {
      sql: "INSERT INTO activities VALUES (?, ?, ?, ?, NULL, ?, ?, ?)",
      args: ["activity-1", "baby-1", "note", 100, JSON.stringify({ text: "preserve" }), 100, "user-1"],
    },
    {
      sql: "INSERT INTO paper_log_import_batches VALUES (?, ?, ?, ?, ?, ?, ?)",
      args: ["batch-1", "house-1", "baby-1", "staged", "legacy source", 100, "Parent"],
    },
    {
      sql: "INSERT INTO paper_log_import_rows VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, NULL, NULL, ?)",
      args: ["row-1", "batch-1", 0, "staged", "page-1", 90, "note", 100, JSON.stringify({ text: "legacy" }), "keep", "raw", 100],
    },
  ], "write");
}

function migrationRequest(token?: string) {
  const headers = new Headers();
  if (token != null) headers.set("authorization", `Bearer ${token}`);
  return new NextRequest("http://localhost/api/admin/caretaker-import/migrate", {
    method: "POST",
    headers,
  });
}

async function legacyState(db: Client) {
  const [users, activity, batch, row] = await Promise.all([
    db.execute("SELECT id, name FROM users ORDER BY id"),
    db.execute("SELECT id, created_by, details FROM activities WHERE id = 'activity-1'"),
    db.execute("SELECT id, source_note, status FROM paper_log_import_batches WHERE id = 'batch-1'"),
    db.execute("SELECT id, raw_text, note, status FROM paper_log_import_rows WHERE id = 'row-1'"),
  ]);
  return {
    users: users.rows.map((entry) => ({ id: String(entry.id), name: String(entry.name) })),
    activity: activity.rows[0],
    batch: batch.rows[0],
    row: row.rows[0],
  };
}

test("caretaker migration endpoint is bearer-protected, additive, idempotent, and preserves legacy records", async () => {
  const previousUrl = process.env.TURSO_DATABASE_URL;
  const previousToken = process.env.TURSO_AUTH_TOKEN;
  const previousMigrationKey = process.env.MIGRATION_KEY;
  const previousCronSecret = process.env.CRON_SECRET;
  const dbPath = `/tmp/mcphee-caretaker-admin-migrate-${process.pid}-${Math.random().toString(36).slice(2)}.db`;
  process.env.TURSO_DATABASE_URL = `file:${dbPath}`;
  delete process.env.TURSO_AUTH_TOKEN;
  delete process.env.CRON_SECRET;
  const db = createClient({ url: process.env.TURSO_DATABASE_URL });

  try {
    await createLegacySchema(db);
    const before = await legacyState(db);
    assert.equal(await isCaretakerImportSchemaReady(db), false);

    delete process.env.MIGRATION_KEY;
    const unconfigured = await POST(migrationRequest("irrelevant"));
    assert.equal(unconfigured.status, 503);
    assert.deepEqual(await unconfigured.json(), { error: "Migration authorization is not configured." });
    assert.equal(await isCaretakerImportSchemaReady(db), false, "an absent configured key must not change schema");

    process.env.MIGRATION_KEY = "synthetic-admin-migration-key";
    const missing = await POST(migrationRequest());
    const wrong = await POST(migrationRequest("wrong-key"));
    assert.equal(missing.status, 401);
    assert.equal(wrong.status, 401);
    assert.equal(await isCaretakerImportSchemaReady(db), false, "unauthorized requests must not change schema");
    assert.deepEqual(await legacyState(db), before);

    const migrated = await POST(migrationRequest("synthetic-admin-migration-key"));
    assert.equal(migrated.status, 200);
    assert.deepEqual(await migrated.json(), {
      success: true,
      schemaReady: true,
      childcareSchemaReady: true,
      purgeCronConfigured: false,
    });
    assert.equal(await isCaretakerImportSchemaReady(db), true);
    assert.deepEqual(await legacyState(db), before, "the targeted migration preserves existing data");

    process.env.CRON_SECRET = "synthetic-cron-secret";
    const repeated = await POST(migrationRequest("synthetic-admin-migration-key"));
    assert.equal(repeated.status, 200);
    assert.deepEqual(await repeated.json(), {
      success: true,
      schemaReady: true,
      childcareSchemaReady: true,
      purgeCronConfigured: true,
    });
    assert.deepEqual(await legacyState(db), before, "repeating the migration remains data-preserving");
  } finally {
    try { createDB().close(); } catch {}
    db.close();
    if (previousUrl === undefined) delete process.env.TURSO_DATABASE_URL;
    else process.env.TURSO_DATABASE_URL = previousUrl;
    if (previousToken === undefined) delete process.env.TURSO_AUTH_TOKEN;
    else process.env.TURSO_AUTH_TOKEN = previousToken;
    if (previousMigrationKey === undefined) delete process.env.MIGRATION_KEY;
    else process.env.MIGRATION_KEY = previousMigrationKey;
    if (previousCronSecret === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = previousCronSecret;
  }
});
