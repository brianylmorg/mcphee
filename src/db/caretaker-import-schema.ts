import type { Client } from "@libsql/client";

export const CARETAKER_IMPORT_BATCH_COLUMNS = {
  source_kind: "TEXT",
  source_hash: "TEXT",
  source_image: "BLOB",
  source_mime: "TEXT",
  expires_at: "INTEGER",
  revision: "INTEGER NOT NULL DEFAULT 1",
  stage_request_id: "TEXT",
  selected_date: "TEXT",
  draft_metadata: "TEXT",
  audit_metadata: "TEXT",
  commit_request_id: "TEXT",
  commit_result: "TEXT",
  committed_at: "INTEGER",
  purged_at: "INTEGER",
  // Intentionally not a database FK: caretaker schema can be applied on old
  // installations before the additive childcare table exists.
  childcare_session_id: "TEXT",
} as const;

export const CARETAKER_IMPORT_ROW_COLUMNS = {
  source_payload: "TEXT",
  reviewed_payload: "TEXT",
  origin: "TEXT",
  origin_evidence: "TEXT",
  issues: "TEXT",
  exclusion_reason: "TEXT",
  conflict_activity_id: "TEXT REFERENCES activities(id)",
  low_confidence_confirmed: "INTEGER NOT NULL DEFAULT 0",
  canonical_hash: "TEXT",
} as const;

const INDEXES = [
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_caretaker_import_stage_request
    ON paper_log_import_batches(household_id, stage_request_id)
    WHERE source_kind = 'caretaker_screenshot'`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_caretaker_import_source_hash_v2
    ON paper_log_import_batches(household_id, baby_id, source_hash)
    WHERE source_kind = 'caretaker_screenshot'`,
  `CREATE INDEX IF NOT EXISTS idx_caretaker_import_expiry
    ON paper_log_import_batches(expires_at)
    WHERE source_kind = 'caretaker_screenshot' AND purged_at IS NULL`,
  `CREATE INDEX IF NOT EXISTS idx_caretaker_import_rows_batch
    ON paper_log_import_rows(batch_id, row_index)`,
] as const;

type SchemaExecutor = Pick<Client, "execute">;

async function tableColumns(db: SchemaExecutor, table: string): Promise<Set<string>> {
  const result = await db.execute(`PRAGMA table_info(${table})`);
  return new Set(result.rows.map((row) => String(row.name)));
}

async function addMissingColumns(
  db: SchemaExecutor,
  table: string,
  columns: Readonly<Record<string, string>>,
): Promise<void> {
  const existing = await tableColumns(db, table);
  for (const [name, definition] of Object.entries(columns)) {
    if (!existing.has(name)) {
      await db.execute(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
    }
  }
}

export async function applyCaretakerImportSchema(db: SchemaExecutor): Promise<void> {
  await addMissingColumns(db, "paper_log_import_batches", CARETAKER_IMPORT_BATCH_COLUMNS);
  await addMissingColumns(db, "paper_log_import_rows", CARETAKER_IMPORT_ROW_COLUMNS);
  for (const sql of INDEXES) await db.execute(sql);
}

export async function isCaretakerImportSchemaReady(db: SchemaExecutor): Promise<boolean> {
  try {
    const [batchColumns, rowColumns, indexes] = await Promise.all([
      tableColumns(db, "paper_log_import_batches"),
      tableColumns(db, "paper_log_import_rows"),
      db.execute({
        sql: `SELECT name FROM sqlite_master WHERE type = 'index' AND name IN (?, ?, ?, ?)`,
        args: [
          "idx_caretaker_import_stage_request",
          "idx_caretaker_import_source_hash_v2",
          "idx_caretaker_import_expiry",
          "idx_caretaker_import_rows_batch",
        ],
      }),
    ]);
    const indexNames = new Set(indexes.rows.map((row) => String(row.name)));
    return Object.keys(CARETAKER_IMPORT_BATCH_COLUMNS).every((name) => batchColumns.has(name))
      && Object.keys(CARETAKER_IMPORT_ROW_COLUMNS).every((name) => rowColumns.has(name))
      && INDEXES.length === indexNames.size;
  } catch {
    return false;
  }
}

export async function hasPaperLogImportSourceKind(db: SchemaExecutor): Promise<boolean> {
  return (await tableColumns(db, "paper_log_import_batches")).has("source_kind");
}

export async function hasCaretakerConflictActivityColumn(db: SchemaExecutor): Promise<boolean> {
  return (await tableColumns(db, "paper_log_import_rows")).has("conflict_activity_id");
}

export async function purgeExpiredCaretakerImports(
  db: Client,
  cutoff = Date.now(),
  purgedAt = Date.now(),
): Promise<{ purgedBatches: number; purgedRows: number }> {
  if (!(await isCaretakerImportSchemaReady(db))) {
    return { purgedBatches: 0, purgedRows: 0 };
  }

  const expired = await db.execute({
    sql: `SELECT id FROM paper_log_import_batches
          WHERE source_kind = 'caretaker_screenshot'
            AND purged_at IS NULL AND expires_at <= ?`,
    args: [cutoff],
  });
  const ids = expired.rows.map((row) => String(row.id));
  if (ids.length === 0) return { purgedBatches: 0, purgedRows: 0 };

  const tx = await db.transaction("write");
  try {
    let purgedRows = 0;
    for (const id of ids) {
      const deleted = await tx.execute({
        sql: "DELETE FROM paper_log_import_rows WHERE batch_id = ?",
        args: [id],
      });
      purgedRows += deleted.rowsAffected;
      await tx.execute({
        sql: `UPDATE paper_log_import_batches
              SET source_image = NULL, source_mime = NULL, source_note = NULL,
                  draft_metadata = NULL, purged_at = ?,
                  status = CASE WHEN status = 'committed' THEN status ELSE 'expired' END
              WHERE id = ? AND source_kind = 'caretaker_screenshot'
                AND purged_at IS NULL AND expires_at <= ?`,
        args: [purgedAt, id, cutoff],
      });
    }
    await tx.commit();
    return { purgedBatches: ids.length, purgedRows };
  } catch (error) {
    try { await tx.rollback(); } catch {}
    throw error;
  } finally {
    tx.close();
  }
}
