import assert from "node:assert/strict";
import test from "node:test";
import { createClient, type Client } from "@libsql/client";
import { NextRequest } from "next/server";

import { applyCaretakerImportSchema } from "@/db/caretaker-import-schema";
import { GET as getActivities } from "./route";

const DAY = "2026-10-05";
const ts = (date: string, time: string) => Date.parse(`${date}T${time}:00+08:00`);

type ActivityRecord = {
  id: string;
  baby_id: string;
  type: string;
  started_at: number;
  ended_at: number | null;
  details: string | null;
  created_at: number;
  created_by: string | null;
  baby_name: string;
  careBoundary?: "start" | "end";
};

function request(path: string, household = "house-1") {
  return new NextRequest(`http://localhost${path}`, {
    headers: { cookie: `mcphee_hh=${household}; mcphee_user=user-1` },
  });
}

async function activitiesFrom(path: string, household = "house-1") {
  const response = await getActivities(request(path, household));
  assert.equal(response.status, 200);
  return (await response.json()) as { activities: ActivityRecord[] };
}

async function openTestDb(prefix: string) {
  const savedUrl = process.env.TURSO_DATABASE_URL;
  const savedToken = process.env.TURSO_AUTH_TOKEN;
  const dbPath = `/tmp/mcphee-childcare-log-${prefix}-${process.pid}-${Math.random().toString(36).slice(2)}.db`;
  process.env.TURSO_DATABASE_URL = `file:${dbPath}`;
  delete process.env.TURSO_AUTH_TOKEN;
  const client = createClient({ url: `file:${dbPath}` });
  const restore = () => {
    if (savedUrl === undefined) delete process.env.TURSO_DATABASE_URL;
    else process.env.TURSO_DATABASE_URL = savedUrl;
    if (savedToken === undefined) delete process.env.TURSO_AUTH_TOKEN;
    else process.env.TURSO_AUTH_TOKEN = savedToken;
    client.close();
  };
  return { client, restore };
}

async function createCoreSchema(client: Client) {
  await client.batch([
    "CREATE TABLE households (id TEXT PRIMARY KEY, invite_code TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL)",
    "CREATE TABLE users (id TEXT PRIMARY KEY, household_id TEXT NOT NULL, name TEXT NOT NULL, created_at INTEGER NOT NULL)",
    "CREATE TABLE babies (id TEXT PRIMARY KEY, household_id TEXT NOT NULL, name TEXT NOT NULL, birth_date INTEGER, created_at INTEGER NOT NULL)",
    "CREATE TABLE activities (id TEXT PRIMARY KEY, baby_id TEXT NOT NULL, type TEXT NOT NULL, started_at INTEGER NOT NULL, ended_at INTEGER, details TEXT, created_at INTEGER NOT NULL, created_by TEXT)",
  ], "write");
  await client.batch([
    { sql: "INSERT INTO households VALUES (?, ?, ?)", args: ["house-1", "ABC123", ts(DAY, "00:00")] },
    { sql: "INSERT INTO households VALUES (?, ?, ?)", args: ["house-2", "XYZ789", ts(DAY, "00:00")] },
    { sql: "INSERT INTO users VALUES (?, ?, ?, ?)", args: ["user-1", "house-1", "Parent One", ts(DAY, "00:00")] },
    { sql: "INSERT INTO users VALUES (?, ?, ?, ?)", args: ["user-2", "house-2", "Parent Two", ts(DAY, "00:00")] },
    { sql: "INSERT INTO babies VALUES (?, ?, ?, NULL, ?)", args: ["baby-1", "house-1", "Baby One", ts(DAY, "00:00")] },
    { sql: "INSERT INTO babies VALUES (?, ?, ?, NULL, ?)", args: ["baby-sibling", "house-1", "Baby Sibling", ts(DAY, "00:00")] },
    { sql: "INSERT INTO babies VALUES (?, ?, ?, NULL, ?)", args: ["baby-foreign", "house-2", "Baby Foreign", ts(DAY, "00:00")] },
  ], "write");
}

