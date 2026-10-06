import type { Client } from "@libsql/client";

export const SICK_MODE_TABLES = [
  "sick_mode_episodes",
  "sick_mode_medications",
  "sick_mode_doses",
] as const;

export const SICK_MODE_SCHEMA_OBJECTS = [
  ...SICK_MODE_TABLES,
  "idx_sick_mode_episodes_one_active",
  "idx_sick_mode_episodes_baby_started",
  "idx_sick_mode_medications_episode",
  "idx_sick_mode_doses_medication_given",
] as const;

export const SICK_MODE_SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS sick_mode_episodes (
    id TEXT PRIMARY KEY,
    baby_id TEXT NOT NULL REFERENCES babies(id),
    started_at INTEGER NOT NULL,
    ended_at INTEGER,
    baseline_daily_ml REAL NOT NULL,
    baseline_kind TEXT NOT NULL CHECK (baseline_kind IN ('calculated', 'manual')),
    baseline_available_day_count INTEGER NOT NULL,
    baseline_source_days TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    created_by TEXT,
    ended_by TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS sick_mode_medications (
    id TEXT PRIMARY KEY,
    episode_id TEXT NOT NULL REFERENCES sick_mode_episodes(id),
    name TEXT NOT NULL,
    dose_text TEXT NOT NULL,
    as_needed INTEGER NOT NULL,
    min_interval_minutes INTEGER,
    max_interval_minutes INTEGER,
    created_at INTEGER NOT NULL,
    created_by TEXT,
    updated_at INTEGER NOT NULL,
    revision INTEGER NOT NULL DEFAULT 1
  )`,
  `CREATE TABLE IF NOT EXISTS sick_mode_doses (
    id TEXT PRIMARY KEY,
    medication_id TEXT NOT NULL REFERENCES sick_mode_medications(id),
    given_at INTEGER NOT NULL,
    dose_text TEXT NOT NULL,
    given_by TEXT,
    request_id TEXT NOT NULL UNIQUE,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    revision INTEGER NOT NULL DEFAULT 1,
    deleted_at INTEGER,
    deleted_by TEXT
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_sick_mode_episodes_one_active
    ON sick_mode_episodes(baby_id) WHERE ended_at IS NULL`,
  `CREATE INDEX IF NOT EXISTS idx_sick_mode_episodes_baby_started
    ON sick_mode_episodes(baby_id, started_at DESC, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_sick_mode_medications_episode
    ON sick_mode_medications(episode_id, created_at ASC, id ASC)`,
  `CREATE INDEX IF NOT EXISTS idx_sick_mode_doses_medication_given
    ON sick_mode_doses(medication_id, given_at DESC, created_at DESC, id DESC)`,
] as const;

type SchemaExecutor = Pick<Client, "execute">;

export async function applySickModeSchema(db: SchemaExecutor): Promise<void> {
  for (const sql of SICK_MODE_SCHEMA_STATEMENTS) {
    await db.execute(sql);
  }
}

export async function isSickModeSchemaReady(db: SchemaExecutor): Promise<boolean> {
  const placeholders = SICK_MODE_SCHEMA_OBJECTS.map(() => "?").join(", ");
  const result = await db.execute({
    sql: `SELECT name FROM sqlite_master WHERE name IN (${placeholders})`,
    args: [...SICK_MODE_SCHEMA_OBJECTS],
  });
  const names = new Set(result.rows.map((row) => String(row.name)));
  return SICK_MODE_SCHEMA_OBJECTS.every((name) => names.has(name));
}
