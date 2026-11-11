import assert from "node:assert/strict";
import test from "node:test";
import { createClient, type Client } from "@libsql/client";
import { NextRequest } from "next/server";

import { createDB } from "@/db";
import { applyCaretakerImportSchema } from "@/db/caretaker-import-schema";
import { POST as sleepState } from "@/app/api/sleep-state/route";
import { POST } from "./route";

let clock = Date.parse("2026-11-10T02:00:00+08:00");

function request(url: string, body: unknown, household = "house") {
  return new NextRequest(`http://localhost${url}`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: `mcphee_hh=${household}; mcphee_user=member` },
    body: JSON.stringify(body),
  });
}

const blip = (body: Record<string, unknown>, household?: string) =>
  POST(request("/api/sleep-blips", { babyId: "baby", ...body }, household));
const sleep = (body: Record<string, unknown>) =>
  sleepState(request("/api/sleep-state", { babyId: "baby", ...body }));

async function blipRows(db: Client) {
  const result = await db.execute("SELECT id, started_at, ended_at, details, created_by FROM activities WHERE type = 'sleepblip' ORDER BY started_at");
  return result.rows.map((row) => ({
    id: String(row.id),
    startedAt: Number(row.started_at),
    endedAt: row.ended_at == null ? null : Number(row.ended_at),
    ending: JSON.parse(String(row.details ?? "{}")).ending ?? null,
    createdBy: row.created_by,
  }));
}

async function fixture(run: (db: Client) => Promise<void>, { asleep = true } = {}) {
  const previous = { url: process.env.TURSO_DATABASE_URL, token: process.env.TURSO_AUTH_TOKEN, now: Date.now };
  const url = `file:/tmp/mcphee-blips-${process.pid}-${Math.random().toString(36).slice(2)}.db`;
  process.env.TURSO_DATABASE_URL = url;
  delete process.env.TURSO_AUTH_TOKEN;
  clock = Date.parse("2026-11-10T02:00:00+08:00");
  Date.now = () => clock;
  const db = createClient({ url });
  try {
    for (const sql of [
      "CREATE TABLE households (id TEXT PRIMARY KEY, invite_code TEXT, created_at INTEGER)",
      "CREATE TABLE users (id TEXT PRIMARY KEY, household_id TEXT, name TEXT, created_at INTEGER)",
      "CREATE TABLE babies (id TEXT PRIMARY KEY, household_id TEXT, name TEXT, birth_date INTEGER, created_at INTEGER)",
      "CREATE TABLE activities (id TEXT PRIMARY KEY, baby_id TEXT, type TEXT, started_at INTEGER, ended_at INTEGER, details TEXT, created_at INTEGER, created_by TEXT)",
      "CREATE TABLE paper_log_import_batches (id TEXT PRIMARY KEY, household_id TEXT, baby_id TEXT, status TEXT, source_note TEXT, created_at INTEGER, created_by TEXT)",
      "CREATE TABLE paper_log_import_rows (id TEXT PRIMARY KEY, batch_id TEXT, row_index INTEGER, status TEXT, source_ref TEXT, confidence INTEGER, type TEXT, started_at INTEGER, ended_at INTEGER, details TEXT, note TEXT, raw_text TEXT, duplicate_activity_id TEXT, imported_activity_id TEXT, created_at INTEGER)",
    ]) await db.execute(sql);
    await db.batch([
      { sql: "INSERT INTO households VALUES ('house','INVITE',?)", args: [clock] },
      { sql: "INSERT INTO households VALUES ('other','OTHER1',?)", args: [clock] },
      { sql: "INSERT INTO users VALUES ('member','house','Parent',?)", args: [clock] },
      { sql: "INSERT INTO babies VALUES ('baby','house','Robin',NULL,?)", args: [clock] },
    ], "write");
    if (asleep) {
      await db.execute({
        sql: "INSERT INTO activities VALUES ('sleep1','baby','sleep',?,NULL,'{}',?,'Parent')",
        args: [clock - 4 * 3600_000, clock - 4 * 3600_000],
      });
    }
    await applyCaretakerImportSchema(db);
    await run(db);
  } finally {
    try { createDB().close(); } catch {}
    db.close();
    Date.now = previous.now;
    if (previous.url === undefined) delete process.env.TURSO_DATABASE_URL; else process.env.TURSO_DATABASE_URL = previous.url;
    if (previous.token === undefined) delete process.env.TURSO_AUTH_TOKEN; else process.env.TURSO_AUTH_TOKEN = previous.token;
  }
}

