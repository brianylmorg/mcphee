import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@libsql/client";

export const runtime = "nodejs";

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
`;

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const key = searchParams.get("key");

  if (key !== process.env.MIGRATION_KEY) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const client = createClient({
      url: process.env.TURSO_DATABASE_URL!,
      authToken: process.env.TURSO_AUTH_TOKEN,
    });

    const statements = schema
      .split(";")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    for (const stmt of statements) {
      await client.execute(stmt);
    }
    client.close();

    return NextResponse.json({ success: true, message: "Migrations completed" });
  } catch (error) {
    console.error("Migration error:", error);
    return NextResponse.json(
      { error: "Migration failed", details: String(error) },
      { status: 500 }
    );
  }
}
