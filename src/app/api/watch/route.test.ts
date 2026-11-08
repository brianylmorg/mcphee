import assert from "node:assert/strict";
import test from "node:test";
import { createClient, type Client } from "@libsql/client";
import { NextRequest } from "next/server";

import { createDB } from "@/db";
import { applyChildcareModeSchema } from "@/db/childcare-mode-schema";
import { applyCaretakerImportSchema } from "@/db/caretaker-import-schema";
import { POST as childcareMode } from "@/app/api/childcare-mode/route";
import { GET, POST } from "./route";

const NOW = Date.parse("2026-10-16T18:00:00+08:00");
const TOKEN = "t".repeat(40);

function watchRequest(method: "GET" | "POST", body?: unknown, token: string | null = TOKEN) {
  const headers = new Headers();
  if (token != null) headers.set("authorization", `Bearer ${token}`);
  if (body != null) headers.set("content-type", "application/json");
  return new NextRequest("http://localhost/api/watch", {
    method,
    headers,
    ...(body == null ? {} : { body: JSON.stringify(body) }),
  });
}

async function json(response: Response) {
  return response.json() as Promise<Record<string, any>>;
}

async function fixture(run: (db: Client) => Promise<void>) {
  const previous = {
    url: process.env.TURSO_DATABASE_URL,
    token: process.env.TURSO_AUTH_TOKEN,
    watchToken: process.env.MCPHEE_WATCH_TOKEN,
    watchHousehold: process.env.MCPHEE_WATCH_HOUSEHOLD_ID,
    watchUser: process.env.MCPHEE_WATCH_USER_ID,
    now: Date.now,
  };
  const url = `file:/tmp/mcphee-watch-${process.pid}-${Math.random().toString(36).slice(2)}.db`;
  process.env.TURSO_DATABASE_URL = url;
  delete process.env.TURSO_AUTH_TOKEN;
  process.env.MCPHEE_WATCH_TOKEN = TOKEN;
  process.env.MCPHEE_WATCH_HOUSEHOLD_ID = "house";
  process.env.MCPHEE_WATCH_USER_ID = "member";
  Date.now = () => NOW;
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
      { sql: "INSERT INTO households VALUES ('house','INVITE',?)", args: [NOW] },
      { sql: "INSERT INTO households VALUES ('other','OTHER1',?)", args: [NOW] },
      { sql: "INSERT INTO users VALUES ('member','house','Parent',?)", args: [NOW] },
      { sql: "INSERT INTO babies VALUES ('baby','house','Robin',NULL,?)", args: [NOW - 1000] },
      { sql: "INSERT INTO babies VALUES ('other-baby','other','Other',NULL,?)", args: [NOW - 2000] },
      // 1000 ml of pumped milk so breastmilk feeds pass the bank check.
      { sql: "INSERT INTO activities VALUES ('pump1','baby','pump',?,NULL,?,?,'Parent')", args: [NOW - 6 * 3600_000, JSON.stringify({ amount: 1000 }), NOW - 6 * 3600_000] },
      { sql: "INSERT INTO activities VALUES ('sleep1','baby','sleep',?,?,'{}',?,'Parent')", args: [NOW - 3 * 3600_000, NOW - 2 * 3600_000, NOW - 3 * 3600_000] },
    ], "write");
    await applyChildcareModeSchema(db);
    await applyCaretakerImportSchema(db);
    await run(db);
  } finally {
    try { createDB().close(); } catch {}
    db.close();
    Date.now = previous.now;
    const restore = (key: string, value: string | undefined) => {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    };
    restore("TURSO_DATABASE_URL", previous.url);
    restore("TURSO_AUTH_TOKEN", previous.token);
    restore("MCPHEE_WATCH_TOKEN", previous.watchToken);
    restore("MCPHEE_WATCH_HOUSEHOLD_ID", previous.watchHousehold);
    restore("MCPHEE_WATCH_USER_ID", previous.watchUser);
  }
}

test("watch API rejects missing, wrong and unconfigured tokens", async () => fixture(async () => {
  assert.equal((await GET(watchRequest("GET", undefined, null))).status, 401);
  assert.equal((await GET(watchRequest("GET", undefined, "x".repeat(40)))).status, 401);
  assert.equal((await POST(watchRequest("POST", { action: "sleep" }, "wrong"))).status, 401);

  process.env.MCPHEE_WATCH_TOKEN = "short";
  assert.equal((await GET(watchRequest("GET", undefined, "short"))).status, 404);
  delete process.env.MCPHEE_WATCH_TOKEN;
  assert.equal((await GET(watchRequest("GET", undefined, ""))).status, 404);
}));

test("watch status reports the configured household's baby, awake time and last feed", async () => fixture(async () => {
  const status = await json(await GET(watchRequest("GET")));
  assert.equal(status.babyName, "Robin");
  assert.equal(status.state, "awake");
  assert.equal(status.since, NOW - 2 * 3600_000);
  assert.equal(status.sinceAgoSec, 7200);
  assert.equal(status.lastFeedAgoSec, null);
  assert.equal(status.lastFeed, null);
  assert.equal(status.atChildcare, false);
}));

test("sleep then wake toggles the open sleep row and rejects a repeated sleep", async () => fixture(async db => {
  const slept = await POST(watchRequest("POST", { action: "sleep" }));
  assert.equal(slept.status, 200);
  const sleptBody = await json(slept);
  assert.equal(sleptBody.status.state, "sleeping");
  assert.equal(sleptBody.status.since, NOW);

  const again = await POST(watchRequest("POST", { action: "sleep" }));
  assert.equal(again.status, 409);
  assert.equal((await json(again)).status.state, "sleeping");

  const woke = await json(await POST(watchRequest("POST", { action: "wake" })));
  assert.equal(woke.status.state, "awake");
  const open = await db.execute("SELECT COUNT(*) AS n FROM activities WHERE type = 'sleep' AND ended_at IS NULL");
  assert.equal(Number(open.rows[0].n), 0);
}));