test("start then stop records one blip with how he settled", () => fixture(async (db) => {
  const started = await blip({ action: "start" });
  assert.equal(started.status, 200);
  clock += 4 * 60_000;
  const stopped = await blip({ action: "stop", settledBy: "self" });
  assert.equal(stopped.status, 200);
  const [row] = await blipRows(db);
  assert.equal(row.endedAt! - row.startedAt, 4 * 60_000);
  assert.equal(row.ending, "self");
  assert.equal(row.createdBy, "Parent");
}));

test("a blip cannot start while awake, twice at once, or stop with nothing open", () => fixture(async () => {
  assert.equal((await blip({ action: "stop", settledBy: "us" })).status, 409);
  assert.equal((await blip({ action: "start" })).status, 200);
  assert.equal((await blip({ action: "start" })).status, 409);
}).then(() => fixture(async () => {
  const response = await blip({ action: "start" });
  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, "NOT_SLEEPING");
}, { asleep: false })));

test("bad input and other households are refused", () => fixture(async (db) => {
  assert.equal((await blip({ action: "stop", settledBy: "maybe" })).status, 400);
  assert.equal((await blip({ action: "jump" })).status, 400);
  assert.equal((await blip({ action: "undo", undoToken: { kind: "x" } })).status, 400);
  assert.notEqual((await blip({ action: "start" }, "other")).status, 200);
  assert.equal((await blipRows(db)).length, 0);
}));

test("undo removes a fresh start and reopens a fresh stop, but not a stale one", () => fixture(async (db) => {
  const started = await (await blip({ action: "start" })).json();
  assert.equal((await blip({ action: "undo", undoToken: started.undoToken })).status, 200);
  assert.equal((await blipRows(db)).length, 0);

  await blip({ action: "start" });
  clock += 60_000;
  const stopped = await (await blip({ action: "stop", settledBy: "us" })).json();
  assert.equal((await blip({ action: "undo", undoToken: stopped.undoToken })).status, 200);
  const [reopened] = await blipRows(db);
  assert.equal(reopened.endedAt, null);
  assert.equal(reopened.ending, null);

  const again = await (await blip({ action: "stop", settledBy: "self" })).json();
  clock += 31_000;
  assert.equal((await blip({ action: "undo", undoToken: again.undoToken })).status, 409);
}));

test("waking closes an open blip as woke, and undoing the wake reopens it", () => fixture(async (db) => {
  await blip({ action: "start" });
  clock += 2 * 60_000;
  const woke = await (await sleep({ action: "wake" })).json();
  let [row] = await blipRows(db);
  assert.equal(row.endedAt, clock);
  assert.equal(row.ending, "woke");

  assert.equal((await sleep({ action: "undo", undoToken: woke.undoToken })).status, 200);
  [row] = await blipRows(db);
  assert.equal(row.endedAt, null);
  assert.equal(row.ending, null);
}));

test("undoing a sleep start drops a blip opened inside it", () => fixture(async (db) => {
  const started = await (await sleep({ action: "sleep" })).json();
  clock += 5_000;
  await blip({ action: "start" });
  assert.equal((await sleep({ action: "undo", undoToken: started.undoToken })).status, 200);
  assert.equal((await blipRows(db)).length, 0);
}, { asleep: false }));