async function createCaretakerTables(client: Client) {
  await client.batch([
    "CREATE TABLE paper_log_import_batches (id TEXT PRIMARY KEY, household_id TEXT NOT NULL, baby_id TEXT NOT NULL, status TEXT NOT NULL, source_note TEXT, created_at INTEGER NOT NULL, created_by TEXT)",
    "CREATE TABLE paper_log_import_rows (id TEXT PRIMARY KEY, batch_id TEXT NOT NULL, row_index INTEGER NOT NULL, status TEXT NOT NULL, source_ref TEXT, confidence INTEGER, type TEXT NOT NULL, started_at INTEGER NOT NULL, ended_at INTEGER, details TEXT, note TEXT, raw_text TEXT, duplicate_activity_id TEXT, imported_activity_id TEXT, created_at INTEGER NOT NULL)",
  ], "write");
  await applyCaretakerImportSchema(client);
}

function insertActivity(
  id: string,
  babyId: string,
  type: string,
  startedAt: number,
  createdBy: string,
) {
  return {
    sql: "INSERT INTO activities VALUES (?, ?, ?, ?, NULL, ?, ?, ?)",
    args: [id, babyId, type, startedAt, JSON.stringify({ notes: id }), startedAt, createdBy],
  };
}

function audit(
  version: 1 | 2,
  activityIds: string[],
  coverage?: { startedAt: number; endedAt: number },
) {
  return JSON.stringify({
    version,
    rowCount: activityIds.length,
    rows: activityIds.map((importedActivityId, rowIndex) => ({
      rowIndex,
      canonicalHash: `hash-${rowIndex}`,
      origin: "caretaker",
      confidence: 0.98,
      status: "committed",
      importedActivityId,
    })),
    ...(version === 2 && coverage ? {
      sleepReconciliation: {
        coverage,
        napsChecked: true,
        napSectionDetected: true,
        authoritativeNapCount: 0,
        retainedExactCount: 0,
        removedCount: 0,
        trimmedCount: 0,
        splitCount: 0,
        insertedCount: 0,
        fingerprint: "synthetic",
        changedActivityHashes: [],
      },
    } : {}),
  });
}

function insertBatch({
  id,
  householdId,
  babyId,
  auditMetadata,
  committedAt = ts(DAY, "18:00"),
  purgedAt = null,
}: {
  id: string;
  householdId: string;
  babyId: string;
  auditMetadata: string;
  committedAt?: number;
  purgedAt?: number | null;
}) {
  return {
    sql: `INSERT INTO paper_log_import_batches
      (id, household_id, baby_id, status, created_at, created_by, source_kind,
       source_hash, expires_at, revision, selected_date, audit_metadata, committed_at, purged_at)
      VALUES (?, ?, ?, 'committed', ?, ?, 'caretaker_screenshot', ?, ?, 2, ?, ?, ?, ?)`,
    args: [
      id,
      householdId,
      babyId,
      committedAt - 1_000,
      "Parent One",
      `source-${id}`,
      ts("2026-10-12", "00:00"),
      DAY,
      auditMetadata,
      committedAt,
      purgedAt,
    ],
  };
}

test("activity GET remains read-only and unchanged when the caretaker schema is absent", async () => {
  const { client, restore } = await openTestDb("no-schema");
  try {
    await createCoreSchema(client);
    await client.execute(insertActivity("ordinary", "baby-1", "note", ts(DAY, "09:00"), "Parent One"));

    const listed = await activitiesFrom(`/api/activities?babyId=baby-1&date=${DAY}`);
    assert.deepEqual(listed.activities.map((row) => row.id), ["ordinary"]);
    assert.equal(listed.activities[0].created_by, "Parent One");
    assert.equal(listed.activities[0].careBoundary, undefined);

    const anonymous = await getActivities(new NextRequest("http://localhost/api/activities?babyId=baby-1"));
    assert.equal(anonymous.status, 200);
    assert.deepEqual(await anonymous.json(), { activities: [] });

    const paperTables = await client.execute({
      sql: "SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'paper_log_import_%'",
      args: [],
    });
    assert.equal(paperTables.rows.length, 0, "a diary read must not create caretaker tables");
  } finally {
    restore();
  }
});

