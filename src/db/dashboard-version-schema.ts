import type { Client } from "@libsql/client";

// A single counter that every write to a table the dashboard reads bumps, via
// triggers. The dashboard API puts it in its ETag, so a poll that finds the
// counter unchanged can answer 304 after reading one row instead of
// replaying the whole activity history. Triggers live in the database so no
// write path (API route, admin script, migration) can forget to bump it.
// The sick-mode tables aren't read by the dashboard itself, but the client
// only refetches sick mode (and the diary) when this counter moves, so they
// bump it too.
// Schema changes don't fire triggers, so applying this schema (run by every
// migration, after the other schemas) bumps the counter once more itself.
export const DASHBOARD_VERSION_TABLES = [
  "households",
  "users",
  "babies",
  "activities",
  "active_timers",
  "measurements",
  "childcare_sessions",
  "paper_log_import_batches",
  "sick_mode_episodes",
  "sick_mode_medications",
  "sick_mode_doses",
] as const;

const OPERATIONS = ["INSERT", "UPDATE", "DELETE"] as const;

export const DASHBOARD_VERSION_TRIGGERS = DASHBOARD_VERSION_TABLES.flatMap((table) =>
  OPERATIONS.map((op) => `trg_dashboard_version_${table}_${op.toLowerCase()}`),
);

export const DASHBOARD_VERSION_SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS dashboard_version (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    version INTEGER NOT NULL
  )`,
  "INSERT OR IGNORE INTO dashboard_version (id, version) VALUES (1, 0)",
  ...DASHBOARD_VERSION_TABLES.flatMap((table) =>
    OPERATIONS.map(
      (op) => `CREATE TRIGGER IF NOT EXISTS trg_dashboard_version_${table}_${op.toLowerCase()}
        AFTER ${op} ON ${table}
        BEGIN
          UPDATE dashboard_version SET version = version + 1 WHERE id = 1;
        END`,
    ),
  ),
  "UPDATE dashboard_version SET version = version + 1 WHERE id = 1",
] as const;

type SchemaExecutor = Pick<Client, "execute">;

export async function applyDashboardVersionSchema(db: SchemaExecutor): Promise<void> {
  for (const sql of DASHBOARD_VERSION_SCHEMA_STATEMENTS) {
    await db.execute(sql);
  }
}

export async function isDashboardVersionSchemaReady(db: SchemaExecutor): Promise<boolean> {
  const names = ["dashboard_version", ...DASHBOARD_VERSION_TRIGGERS];
  const result = await db.execute({
    sql: `SELECT name FROM sqlite_master WHERE name IN (${names.map(() => "?").join(", ")})`,
    args: names,
  });
  const found = new Set(result.rows.map((row) => String(row.name)));
  return names.every((name) => found.has(name));
}
