import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@libsql/client";

export const runtime = "nodejs";

// TEMPORARY diagnostic endpoint for the breastmilk-bank tally investigation.
// Returns the last 48h of pump/bottlefeed rows so the ledger replay can be
// reproduced offline. Remove once the tally issue is resolved.
export async function GET(request: NextRequest) {
  const key = new URL(request.url).searchParams.get("key");
  if (key !== process.env.MIGRATION_KEY) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const client = createClient({
      url: process.env.TURSO_DATABASE_URL!,
      authToken: process.env.TURSO_AUTH_TOKEN,
    });

    const since = Date.now() - 48 * 60 * 60 * 1000;
    const [rows, babies] = await client.batch([
      {
        sql: `SELECT a.id, a.type, a.details, a.started_at, a.created_at, b.name AS baby_name, b.household_id
              FROM activities a JOIN babies b ON b.id = a.baby_id
              WHERE a.type IN ('pump', 'bottlefeed') AND a.started_at >= ?
              ORDER BY a.started_at ASC, a.created_at ASC`,
        args: [since],
      },
      { sql: "SELECT id, household_id, name FROM babies", args: [] },
    ], "read");

    return NextResponse.json(
      { now: Date.now(), rows: rows.rows, babies: babies.rows },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("Milk ledger debug error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