test("feed saves the same bottlefeed shape as the phone form", async () => fixture(async db => {
  const response = await POST(watchRequest("POST", { action: "feed", milkType: "breastmilk", amount: 120 }));
  assert.equal(response.status, 200);
  const body = await json(response);
  assert.deepEqual(body.status.lastFeed, { at: NOW, milkType: "breastmilk", amount: 120 });

  const row = await db.execute("SELECT details, created_by, started_at FROM activities WHERE type = 'bottlefeed'");
  assert.equal(row.rows.length, 1);
  assert.equal(row.rows[0].created_by, "Parent");
  assert.equal(Number(row.rows[0].started_at), NOW);
  assert.deepEqual(JSON.parse(String(row.rows[0].details)), {
    feeds: [{ milkType: "breastmilk", amount: 120, libraryDeductionAmount: 120 }],
    amount: 120,
    milkType: "breastmilk",
    breastmilkAmount: 120,
    formulaAmount: 0,
    notes: null,
  });

  await POST(watchRequest("POST", { action: "feed", milkType: "formula", amount: 90 }));
  const status = await json(await GET(watchRequest("GET")));
  assert.equal(status.lastFeed.milkType, "formula");
  assert.equal(status.lastFeed.amount, 90);
}));

test("feed validation rejects bad input and an overdrawn milk bank", async () => fixture(async () => {
  assert.equal((await POST(watchRequest("POST", { action: "feed", milkType: "cow", amount: 100 }))).status, 400);
  assert.equal((await POST(watchRequest("POST", { action: "feed", milkType: "formula", amount: 0 }))).status, 400);
  assert.equal((await POST(watchRequest("POST", { action: "feed", milkType: "formula", amount: 12.5 }))).status, 400);
  assert.equal((await POST(watchRequest("POST", { action: "feed", milkType: "formula", amount: 401 }))).status, 400);
  await POST(watchRequest("POST", { action: "feed", milkType: "breastmilk", amount: 400 }));
  await POST(watchRequest("POST", { action: "feed", milkType: "breastmilk", amount: 400 }));
  const overdrawn = await POST(watchRequest("POST", { action: "feed", milkType: "breastmilk", amount: 300 }));
  assert.equal(overdrawn.status, 400);
  assert.match((await json(overdrawn)).error, /bank/);
}));

test("diaper buttons map to phone-form pee/poo values", async () => fixture(async db => {
  for (const kind of ["pee", "poo", "both"]) {
    assert.equal((await POST(watchRequest("POST", { action: "diaper", kind }))).status, 200);
  }
  assert.equal((await POST(watchRequest("POST", { action: "diaper", kind: "wet" }))).status, 400);
  const rows = await db.execute("SELECT details FROM activities WHERE type = 'diaper' ORDER BY created_at, rowid");
  assert.deepEqual(rows.rows.map((row) => {
    const d = JSON.parse(String(row.details));
    return [d.poop, d.peeUnits];
  }), [["no", "3"], ["M", "no"], ["M", "3"]]);
  const status = await json(await GET(watchRequest("GET")));
  assert.equal(status.lastDiaperAt, NOW);
  assert.equal(status.lastDiaperAgoSec, 0);
}));

test("logging is blocked while checked in to childcare", async () => fixture(async db => {
  const checkIn = await childcareMode(new NextRequest("http://localhost/api/childcare-mode", {
    method: "POST",
    headers: { cookie: "mcphee_hh=house; mcphee_user=member", origin: "http://localhost", "content-type": "application/json" },
    body: JSON.stringify({ action: "checkIn", babyId: "baby", requestId: "watch-checkin", at: NOW - 3600_000 }),
  }));
  assert.equal(checkIn.status, 200);
  assert.equal((await json(await GET(watchRequest("GET")))).atChildcare, true);

  for (const body of [
    { action: "sleep" },
    { action: "feed", milkType: "formula", amount: 100 },
    { action: "diaper", kind: "pee" },
  ]) {
    const response = await POST(watchRequest("POST", body));
    assert.equal(response.status, 409);
    assert.equal((await json(response)).code, "AT_CHILDCARE");
  }
  const override = await POST(watchRequest("POST", { action: "diaper", kind: "pee", childcareOverride: true }));
  assert.equal(override.status, 409);
  const written = await db.execute("SELECT COUNT(*) AS n FROM activities WHERE type IN ('bottlefeed','diaper') OR (type = 'sleep' AND ended_at IS NULL)");
  assert.equal(Number(written.rows[0].n), 0);
}));

test("incoming cookies and body ids cannot redirect the watch to another household", async () => fixture(async db => {
  const request = new NextRequest("http://localhost/api/watch", {
    method: "POST",
    headers: {
      authorization: `Bearer ${TOKEN}`,
      cookie: "mcphee_hh=other; mcphee_user=intruder",
      "content-type": "application/json",
    },
    body: JSON.stringify({ action: "diaper", kind: "pee", babyId: "other-baby", householdId: "other" }),
  });
  assert.equal((await POST(request)).status, 200);
  const rows = await db.execute("SELECT baby_id, created_by FROM activities WHERE type = 'diaper'");
  assert.deepEqual(rows.rows.map((row) => [row.baby_id, row.created_by]), [["baby", "Parent"]]);
}));
