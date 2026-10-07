import assert from "node:assert/strict";
import test from "node:test";
import { createClient, type Client } from "@libsql/client";
import { NextRequest } from "next/server";

import {
  SICK_MODE_TABLES,
  applySickModeSchema,
  isSickModeSchemaReady,
} from "@/db/sick-mode-schema";
import { GET as getActivities, POST as postActivity } from "./route";
import { GET as exportActivities } from "@/app/api/activities/export/route";

const ts = (date: string, time = "12:00") => Date.parse(`${date}T${time}:00+08:00`);
const DAY = "2026-10-05";

type MedicationDoseReference = {
  doseId: string;
  medicationId: string;
  episodeId: string;
  revision: number;
  medicationName: string;
  doseText: string;
  episodeStartedAt: number;
  episodeEndedAt: number | null;
};

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
  medicationDose?: MedicationDoseReference;
};

function request(
  path: string,
  opts: { household?: string | null; user?: string | null } = {},
) {
  const headers = new Headers();
  const { household = "house-1", user = "user-1" } = opts;
  if (household != null) {
    headers.set("cookie", `mcphee_hh=${household}${user ? `; mcphee_user=${user}` : ""}`);
  }
  return new NextRequest(`http://localhost${path}`, { headers });
}

async function activitiesFrom(path: string, opts?: { household?: string | null }) {
  const response = await getActivities(request(path, opts));
  assert.equal(response.status, 200);
  return (await response.json()) as { activities: ActivityRecord[] };
}

async function count(client: Client, table: string): Promise<number> {
  const result = await client.execute(`SELECT COUNT(*) AS n FROM ${table}`);
  return Number(result.rows[0].n);
}

