import assert from "node:assert/strict";
import test from "node:test";
import { createClient, type Client } from "@libsql/client";
import { NextRequest } from "next/server";

import { DELETE, PUT } from "./route";
import { GET as getActivities, DELETE as deleteActivity, PUT as putActivity } from "@/app/api/activities/route";
import { GET as exportActivities } from "@/app/api/activities/export/route";
import { readActivityTimeline } from "@/lib/activity-timeline";
import { parseHistoricalMedicationDetails } from "@/lib/historical-medication";

const ts = (time: string) => Date.parse(`2026-10-06T${time}:00+08:00`);

function request(
  method: string,
  path: string,
  body?: Record<string, unknown>,
  { household = "house-1", user = "user-1" }: { household?: string | null; user?: string | null } = {},
) {
  const headers = new Headers();
  if (household) headers.set("cookie", `mcphee_hh=${household}${user ? `; mcphee_user=${user}` : ""}`);
  if (body) headers.set("content-type", "application/json");
  return new NextRequest(`http://localhost${path}`, {
    method,
    headers,
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

async function openTestDb(prefix: string) {
  const savedUrl = process.env.TURSO_DATABASE_URL;
  const savedToken = process.env.TURSO_AUTH_TOKEN;
  const dbPath = `/tmp/mcphee-historical-medication-api-${prefix}-${process.pid}-${Math.random().toString(36).slice(2)}.db`;
  process.env.TURSO_DATABASE_URL = `file:${dbPath}`;
  delete process.env.TURSO_AUTH_TOKEN;
  const client = createClient({ url: `file:${dbPath}` });
  const restore = () => {
    client.close();
    if (savedUrl === undefined) delete process.env.TURSO_DATABASE_URL;
    else process.env.TURSO_DATABASE_URL = savedUrl;
    if (savedToken === undefined) delete process.env.TURSO_AUTH_TOKEN;
    else process.env.TURSO_AUTH_TOKEN = savedToken;
  };
  return { client, restore };
}

async function seed(client: Client) {
  await client.batch([
    "CREATE TABLE households (id TEXT PRIMARY KEY, invite_code TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL)",
    "CREATE TABLE users (id TEXT PRIMARY KEY, household_id TEXT NOT NULL, name TEXT NOT NULL, created_at INTEGER NOT NULL)",
    "CREATE TABLE babies (id TEXT PRIMARY KEY, household_id TEXT NOT NULL, name TEXT NOT NULL, birth_date INTEGER, created_at INTEGER NOT NULL)",
    "CREATE TABLE activities (id TEXT PRIMARY KEY, baby_id TEXT NOT NULL, type TEXT NOT NULL, started_at INTEGER NOT NULL, ended_at INTEGER, details TEXT, created_at INTEGER NOT NULL, created_by TEXT)",
    "CREATE TABLE paper_log_import_batches (id TEXT PRIMARY KEY, household_id TEXT, baby_id TEXT, status TEXT, source_note TEXT, created_at INTEGER, created_by TEXT)",
    "CREATE TABLE paper_log_import_rows (id TEXT PRIMARY KEY, batch_id TEXT, row_index INTEGER, status TEXT, source_ref TEXT, confidence INTEGER, type TEXT, started_at INTEGER, ended_at INTEGER, details TEXT, note TEXT, raw_text TEXT, duplicate_activity_id TEXT, imported_activity_id TEXT, created_at INTEGER)",
  ], "write");
  await client.batch([
    { sql: "INSERT INTO households VALUES (?, ?, ?)", args: ["house-1", "ABC123", ts("00:00")] },
    { sql: "INSERT INTO households VALUES (?, ?, ?)", args: ["house-2", "XYZ789", ts("00:00")] },
    { sql: "INSERT INTO users VALUES (?, ?, ?, ?)", args: ["user-1", "house-1", "Parent One", ts("00:00")] },
    { sql: "INSERT INTO babies VALUES (?, ?, ?, NULL, ?)", args: ["baby-1", "house-1", "Baby One", ts("00:00")] },
    { sql: "INSERT INTO babies VALUES (?, ?, ?, NULL, ?)", args: ["baby-2", "house-2", "Baby Two", ts("00:00")] },
  ], "write");
}

function historicalDetails(
  kind: "medication" | "procedure" = "medication",
  deletedAt?: number,
) {
  return {
    medicationName: kind === "procedure" ? "Suction" : "Paracetamol",
    doseText: kind === "procedure" ? "" : "3.5 ml",
    notes: kind === "procedure" ? "Suction completed" : "Paracetamol 3.5ml",
    historicalMedication: {
      version: 1,
      eventKind: kind,
      sourceActivityId: kind === "procedure" ? "source-suction" : "source-med",
      sourceStartedAt: ts(kind === "procedure" ? "08:00" : "09:00"),
      sourceDetailsSha256: (kind === "procedure" ? "b" : "a").repeat(64),
      matchOrdinal: 0,
      importKey: kind === "procedure" ? "hm1:suction" : "hm1:med",
      revision: deletedAt ? 2 : 1,
      ...(deletedAt ? { deletedAt, deletedBy: "Parent One" } : {}),
    },
  };
}

async function insertActivity(
  client: Client,
  id: string,
  babyId: string,
  type: string,
  startedAt: number,
  details: Record<string, unknown>,
) {
  await client.execute({
    sql: "INSERT INTO activities VALUES (?, ?, ?, ?, NULL, ?, ?, ?)",
    args: [id, babyId, type, startedAt, JSON.stringify(details), startedAt, "Parent One"],
  });
}

test("standalone historical medication updates are household scoped, CAS protected, and not episode-bound", async () => {
  const { client, restore } = await openTestDb("put");
  try {
    await seed(client);
    await insertActivity(client, "source-med", "baby-1", "note", ts("09:00"), { notes: "Paracetamol 3.5ml" });
    await insertActivity(client, "hist-med", "baby-1", "medication", ts("09:00"), historicalDetails());

    const outsideAnyEpisode = ts("06:15");
    const updated = await PUT(request("PUT", "/api/historical-medications", {
      babyId: "baby-1", id: "hist-med", expectedRevision: 1,
      givenAt: outsideAnyEpisode, doseText: "3.5 ml corrected",
    }));
    assert.equal(updated.status, 200);
    assert.deepEqual(await updated.json(), { ok: true, id: "hist-med", revision: 2 });

    const stored = await client.execute("SELECT started_at, details FROM activities WHERE id = 'hist-med'");
    assert.equal(Number(stored.rows[0].started_at), outsideAnyEpisode);
    const details = JSON.parse(String(stored.rows[0].details));
    assert.equal(details.doseText, "3.5 ml corrected");
    assert.equal(details.medicationName, "Paracetamol", "name is immutable");
    assert.equal(details.notes, "Paracetamol 3.5ml", "literal source note is retained");
    assert.equal(details.historicalMedication.sourceActivityId, "source-med");
    assert.equal(details.historicalMedication.revision, 2);
    assert.equal(String((await client.execute("SELECT details FROM activities WHERE id = 'source-med'")).rows[0].details), JSON.stringify({ notes: "Paracetamol 3.5ml" }));

    const stale = await PUT(request("PUT", "/api/historical-medications", {
      babyId: "baby-1", id: "hist-med", expectedRevision: 1,
      givenAt: ts("07:00"), doseText: "4 ml",
    }));
    assert.equal(stale.status, 409);
    const foreign = await PUT(request("PUT", "/api/historical-medications", {
      babyId: "baby-1", id: "hist-med", expectedRevision: 2,
      givenAt: ts("07:00"), doseText: "4 ml",
    }, { household: "house-2" }));
    assert.equal(foreign.status, 404);
    const future = await PUT(request("PUT", "/api/historical-medications", {
      babyId: "baby-1", id: "hist-med", expectedRevision: 2,
      givenAt: Date.now() + 30 * 1000, doseText: "4 ml",
    }));
    assert.equal(future.status, 400);

    const malformed = await PUT(new NextRequest("http://localhost/api/historical-medications", {
      method: "PUT",
      headers: { cookie: "mcphee_hh=house-1; mcphee_user=user-1", "content-type": "application/json" },
      body: "{",
    }));
    assert.equal(malformed.status, 400);
    assert.match(String((await malformed.json()).error), /valid json/i);
  } finally {
    restore();
  }
});

test("procedures stay dose-free and soft deletion preserves the source while timeline limits count visible rows", async () => {
  const { client, restore } = await openTestDb("delete");
  try {
    await seed(client);
    await insertActivity(client, "source-suction", "baby-1", "note", ts("08:00"), { notes: "Suction completed" });
    await insertActivity(client, "older-note", "baby-1", "note", ts("07:00"), { notes: "Visible next row" });
    await insertActivity(client, "hist-suction", "baby-1", "medication", ts("08:00"), historicalDetails("procedure"));

    const nonempty = await PUT(request("PUT", "/api/historical-medications", {
      babyId: "baby-1", id: "hist-suction", expectedRevision: 1,
      givenAt: ts("08:05"), doseText: "5 ml",
    }));
    assert.equal(nonempty.status, 400);
    const valid = await PUT(request("PUT", "/api/historical-medications", {
      babyId: "baby-1", id: "hist-suction", expectedRevision: 1,
      givenAt: ts("08:05"), doseText: "",
    }));
    assert.equal(valid.status, 200);

    const removed = await DELETE(request("DELETE", "/api/historical-medications", {
      babyId: "baby-1", id: "hist-suction", expectedRevision: 2,
    }));
    assert.equal(removed.status, 200);
    assert.equal(Number((await client.execute("SELECT COUNT(*) AS n FROM activities WHERE id = 'hist-suction'")).rows[0].n), 1, "soft delete retains imported row");
    assert.equal(Number((await client.execute("SELECT COUNT(*) AS n FROM activities WHERE id = 'source-suction'")).rows[0].n), 1, "source note is untouched");

    const timeline = await getActivities(request("GET", "/api/activities?babyId=baby-1&type=medication&limit=all"));
    assert.equal(timeline.status, 200);
    assert.deepEqual((await timeline.json()).activities, []);

    const limited = await getActivities(request("GET", "/api/activities?babyId=baby-1&limit=1"));
    assert.equal(limited.status, 200);
    assert.equal((await limited.json()).activities[0].id, "source-suction", "deleted newest row does not consume the visible limit");

    const csv = await exportActivities(request("GET", "/api/activities/export?babyId=baby-1"));
    assert.equal(csv.status, 200);
    assert.equal((await csv.text()).includes("hist-suction"), false);
  } finally {
    restore();
  }
});

test("generic activity mutation endpoints cannot bypass historical medication provenance", async () => {
  const { client, restore } = await openTestDb("guard");
  try {
    await seed(client);
    await insertActivity(client, "source-med", "baby-1", "note", ts("09:00"), { notes: "Paracetamol 3.5ml" });
    await insertActivity(client, "hist-med", "baby-1", "medication", ts("09:00"), historicalDetails());

    const genericPut = await putActivity(request("PUT", "/api/activities", {
      id: "hist-med", babyId: "baby-1", type: "note", startedAt: ts("10:00"), details: { notes: "overwrite" },
    }));
    assert.equal(genericPut.status, 400);
    assert.match(String((await genericPut.json()).error), /historical medication editor/i);
    const genericDelete = await deleteActivity(request("DELETE", "/api/activities?id=hist-med"));
    assert.equal(genericDelete.status, 400);
    assert.match(String((await genericDelete.json()).error), /historical medication editor/i);

    const stored = await client.execute("SELECT type, details FROM activities WHERE id = 'hist-med'");
    assert.equal(stored.rows.length, 1);
    assert.equal(String(stored.rows[0].type), "medication");
    assert.ok(parseHistoricalMedicationDetails(stored.rows[0].details));
    const direct = await readActivityTimeline(client, "house-1", { babyId: "baby-1", types: ["medication"], limit: 1 });
    assert.equal(direct.length, 1);
    const listed = await getActivities(request("GET", "/api/activities?babyId=baby-1&type=medication&limit=1"));
    assert.equal(listed.status, 200);
    const payload = await listed.json();
    assert.equal(payload.activities.length, 1, JSON.stringify(payload));
    const activity = payload.activities[0];
    assert.equal(activity.id, "hist-med");
    assert.equal(activity.historicalMedication.activityId, "hist-med");
    assert.equal(activity.historicalMedication.originalNote, "Paracetamol 3.5ml");

    const csvResponse = await exportActivities(request("GET", "/api/activities/export?babyId=baby-1"));
    assert.equal(csvResponse.status, 200);
    const csv = await csvResponse.text();
    assert.ok(csv.includes("hist-med"));
    assert.ok(csv.includes("Paracetamol"));
    assert.ok(csv.includes("3.5 ml"));
    assert.ok(csv.includes("Paracetamol 3.5ml"));
  } finally {
    restore();
  }
});