test("committed caretaker audits project childcare attribution and deduplicated read-only care boundaries", async () => {
  const { client, restore } = await openTestDb("projection");
  try {
    await createCoreSchema(client);
    await createCaretakerTables(client);

    const coverage = { startedAt: ts(DAY, "08:00"), endedAt: ts(DAY, "17:00") };
    await client.batch([
      insertActivity("imported-v2", "baby-1", "bottlefeed", ts(DAY, "09:00"), "Parent One"),
      insertActivity("imported-v1", "baby-1", "diaper", ts(DAY, "10:00"), "Parent One"),
      insertActivity("excluded-pointer", "baby-1", "diaper", ts(DAY, "10:30"), "Parent One"),
      insertActivity("ordinary", "baby-1", "note", ts(DAY, "16:00"), "Parent One"),
      insertActivity("sibling-import", "baby-sibling", "diaper", ts(DAY, "11:00"), "Parent One"),
      insertActivity("foreign-import", "baby-foreign", "diaper", ts(DAY, "12:00"), "Parent Two"),
      insertBatch({
        id: "batch-main",
        householdId: "house-1",
        babyId: "baby-1",
        auditMetadata: audit(2, ["imported-v2"], coverage),
        purgedAt: ts(DAY, "19:00"),
      }),
      insertBatch({
        id: "batch-duplicate-window",
        householdId: "house-1",
        babyId: "baby-1",
        auditMetadata: audit(2, ["imported-v2"], coverage),
        committedAt: ts(DAY, "18:30"),
      }),
      insertBatch({
        id: "batch-v1",
        householdId: "house-1",
        babyId: "baby-1",
        auditMetadata: audit(1, ["imported-v1"]),
      }),
      insertBatch({
        id: "batch-sibling",
        householdId: "house-1",
        babyId: "baby-sibling",
        auditMetadata: audit(2, ["sibling-import", "ordinary"], {
          startedAt: ts(DAY, "07:00"),
          endedAt: ts(DAY, "15:00"),
        }),
      }),
      insertBatch({
        id: "batch-foreign",
        householdId: "house-2",
        babyId: "baby-foreign",
        auditMetadata: audit(2, ["foreign-import"], {
          startedAt: ts(DAY, "06:00"),
          endedAt: ts(DAY, "14:00"),
        }),
      }),
      insertBatch({
        id: "batch-malformed",
        householdId: "house-1",
        babyId: "baby-1",
        auditMetadata: "{not-json",
      }),
      insertBatch({
        id: "batch-excluded-pointer",
        householdId: "house-1",
        babyId: "baby-1",
        auditMetadata: JSON.stringify({
          version: 2,
          rows: [{ status: "excluded", importedActivityId: "excluded-pointer" }],
          sleepReconciliation: null,
        }),
      }),
      insertBatch({
        id: "batch-unknown-version",
        householdId: "house-1",
        babyId: "baby-1",
        auditMetadata: JSON.stringify({
          version: 3,
          rows: [{ status: "committed", importedActivityId: "ordinary" }],
          sleepReconciliation: { coverage: { startedAt: ts(DAY, "05:00"), endedAt: ts(DAY, "06:00") } },
        }),
      }),
      insertBatch({
        id: "batch-decimal-coverage",
        householdId: "house-1",
        babyId: "baby-1",
        auditMetadata: audit(2, [], {
          startedAt: ts(DAY, "05:00") + 0.5,
          endedAt: ts(DAY, "06:00"),
        }),
      }),
    ], "write");

    const countsBefore = await Promise.all([
      client.execute("SELECT COUNT(*) AS n FROM activities"),
      client.execute("SELECT COUNT(*) AS n FROM paper_log_import_batches"),
      client.execute("SELECT COUNT(*) AS n FROM paper_log_import_rows"),
    ]);

    const listed = await activitiesFrom(`/api/activities?babyId=baby-1&date=${DAY}`);
    const byId = new Map(listed.activities.map((row) => [row.id, row]));
    assert.equal(byId.get("imported-v2")?.created_by, "childcare", "a purged v2 import keeps display attribution");
    assert.equal(byId.get("imported-v1")?.created_by, "childcare", "known v1 audit IDs keep display attribution");
    assert.equal(byId.get("ordinary")?.created_by, "Parent One", "ordinary attribution is unchanged");
    assert.equal(byId.get("excluded-pointer")?.created_by, "Parent One", "a noncommitted audit row cannot change attribution");
    assert.equal(byId.has("sibling-import"), false, "baby scope excludes sibling activities");
    assert.equal(byId.has("foreign-import"), false, "household scope excludes foreign activities");

    const boundaries = listed.activities.filter((row) => row.careBoundary != null);
    assert.deepEqual(boundaries.map((row) => row.careBoundary).sort(), ["end", "start"], "an identical audited window is projected once");
    for (const boundary of boundaries) {
      assert.equal(boundary.type, "note");
      assert.equal(boundary.created_by, "childcare");
      assert.equal(boundary.baby_id, "baby-1");
      const details = JSON.parse(String(boundary.details)) as { notes?: unknown };
      assert.equal(details.notes, boundary.careBoundary === "start" ? "Care started" : "Care ended");
    }

    const noteOnly = await activitiesFrom(`/api/activities?babyId=baby-1&date=${DAY}&type=note`);
    assert.deepEqual(
      noteOnly.activities.filter((row) => row.careBoundary != null).map((row) => row.careBoundary).sort(),
      ["end", "start"],
      "care boundaries follow the existing note filter",
    );
    assert.ok(noteOnly.activities.every((row) => row.type === "note"));

    const feedsOnly = await activitiesFrom(`/api/activities?babyId=baby-1&date=${DAY}&type=bottlefeed`);
    assert.deepEqual(feedsOnly.activities.map((row) => row.id), ["imported-v2"]);
    assert.equal(feedsOnly.activities[0].created_by, "childcare");
    assert.equal(feedsOnly.activities[0].careBoundary, undefined);

    const otherDay = await activitiesFrom("/api/activities?babyId=baby-1&date=2026-10-06");
    assert.equal(otherDay.activities.length, 0, "the existing SGT date filter excludes other-day boundaries");

    const limited = await activitiesFrom("/api/activities?babyId=baby-1&limit=2");
    assert.equal(limited.activities.length, 2);
    assert.equal(limited.activities[0].careBoundary, "end", "the limit applies after global timeline sorting");
    assert.equal(limited.activities[1].id, "ordinary");

    const countsAfter = await Promise.all([
      client.execute("SELECT COUNT(*) AS n FROM activities"),
      client.execute("SELECT COUNT(*) AS n FROM paper_log_import_batches"),
      client.execute("SELECT COUNT(*) AS n FROM paper_log_import_rows"),
    ]);
    assert.deepEqual(
      countsAfter.map((result) => Number(result.rows[0].n)),
      countsBefore.map((result) => Number(result.rows[0].n)),
      "projecting the diary must not mutate activities or import records",
    );
    const storedCreators = await client.execute("SELECT id, created_by FROM activities ORDER BY id");
    assert.equal(
      storedCreators.rows.find((row) => String(row.id) === "imported-v2")?.created_by,
      "Parent One",
      "childcare attribution is a display projection, not a stored-author rewrite",
    );
  } finally {
    restore();
  }
});