/** Synthetic, in-memory-by-file SQLite fixture. No real DB, no full migrate. */
async function openTestDb(prefix: string) {
  const savedUrl = process.env.TURSO_DATABASE_URL;
  const savedToken = process.env.TURSO_AUTH_TOKEN;
  const dbPath = `/tmp/mcphee-activities-${prefix}-${process.pid}-${Math.random().toString(36).slice(2)}.db`;
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

async function createBaseSchema(client: Client) {
  await client.batch([
    "CREATE TABLE households (id TEXT PRIMARY KEY, invite_code TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL)",
    "CREATE TABLE users (id TEXT PRIMARY KEY, household_id TEXT NOT NULL, name TEXT NOT NULL, created_at INTEGER NOT NULL)",
    "CREATE TABLE babies (id TEXT PRIMARY KEY, household_id TEXT NOT NULL, name TEXT NOT NULL, birth_date INTEGER, created_at INTEGER NOT NULL)",
    "CREATE TABLE activities (id TEXT PRIMARY KEY, baby_id TEXT NOT NULL, type TEXT NOT NULL, started_at INTEGER NOT NULL, ended_at INTEGER, details TEXT, created_at INTEGER NOT NULL, created_by TEXT)",
  ], "write");
  await client.batch([
    { sql: "INSERT INTO households VALUES (?, ?, ?)", args: ["house-1", "ABC123", ts("2026-10-01")] },
    { sql: "INSERT INTO households VALUES (?, ?, ?)", args: ["house-2", "XYZ789", ts("2026-10-01")] },
    { sql: "INSERT INTO users VALUES (?, ?, ?, ?)", args: ["user-1", "house-1", "Parent One", ts("2026-10-01")] },
    { sql: "INSERT INTO users VALUES (?, ?, ?, ?)", args: ["user-2", "house-2", "Parent Two", ts("2026-10-01")] },
    { sql: "INSERT INTO babies VALUES (?, ?, ?, NULL, ?)", args: ["baby-1", "house-1", "Baby One", ts("2026-10-01")] },
    { sql: "INSERT INTO babies VALUES (?, ?, ?, NULL, ?)", args: ["baby-2", "house-1", "Baby Two", ts("2026-10-01")] },
    { sql: "INSERT INTO babies VALUES (?, ?, ?, NULL, ?)", args: ["foreign-baby", "house-2", "Other Baby", ts("2026-10-01")] },
  ], "write");
}

function insertActivity(
  id: string,
  babyId: string,
  type: string,
  startedAt: number,
  endedAt: number | null,
  details: Record<string, unknown>,
  createdAt = startedAt,
  createdBy: string | null = "Parent One",
) {
  return {
    sql: "INSERT INTO activities VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    args: [id, babyId, type, startedAt, endedAt, JSON.stringify(details), createdAt, createdBy] as Array<string | number | null>,
  };
}

test("GET returns ordinary records and every bank transfer unchanged, without implicit sick-mode schema or backfill", async () => {
  const { client, restore } = await openTestDb("ordinary");
  try {
    await createBaseSchema(client);

    const endOfDay = Date.parse("2026-10-05T23:59:59.999+08:00");
    await client.batch([
      insertActivity("note-in", "baby-1", "note", ts(DAY, "08:00"), null, { notes: "hello" }),
      insertActivity("diaper-in", "baby-1", "diaper", ts(DAY, "09:00"), null, { peeUnits: "1" }),
      insertActivity("bank-freeze", "baby-1", "bankfreeze", ts(DAY, "10:00"), null, { amount: 120 }),
      insertActivity("bank-thaw", "baby-1", "bankthaw", ts(DAY, "10:30"), null, { amount: 60 }),
      insertActivity("bank-discard", "baby-1", "bankdiscard", ts(DAY, "11:00"), null, { amount: 30 }),
      insertActivity("bank-adjust", "baby-1", "bankadjust", ts(DAY, "11:30"), null, { amount: 5, targetBankMl: 100 }),
      insertActivity("boundary-start", "baby-1", "note", ts(DAY, "00:00"), null, { notes: "start inclusive" }),
      insertActivity("boundary-end", "baby-1", "note", endOfDay, null, { notes: "end exclusive" }),
      insertActivity("prev-day", "baby-1", "note", ts("2026-10-04", "23:59"), null, { notes: "before" }),
      insertActivity("next-day", "baby-1", "note", ts("2026-10-06", "00:00"), null, { notes: "after" }),
      insertActivity("crossmidnight-sleep", "baby-1", "sleep", ts("2026-10-04", "23:00"), ts(DAY, "06:00"), {}),
      insertActivity("early-sleep", "baby-1", "sleep", ts(DAY, "01:00"), ts(DAY, "02:00"), {}),
      insertActivity("sibling-note", "baby-2", "note", ts(DAY, "08:30"), null, { notes: "sibling" }),
      insertActivity("foreign-note", "foreign-baby", "note", ts(DAY, "08:45"), null, { notes: "foreign" }),
    ], "write");

    const before = await count(client, "activities");

    // No cookie: an empty (not unauthorized) timeline.
    const anonymous = await getActivities(request("/api/activities", { household: null }));
    assert.equal(anonymous.status, 200);
    assert.deepEqual(await anonymous.json(), { activities: [] });

    const listed = await activitiesFrom(`/api/activities?babyId=baby-1&date=${DAY}`);
    const ids = new Set(listed.activities.map((record) => record.id));
    for (const expected of [
      "note-in", "diaper-in", "bank-freeze", "bank-thaw", "bank-discard", "bank-adjust",
      "boundary-start", "boundary-end", "crossmidnight-sleep", "early-sleep",
    ]) {
      assert.ok(ids.has(expected), `expected ${expected} in the SGT day window`);
    }
    for (const excluded of ["prev-day", "next-day", "sibling-note", "foreign-note"]) {
      assert.equal(ids.has(excluded), false, `${excluded} must be excluded by babyId/date`);
    }
    assert.ok(listed.activities.every((record) => record.baby_id === "baby-1"));

    // Ordinary records survive the read verbatim.
    const note = listed.activities.find((record) => record.id === "note-in")!;
    assert.deepEqual(
      {
        baby_id: note.baby_id,
        type: note.type,
        started_at: note.started_at,
        ended_at: note.ended_at,
        details: note.details,
        created_at: note.created_at,
        created_by: note.created_by,
        baby_name: note.baby_name,
        medicationDose: note.medicationDose,
      },
      {
        baby_id: "baby-1",
        type: "note",
        started_at: ts(DAY, "08:00"),
        ended_at: null,
        details: JSON.stringify({ notes: "hello" }),
        created_at: ts(DAY, "08:00"),
        created_by: "Parent One",
        baby_name: "Baby One",
        medicationDose: undefined,
      },
    );

    // Every specialized bank-transfer type is projected by the generic timeline filter.
    const transfers = await activitiesFrom(`/api/activities?babyId=baby-1&type=bankfreeze&type=bankthaw&type=bankdiscard`);
    assert.deepEqual(
      transfers.activities.map((record) => record.id).sort(),
      ["bank-discard", "bank-freeze", "bank-thaw"],
    );
    assert.ok(transfers.activities.every((record) => record.type.startsWith("bank")));

    // Invalid types and dates are rejected consistently by the API.
    const badType = await getActivities(request("/api/activities?babyId=baby-1&type=teleport"));
    assert.equal(badType.status, 400);
    const badDate = await getActivities(request("/api/activities?babyId=baby-1&date=nope"));
    assert.equal(badDate.status, 400);
    const impossibleDate = await getActivities(request(`/api/activities?babyId=baby-1&date=2026-13-99`));
    assert.equal(impossibleDate.status, 400);

    // Reading never creates the sick-mode schema and never inserts/backfills activities.
    assert.equal(await isSickModeSchemaReady(client), false);
    const placeholders = SICK_MODE_TABLES.map(() => "?").join(", ");
    const sickTables = await client.execute({
      sql: `SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (${placeholders})`,
      args: [...SICK_MODE_TABLES],
    });
    assert.equal(sickTables.rows.length, 0, "GET must not create sick-mode tables implicitly");
    assert.equal(await count(client, "activities"), before, "reading must not write activities");

    // Export requires auth but still carries every bank event for an owned baby.
    const unauthExport = await exportActivities(request("/api/activities/export?babyId=baby-1", { household: null }));
    assert.equal(unauthExport.status, 401);
    const csvResponse = await exportActivities(request("/api/activities/export?babyId=baby-1&date=" + DAY));
    assert.equal(csvResponse.status, 200);
    const csv = await csvResponse.text();
    for (const label of ["Milk frozen", "Milk thawed", "Frozen milk discarded", "Bank adjustment"]) {
      assert.ok(csv.includes(label), `CSV must include ${label}`);
    }
  } finally {
    restore();
  }
});

test("medication doses project through medication->episode->baby->household with a namespaced id and pointer fields", async () => {
  const { client, restore } = await openTestDb("medication");
  try {
    await createBaseSchema(client);
    await applySickModeSchema(client);

    await client.batch([
      { sql: "INSERT INTO sick_mode_episodes VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        args: ["ep-active", "baby-1", ts("2026-10-01", "08:00"), null, 800, "manual", 0, "[]", ts("2026-10-01", "08:00"), "Parent One", null] },
      { sql: "INSERT INTO sick_mode_episodes VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        args: ["ep-ended", "baby-1", ts("2026-09-20", "08:00"), ts("2026-09-25", "20:00"), 700, "manual", 0, "[]", ts("2026-09-20", "08:00"), "Parent One", "Parent One"] },
      { sql: "INSERT INTO sick_mode_episodes VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        args: ["ep-sibling", "baby-2", ts("2026-10-01", "08:00"), null, 800, "manual", 0, "[]", ts("2026-10-01", "08:00"), "Parent One", null] },
      { sql: "INSERT INTO sick_mode_episodes VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        args: ["ep-foreign", "foreign-baby", ts("2026-10-01", "08:00"), null, 800, "manual", 0, "[]", ts("2026-10-01", "08:00"), "Parent Two", null] },
    ], "write");

    await client.batch([
      { sql: "INSERT INTO sick_mode_medications VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        args: ["med-a", "ep-active", "Paracetamol", "3.5ml", 1, 240, 360, ts("2026-10-01", "08:00"), "Parent One", ts("2026-10-01", "08:00"), 1] },
      { sql: "INSERT INTO sick_mode_medications VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        args: ["med-b", "ep-ended", "Ibuprofen", "5ml", 1, 240, 360, ts("2026-09-20", "08:00"), "Parent One", ts("2026-09-20", "08:00"), 1] },
      { sql: "INSERT INTO sick_mode_medications VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        args: ["med-c", "ep-sibling", "Sibling Med", "2ml", 1, 240, 360, ts("2026-10-01", "08:00"), "Parent One", ts("2026-10-01", "08:00"), 1] },
      { sql: "INSERT INTO sick_mode_medications VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        args: ["med-d", "ep-foreign", "Foreign Med", "2ml", 1, 240, 360, ts("2026-10-01", "08:00"), "Parent Two", ts("2026-10-01", "08:00"), 1] },
    ], "write");

    await client.batch([
      { sql: "INSERT INTO sick_mode_doses VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        args: ["dose-a1", "med-a", ts(DAY, "10:00"), "3.5ml", "Parent One", "req-a1", ts(DAY, "10:00"), ts(DAY, "10:00"), 1, null, null] },
      { sql: "INSERT INTO sick_mode_doses VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        args: ["dose-a2", "med-a", ts(DAY, "14:00"), "4ml", "Parent One", "req-a2", ts(DAY, "14:00"), ts(DAY, "14:00"), 1, null, null] },
      { sql: "INSERT INTO sick_mode_doses VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        args: ["dose-a3", "med-a", ts("2026-10-04", "09:00"), "3ml", "Parent One", "req-a3", ts("2026-10-04", "09:00"), ts("2026-10-04", "09:00"), 1, null, null] },
      { sql: "INSERT INTO sick_mode_doses VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        args: ["dose-b1", "med-b", ts(DAY, "11:00"), "5ml", "Parent One", "req-b1", ts(DAY, "11:00"), ts(DAY, "11:00"), 1, null, null] },
      { sql: "INSERT INTO sick_mode_doses VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        args: ["dose-c1", "med-c", ts(DAY, "12:00"), "2ml", "Parent One", "req-c1", ts(DAY, "12:00"), ts(DAY, "12:00"), 1, null, null] },
      { sql: "INSERT INTO sick_mode_doses VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        args: ["dose-d1", "med-d", ts(DAY, "12:30"), "2ml", "Parent Two", "req-d1", ts(DAY, "12:30"), ts(DAY, "12:30"), 1, null, null] },
      { sql: "INSERT INTO sick_mode_doses VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        args: ["dose-deleted", "med-a", ts(DAY, "15:00"), "9ml", "Parent One", "req-del", ts(DAY, "15:00"), ts(DAY, "15:00"), 2, ts(DAY, "15:30"), "Parent One"] },
    ], "write");

    const day = await activitiesFrom(`/api/activities?babyId=baby-1&date=${DAY}`);
    const doses = day.activities.filter((record) => record.type === "medication");
    assert.deepEqual(
      doses.map((record) => record.id).sort(),
      ["medication-dose:dose-a1", "medication-dose:dose-a2", "medication-dose:dose-b1"],
      "active doses for this baby/day only, including the ended episode; soft-deleted, sibling and foreign rows excluded",
    );
    assert.ok(day.activities.every((record) => record.baby_id === "baby-1"));

    const first = doses.find((record) => record.id === "medication-dose:dose-a1")!;
    assert.equal(first.type, "medication");
    assert.equal(first.started_at, ts(DAY, "10:00"), "givenAt is retained as started_at");
    assert.equal(first.ended_at, null);
    assert.equal(first.created_by, "Parent One", "caregiver is retained as created_by");
    assert.deepEqual(JSON.parse(String(first.details)), { medicationName: "Paracetamol", doseText: "3.5ml" });
    assert.deepEqual(first.medicationDose, {
      doseId: "dose-a1",
      medicationId: "med-a",
      episodeId: "ep-active",
      revision: 1,
      medicationName: "Paracetamol",
      doseText: "3.5ml",
      episodeStartedAt: ts("2026-10-01", "08:00"),
      episodeEndedAt: null,
    });
    const endedEpisodeDose = doses.find((record) => record.id === "medication-dose:dose-b1")!;
    assert.equal(endedEpisodeDose.medicationDose?.episodeEndedAt, ts("2026-09-25", "20:00"));

    // Only medication is returned when the caller asks for only medication.
    const medicationOnly = await activitiesFrom(`/api/activities?babyId=baby-1&type=medication`);
    assert.ok(medicationOnly.activities.every((record) => record.type === "medication"));
    assert.equal(medicationOnly.activities.some((record) => record.id === "medication-dose:dose-a3"), true, "older date retained without a date filter");

    // Direct synthetic edits (bumping revisions) must flow through, with no duplicated projection.
    await client.batch([
      { sql: "UPDATE sick_mode_doses SET given_at = ?, dose_text = ?, revision = revision + 1, updated_at = ? WHERE id = ?",
        args: [ts(DAY, "09:15"), "4ml", ts(DAY, "16:00"), "dose-a1"] },
      { sql: "UPDATE sick_mode_medications SET name = ?, revision = revision + 1, updated_at = ? WHERE id = ?",
        args: ["Paracetamol (revised)", ts(DAY, "16:00"), "med-a"] },
    ], "write");

    const updated = await activitiesFrom(`/api/activities?babyId=baby-1&date=${DAY}`);
    const updatedDoses = updated.activities.filter((record) => record.type === "medication");
    assert.equal(updatedDoses.length, 3, "edits must not duplicate projected rows");
    const revised = updatedDoses.find((record) => record.id === "medication-dose:dose-a1")!;
    assert.equal(revised.started_at, ts(DAY, "09:15"));
    assert.deepEqual(JSON.parse(String(revised.details)), { medicationName: "Paracetamol (revised)", doseText: "4ml" });
    assert.equal(revised.medicationDose?.revision, 2, "dose revision incremented");
    assert.equal(revised.medicationDose?.medicationName, "Paracetamol (revised)");
    assert.equal(revised.medicationDose?.doseText, "4ml");

    // Sick mode off (no active episode) still projects historical doses.
    await client.execute({
      sql: "UPDATE sick_mode_episodes SET ended_at = ?, ended_by = ? WHERE id = ?",
      args: [ts("2026-10-06", "09:00"), "Parent One", "ep-active"],
    });
    const afterEnd = await activitiesFrom(`/api/activities?babyId=baby-1&date=${DAY}`);
    assert.equal(
      afterEnd.activities.filter((record) => record.type === "medication").length,
      3,
      "ending the episode must not hide its doses",
    );
    assert.ok(afterEnd.activities.every((record) => record.baby_id === "baby-1"));

    // Sick-mode doses are a projection: none of the reads above may create activity rows.
    assert.equal(await count(client, "activities"), 0, "reads never insert/backfill activity rows");

    // Mixed ordinary + medication filter is globally sorted, and the limit applies after the merge.
    await client.batch([
      insertActivity("note-1", "baby-1", "note", ts(DAY, "09:00"), null, { notes: "one" }),
      insertActivity("note-2", "baby-1", "note", ts(DAY, "13:00"), null, { notes: "two" }),
    ], "write");

    const mixed = await activitiesFrom(`/api/activities?babyId=baby-1&date=${DAY}&type=note&type=medication`);
    const times = mixed.activities.map((record) => record.started_at);
    assert.deepEqual([...times].sort((a, b) => b - a), times, "merged sources must be globally sorted newest-first");
    assert.ok(mixed.activities.some((record) => record.type === "note"));
    assert.ok(mixed.activities.some((record) => record.type === "medication"));

    const limited = await activitiesFrom(`/api/activities?babyId=baby-1&date=${DAY}&type=note&type=medication&limit=2`);
    assert.deepEqual(
      limited.activities.map((record) => record.id),
      ["medication-dose:dose-a2", "note-2"],
      "the limit is applied to the globally sorted union",
    );

    assert.equal(await count(client, "activities"), 2, "merged reads must not insert/backfill activity rows");

    // CSV export carries the medication name, actual dose, caregiver, and all bank events.
    await client.batch([
      insertActivity("bank-freeze", "baby-1", "bankfreeze", ts("2026-10-04", "10:00"), null, { amount: 120 }),
      insertActivity("bank-thaw", "baby-1", "bankthaw", ts("2026-10-04", "10:30"), null, { amount: 60 }),
      insertActivity("bank-discard", "baby-1", "bankdiscard", ts("2026-10-04", "11:00"), null, { amount: 30 }),
    ], "write");
    const beforeExport = await count(client, "activities");
    assert.equal(beforeExport, 5);
    const csvResponse = await exportActivities(request("/api/activities/export?babyId=baby-1"));
    assert.equal(csvResponse.status, 200);
    const csv = await csvResponse.text();
    assert.ok(csv.includes("Paracetamol (revised)"), "CSV must include the medication name");
    assert.ok(csv.includes("4ml"), "CSV must include the actual dose text");
    assert.ok(csv.includes("Parent One"), "CSV must include the caregiver");
    assert.ok(csv.includes("Milk frozen"));
    assert.ok(csv.includes("Milk thawed"));
    assert.ok(csv.includes("Frozen milk discarded"));
    assert.equal(await count(client, "activities"), beforeExport, "export must not insert/backfill activity rows");
  } finally {
    restore();
  }
});

test("limit clamps to 500 and 'all' returns the full merged set", async () => {
  const { client, restore } = await openTestDb("limit");
  try {
    await createBaseSchema(client);
    const base = ts(DAY, "00:00");
    const rows = Array.from({ length: 510 }, (_, index) =>
      insertActivity(
        `diaper-${String(index).padStart(3, "0")}`,
        "baby-1",
        "diaper",
        base + index * 60_000,
        null,
        { peeUnits: "1" },
        base + index,
      ),
    );
    await client.batch(rows, "write");

    const clamped = await activitiesFrom(`/api/activities?babyId=baby-1&type=diaper&date=${DAY}&limit=99999`);
    assert.equal(clamped.activities.length, 500);
    assert.equal(clamped.activities[0].id, "diaper-509", "newest row is first after clamping");

    const all = await activitiesFrom(`/api/activities?babyId=baby-1&type=diaper&date=${DAY}&limit=all`);
    assert.equal(all.activities.length, 510);
  } finally {
    restore();
  }
});

test("ordinary POST rejects medication and bank transfers; unauthenticated writes are 401", async () => {
  const { client, restore } = await openTestDb("post");
  try {
    await createBaseSchema(client);
    const before = await count(client, "activities");

    for (const type of ["medication", "bankfreeze", "bankthaw", "bankdiscard"]) {
      const response = await postActivity(
        new NextRequest("http://localhost/api/activities", {
          method: "POST",
          headers: { cookie: "mcphee_hh=house-1; mcphee_user=user-1", "content-type": "application/json" },
          body: JSON.stringify({ babyId: "baby-1", type, startedAt: ts(DAY, "09:00") }),
        }),
      );
      assert.equal(response.status, 400, `${type} must be rejected by the generic write path`);
      const body = (await response.json()) as { error?: string };
      assert.equal(typeof body.error, "string");
    }

    const unauth = await postActivity(
      new NextRequest("http://localhost/api/activities", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ babyId: "baby-1", type: "bottlefeed", startedAt: ts(DAY, "09:00") }),
      }),
    );
    assert.equal(unauth.status, 401);

    assert.equal(await count(client, "activities"), before, "rejected writes must not persist rows");
  } finally {
    restore();
  }
});
