import type { Client } from "@libsql/client";

type SchemaExecutor = Pick<Client, "execute">;

const CHILDCARE_SESSION_TABLE = `CREATE TABLE IF NOT EXISTS childcare_sessions (
  id TEXT PRIMARY KEY,
  baby_id TEXT NOT NULL REFERENCES babies(id),
  checked_in_at INTEGER NOT NULL,
  checked_out_at INTEGER,
  checked_in_by TEXT,
  checked_out_by TEXT,
  check_in_request_id TEXT NOT NULL,
  check_out_request_id TEXT,
  pending_import INTEGER NOT NULL DEFAULT 0,
  import_batch_id TEXT REFERENCES paper_log_import_batches(id),
  import_completed_at INTEGER,
  removed_at INTEGER,
  removed_by TEXT,
  remove_request_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
)`;

const CHILDCARE_SESSION_INDEXES = [
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_childcare_sessions_one_active
    ON childcare_sessions(baby_id) WHERE checked_out_at IS NULL`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_childcare_sessions_check_in_request
    ON childcare_sessions(baby_id, check_in_request_id)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_childcare_sessions_check_out_request
    ON childcare_sessions(baby_id, check_out_request_id) WHERE check_out_request_id IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS idx_childcare_sessions_pending
    ON childcare_sessions(baby_id, pending_import, checked_out_at DESC)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_childcare_sessions_remove_request
    ON childcare_sessions(baby_id, remove_request_id) WHERE remove_request_id IS NOT NULL`,
] as const;

const REQUIRED_COLUMNS = [
  "id", "baby_id", "checked_in_at", "checked_out_at", "checked_in_by", "checked_out_by",
  "check_in_request_id", "check_out_request_id", "pending_import", "import_batch_id",
  "import_completed_at", "created_at", "updated_at",
  "removed_at", "removed_by", "remove_request_id",
] as const;

const ADDITIVE_COLUMNS = {
  removed_at: "INTEGER",
  removed_by: "TEXT",
  remove_request_id: "TEXT",
} as const;

export async function applyChildcareModeSchema(db: SchemaExecutor): Promise<void> {
  await db.execute(CHILDCARE_SESSION_TABLE);
  const columns = await db.execute("PRAGMA table_info(childcare_sessions)");
  const names = new Set(columns.rows.map((row) => String(row.name)));
  for (const [name, definition] of Object.entries(ADDITIVE_COLUMNS)) {
    if (!names.has(name)) await db.execute(`ALTER TABLE childcare_sessions ADD COLUMN ${name} ${definition}`);
  }
  for (const sql of CHILDCARE_SESSION_INDEXES) await db.execute(sql);
}

export async function isChildcareModeSchemaReady(db: SchemaExecutor): Promise<boolean> {
  try {
    const [columns, indexes] = await Promise.all([
      db.execute("PRAGMA table_info(childcare_sessions)"),
      db.execute({
        sql: `SELECT name FROM sqlite_master WHERE type = 'index' AND name IN (?, ?, ?, ?, ?)`,
        args: [
          "idx_childcare_sessions_one_active",
          "idx_childcare_sessions_check_in_request",
          "idx_childcare_sessions_check_out_request",
          "idx_childcare_sessions_pending",
          "idx_childcare_sessions_remove_request",
        ],
      }),
    ]);
    const columnNames = new Set(columns.rows.map((row) => String(row.name)));
    const indexNames = new Set(indexes.rows.map((row) => String(row.name)));
    return REQUIRED_COLUMNS.every((name) => columnNames.has(name))
      && CHILDCARE_SESSION_INDEXES.length === indexNames.size;
  } catch {
    return false;
  }
}
