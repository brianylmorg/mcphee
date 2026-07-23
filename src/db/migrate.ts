import { createClient } from "@libsql/client";

const client = createClient({
  url: process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

const schema = `
CREATE TABLE IF NOT EXISTS households (
  id TEXT PRIMARY KEY,
  invite_code TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id),
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS babies (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id),
  name TEXT NOT NULL,
  birth_date INTEGER,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS activities (
  id TEXT PRIMARY KEY,
  baby_id TEXT NOT NULL REFERENCES babies(id),
  type TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  details TEXT,
  created_at INTEGER NOT NULL,
  created_by TEXT
);

CREATE TABLE IF NOT EXISTS active_timers (
  id TEXT PRIMARY KEY,
  baby_id TEXT NOT NULL REFERENCES babies(id),
  type TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  current_side TEXT,
  side_switches TEXT,
  started_by TEXT
);

CREATE TABLE IF NOT EXISTS measurements (
  id TEXT PRIMARY KEY,
  baby_id TEXT NOT NULL REFERENCES babies(id),
  measured_at INTEGER NOT NULL,
  weight_g INTEGER,
  length_mm INTEGER,
  head_mm INTEGER,
  note TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id),
  endpoint TEXT NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  label TEXT
);

CREATE TABLE IF NOT EXISTS notification_log (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id),
  kind TEXT NOT NULL,
  sent_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS paper_log_import_batches (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id),
  baby_id TEXT NOT NULL REFERENCES babies(id),
  status TEXT NOT NULL,
  source_note TEXT,
  created_at INTEGER NOT NULL,
  created_by TEXT
);

CREATE TABLE IF NOT EXISTS paper_log_import_rows (
  id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL REFERENCES paper_log_import_batches(id),
  row_index INTEGER NOT NULL,
  status TEXT NOT NULL,
  source_ref TEXT,
  confidence INTEGER,
  type TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  details TEXT,
  note TEXT,
  raw_text TEXT,
  duplicate_activity_id TEXT REFERENCES activities(id),
  imported_activity_id TEXT REFERENCES activities(id),
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_users_household_id ON users(household_id);
CREATE INDEX IF NOT EXISTS idx_babies_household_id ON babies(household_id);
CREATE INDEX IF NOT EXISTS idx_activities_baby_started_at ON activities(baby_id, started_at DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activities_baby_type_started_at ON activities(baby_id, type, started_at DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_active_timers_baby_id ON active_timers(baby_id);
CREATE INDEX IF NOT EXISTS idx_measurements_baby_measured_at ON measurements(baby_id, measured_at DESC, created_at DESC);
`;

async function migrate() {
  console.log("Running migrations...");
  try {
    const statements = schema.split(";").map((statement) => statement.trim()).filter(Boolean);
    for (const statement of statements) {
      await client.execute(statement);
    }
    console.log("Migrations completed successfully.");
  } catch (error) {
    console.error("Migration failed:", error);
    process.exit(1);
  } finally {
    client.close();
  }
}

migrate();
