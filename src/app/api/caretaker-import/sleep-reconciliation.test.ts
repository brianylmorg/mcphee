import assert from "node:assert/strict";
import test from "node:test";
import { createClient, type Client } from "@libsql/client";
import { NextRequest } from "next/server";
import { createDB } from "@/db";
import { applyCaretakerImportSchema, purgeExpiredCaretakerImports } from "@/db/caretaker-import-schema";
import { calculateDailyNaps } from "@/lib/daily-naps";
import type { CaretakerOcrLine } from "@/lib/caretaker-import-contract";
import { POST as stage } from "./stage/route";
import { PATCH as review } from "./review/route";
import { POST as commit } from "./commit/route";
import { GET as snapshot } from "./route";
import { GET as dashboard } from "../dashboard/route";
import { POST as sleepState } from "../sleep-state/route";

const NOW = Date.parse("2026-10-14T18:00:00+08:00");
const at = (time: string) => Date.parse(`2026-10-14T${time}:00+08:00`);
const coverage = { startedAt: at("08:00"), endedAt: at("17:00"), napsChecked: true };

async function fixture(run: (db: Client) => Promise<void>, migrate = true) {
  const previous = { url: process.env.TURSO_DATABASE_URL, token: process.env.TURSO_AUTH_TOKEN, now: Date.now };
  process.env.TURSO_DATABASE_URL = `file:/tmp/caretaker-sleep-${process.pid}-${Math.random().toString(36).slice(2)}.db`;
  delete process.env.TURSO_AUTH_TOKEN;
  Date.now = () => NOW;
  const db = createClient({ url: process.env.TURSO_DATABASE_URL });
  try {
    for (const sql of [
      "CREATE TABLE households (id TEXT PRIMARY KEY, invite_code TEXT, created_at INTEGER)",
      "CREATE TABLE users (id TEXT PRIMARY KEY, household_id TEXT, name TEXT, created_at INTEGER)",
      "CREATE TABLE babies (id TEXT PRIMARY KEY, household_id TEXT, name TEXT, birth_date INTEGER, created_at INTEGER)",
      "CREATE TABLE activities (id TEXT PRIMARY KEY, baby_id TEXT, type TEXT, started_at INTEGER, ended_at INTEGER, details TEXT, created_at INTEGER, created_by TEXT)",
      "CREATE TABLE paper_log_import_batches (id TEXT PRIMARY KEY, household_id TEXT, baby_id TEXT, status TEXT, source_note TEXT, created_at INTEGER, created_by TEXT)",
      "CREATE TABLE paper_log_import_rows (id TEXT PRIMARY KEY, batch_id TEXT, row_index INTEGER, status TEXT, source_ref TEXT, confidence INTEGER, type TEXT, started_at INTEGER, ended_at INTEGER, details TEXT, note TEXT, raw_text TEXT, duplicate_activity_id TEXT REFERENCES activities(id), imported_activity_id TEXT REFERENCES activities(id), created_at INTEGER)",
      "CREATE TABLE active_timers (id TEXT, baby_id TEXT, type TEXT, started_at INTEGER, current_side TEXT, side_switches TEXT, started_by TEXT)",
      "CREATE TABLE measurements (id TEXT, baby_id TEXT, measured_at INTEGER, weight_g INTEGER, length_mm INTEGER, head_mm INTEGER, note TEXT, created_at INTEGER)",
    ]) await db.execute(sql);
    await db.batch([
      { sql: "INSERT INTO households VALUES ('house','INVITE',?)", args: [NOW] },
      { sql: "INSERT INTO users VALUES ('member','house','Parent',?)", args: [NOW] },
      { sql: "INSERT INTO babies VALUES ('baby','house','Baby',NULL,?)", args: [NOW] },
      { sql: "INSERT INTO activities VALUES ('pump','baby','pump',?,NULL,'{\"amount\":500}',?,'Parent')", args: [at("06:00"), at("06:00")] },
    ], "write");
    if (migrate) await applyCaretakerImportSchema(db);
    await db.execute("PRAGMA foreign_keys = ON");
    await run(db);
  } finally {
    try { createDB().close(); } catch {}
    db.close();
    Date.now = previous.now;
    if (previous.url === undefined) delete process.env.TURSO_DATABASE_URL; else process.env.TURSO_DATABASE_URL = previous.url;
    if (previous.token === undefined) delete process.env.TURSO_AUTH_TOKEN; else process.env.TURSO_AUTH_TOKEN = previous.token;
  }
}

function request(path: string, method = "GET", body?: unknown) {
  const headers = new Headers({ cookie: "mcphee_hh=house; mcphee_user=member", origin: "http://localhost" });
  if (body != null) headers.set("content-type", "application/json");
  return new NextRequest(`http://localhost${path}`, { method, headers, ...(body == null ? {} : { body: JSON.stringify(body) }) });
}

function lines(texts: string[]): CaretakerOcrLine[] {
  return texts.map((text, index) => ({ id: `line-${index}`, text, confidence: 0.99,
    bounds: { x: 10, y: index * 30, width: 250, height: 24 },
    origin: { classification: "caretaker", confidence: 0.99 } }));
}
const naps = () => lines(["Past Nap Times", "3:00 p.m. Nap End", "2:00 p.m. Nap Start"]);

async function stageRows(source: CaretakerOcrLine[], suffix: number) {
  const form = new FormData();
  form.set("babyId", "baby"); form.set("date", "2026-10-14"); form.set("requestId", `stage-sleep-${suffix}`);
  form.set("lines", JSON.stringify(source));
  form.set("image", new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, suffix])], "synthetic.png", { type: "image/png" }));
  const response = await stage(new NextRequest("http://localhost/api/caretaker-import/stage", {
    method: "POST", headers: { cookie: "mcphee_hh=house; mcphee_user=member", origin: "http://localhost" }, body: form,
  }));
  assert.equal(response.status, 200, await response.clone().text());
  return response.json();
}
async function save(batch: { batch: { id: string; revision: number }; rows: Array<{ id: string }> }, changes = {}, range: unknown = coverage) {
  return review(request("/api/caretaker-import/review", "PATCH", { batchId: batch.batch.id,
    expectedRevision: batch.batch.revision, sleepCoverage: range,
    rows: batch.rows.map(row => ({ id: row.id, action: "include", ...changes })) }));
}
function apply(batch: { batch: { id: string; revision: number } }, requestId = "sleep-commit-unique") {
  return commit(request("/api/caretaker-import/commit", "POST", { batchId: batch.batch.id,
    expectedRevision: batch.batch.revision, requestId }));
}
async function addSleep(db: Client, id: string, start: string, end: string | null, details = {}) {
  await db.execute({ sql: "INSERT INTO activities VALUES (?, 'baby','sleep',?,?,?,?,'Original parent')",
    args: [id, at(start), end == null ? null : at(end), JSON.stringify(details), at(start)] });
}
const sleeps = async (db: Client) => (await db.execute("SELECT * FROM activities WHERE type='sleep' ORDER BY id")).rows;

test("reviewed care sleep replaces a stale timer, retains exact naps once and preserves later home sleep", async () => fixture(async db => {
  await addSleep(db, "stale", "07:00", null);
  await addSleep(db, "wrong", "09:00", "09:30");
  await addSleep(db, "exact", "14:00", "15:00", { existing: "keep" });
  const staged = await stageRows(naps(), 1);
  const otherStage = await stageRows(naps(), 2);
  assert.equal(staged.rows[0].status, "staged", "persisted sleep is replaceable rather than a locked duplicate");
  assert.equal(otherStage.rows[0].status, "staged", "another staged screenshot cannot veto sleep authority");
  await db.execute({ sql: "UPDATE paper_log_import_rows SET duplicate_activity_id='wrong', imported_activity_id='wrong', conflict_activity_id='wrong' WHERE id=?", args: [otherStage.rows[0].id] });
  const savedResponse = await save(staged, { details: { notes: "Care nap checked" }, note: "Care nap checked" });
  assert.equal(savedResponse.status, 200);
  const saved = await savedResponse.json();
  assert.equal(saved.sleepReconciliation.retainedExactCount, 1);
  assert.equal(saved.sleepReconciliation.removedCount, 1);
  assert.equal(saved.sleepReconciliation.trimmedCount, 1);
  await addSleep(db, "home-later", "17:30", null);
  const response = await apply(saved);
  assert.equal(response.status, 200, await response.clone().text());
  const result = await response.json();
  assert.deepEqual(result.committedActivityIds, ["exact"]);
  const rows = await sleeps(db);
  assert.equal(rows.find(r => r.id === "stale")?.ended_at, at("08:00"));
  assert.equal(rows.some(r => r.id === "wrong"), false);
  assert.equal(rows.find(r => r.id === "home-later")?.ended_at, null);
  const exact = rows.find(r => r.id === "exact")!;
  assert.equal(exact.created_by, "Original parent");
  assert.deepEqual(JSON.parse(String(exact.details)), { existing: "keep", notes: "Care nap checked" });
  assert.equal(rows.length, 3);
  const refs = (await db.execute({ sql: "SELECT duplicate_activity_id, imported_activity_id, conflict_activity_id FROM paper_log_import_rows WHERE id=?", args: [otherStage.rows[0].id] })).rows[0];
  assert.deepEqual(Object.values(refs), [null, null, null]);
  const replay = await apply(saved);
  assert.equal(replay.status, 200);
  assert.equal((await replay.json()).idempotent, true);
  assert.deepEqual(await sleeps(db), rows, "lost-response replay cannot trim or insert again");
  const overview = await dashboard(request("/api/dashboard"));
  assert.equal(overview.status, 200);
  assert.deepEqual((await overview.json()).sleepCoverages, [{ baby_id: "baby", startedAt: coverage.startedAt, endedAt: coverage.endedAt }]);
}));

test("zero-new-entry care import can mark a no-nap period awake and retain its coverage after source purge", async () => fixture(async db => {
  await db.execute({ sql: "INSERT INTO activities VALUES ('feed','baby','bottlefeed',?,NULL,?,?,'Parent')", args: [at("09:00"), JSON.stringify({ milkType: "breastmilk", amount: 80 }), at("09:00")] });
  await addSleep(db, "open-inside", "10:00", null);
  const staged = await stageRows(lines(["Past Milk Feeds", "9:00 a.m. 80 ml Breast Milk"]), 3);
  assert.equal(staged.rows[0].status, "duplicate");
  const savedResponse = await save(staged, { action: "exclude" });
  assert.equal(savedResponse.status, 200);
  const saved = await savedResponse.json();
  const response = await apply(saved);
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.committedCount, 0);
  assert.equal(result.sleepReconciliation.authoritativeNapCount, 0);
  assert.deepEqual(await sleeps(db), []);
  assert.equal(Number((await db.execute("SELECT COUNT(*) AS n FROM activities WHERE type='bottlefeed'")).rows[0].n), 1);
  await purgeExpiredCaretakerImports(db, NOW + 8 * 86400_000, NOW + 8 * 86400_000);
  const overview = await dashboard(request("/api/dashboard"));
  assert.equal(overview.status, 200);
  const care = (await overview.json()).sleepCoverages;
  assert.deepEqual(care, [{ baby_id: "baby", startedAt: coverage.startedAt, endedAt: coverage.endedAt }]);
  assert.deepEqual(calculateDailyNaps([], NOW, care), { totalMs: 0, dayStartAt: coverage.startedAt, bedtimeAt: null, waitingForMorningWake: false });
  assert.equal((await apply(saved)).status, 200, "the committed request remains replayable after private draft deletion");
}));

test("invalid ranges, stale previews and changed revisions cannot partially replace sleep", async () => fixture(async db => {
  const staged = await stageRows(naps(), 4);
  for (const range of [null, { ...coverage, napsChecked: false }, { ...coverage, endedAt: coverage.startedAt },
    { ...coverage, endedAt: NOW + 1 }, { ...coverage, startedAt: coverage.startedAt - 86400_000 }]) {
    assert.equal((await save(staged, {}, range)).status, 400);
  }
  const tooShort = await save(staged, {}, { ...coverage, endedAt: at("12:00") });
  assert.equal(tooShort.status, 200);
  const short = await tooShort.json();
  assert.equal((await apply(short)).status, 409);
  const valid = await save(short);
  assert.equal(valid.status, 200);
  const saved = await valid.json();
  await addSleep(db, "concurrent", "10:00", "11:00");
  const before = await sleeps(db);
  const rejected = await apply(saved);
  assert.equal(rejected.status, 409);
  assert.equal((await rejected.json()).code, "SLEEP_PLAN_CHANGED");
  assert.deepEqual(await sleeps(db), before);
  const loaded = await snapshot(request(`/api/caretaker-import?batchId=${saved.batch.id}`));
  const updatedResponse = await save(await loaded.json(), {}, { ...coverage, endedAt: at("16:00") });
  assert.equal(updatedResponse.status, 200);
  assert.equal((await apply(saved)).status, 409, "changing the reviewed period invalidates the old revision");
  assert.equal((await apply(await updatedResponse.json())).status, 200);
}));

test("milk stock failure rolls back sleep replacement, and a closed straddler preserves both outside pieces", async () => fixture(async db => {
  await addSleep(db, "straddler", "07:00", "18:00", { notes: "Home history" });
  const source = lines(["Past Milk Feeds", "9:00 a.m. 600 ml Breast Milk", "Past Nap Times", "3:00 p.m. Nap End", "2:00 p.m. Nap Start"]);
  const staged = await stageRows(source, 5);
  const savedResponse = await save(staged);
  assert.equal(savedResponse.status, 200);
  const saved = await savedResponse.json();
  const before = await sleeps(db);
  const rejected = await apply(saved);
  assert.equal(rejected.status, 400);
  assert.equal((await rejected.json()).code, "INSUFFICIENT_BREASTMILK");
  assert.deepEqual(await sleeps(db), before);
  const corrected = await review(request("/api/caretaker-import/review", "PATCH", {
    batchId: saved.batch.id, expectedRevision: saved.batch.revision, sleepCoverage: coverage,
    rows: saved.rows.map((row: { id: string; draft: { type: string } }) => ({ id: row.id, action: row.draft.type === "sleep" ? "include" : "exclude" })),
  }));
  assert.equal(corrected.status, 200);
  assert.equal((await apply(await corrected.json())).status, 200);
  const rows = await sleeps(db);
  assert.equal(rows.length, 3);
  assert.equal(rows.find(r => r.id === "straddler")?.ended_at, at("08:00"));
  const suffix = rows.find(r => r.started_at === at("17:00"))!;
  assert.equal(suffix.ended_at, at("18:00"));
  assert.equal(suffix.details, JSON.stringify({ notes: "Home history" }));
  assert.equal(suffix.created_by, "Original parent");
}));

test("a retained nap cannot be reopened by an undo token issued before the import", async () => fixture(async db => {
  await addSleep(db, "exact-now", "17:00", "18:00");
  const staged = await stageRows(lines(["Past Nap Times", "6:00 p.m. Nap End", "5:00 p.m. Nap Start"]), 6);
  const savedResponse = await save(staged, {}, { ...coverage, endedAt: NOW });
  assert.equal(savedResponse.status, 200);
  assert.equal((await apply(await savedResponse.json())).status, 200);
  const response = await sleepState(request("/api/sleep-state", "POST", { babyId: "baby", action: "undo", undoToken: { kind: "woke", activityId: "exact-now", changedAt: NOW } }));
  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, "STALE_UNDO");
  assert.equal((await sleeps(db))[0].ended_at, NOW);
}));

test("old staged nap conflicts can enter care-window review without altering an old committed retry", async () => fixture(async db => {
  await addSleep(db, "old-exact", "14:00", "15:00");
  const staged = await stageRows(naps(), 7);
  await db.execute({ sql: "UPDATE paper_log_import_rows SET status='duplicate', duplicate_activity_id='old-exact', issues=? WHERE id=?",
    args: [JSON.stringify([{ code: "EXACT_DUPLICATE", message: "Previously locked", blocking: true }]), staged.rows[0].id] });
  const loaded = await snapshot(request(`/api/caretaker-import?batchId=${staged.batch.id}`));
  const latest = await loaded.json();
  assert.equal(latest.rows[0].status, "needs_review");
  assert.equal(latest.rows[0].issues.some((issue: { code: string }) => issue.code === "EXACT_DUPLICATE"), false);
  const saved = await save(latest);
  assert.equal(saved.status, 200);
  const reviewed = await saved.json();
  assert.equal((await apply(reviewed)).status, 200);
  assert.equal((await sleeps(db)).length, 1);
  const oldResult = { batchId: reviewed.batch.id, committedActivityIds: ["old-exact"], committedCount: 1, idempotent: false };
  await db.execute({ sql: "UPDATE paper_log_import_batches SET commit_result=?, draft_metadata=NULL, audit_metadata='{\"version\":1}' WHERE id=?",
    args: [JSON.stringify(oldResult), reviewed.batch.id] });
  const oldReplay = await apply(reviewed);
  assert.equal(oldReplay.status, 200);
  assert.deepEqual(await oldReplay.json(), { ...oldResult, idempotent: true });
  assert.equal((await sleeps(db)).length, 1, "old committed replies cannot reapply sleep reconciliation");
}));

test("dashboard remains available before or during an incomplete caretaker schema migration", async () => fixture(async db => {
  const before = await dashboard(request("/api/dashboard"));
  assert.equal(before.status, 200);
  assert.deepEqual((await before.json()).sleepCoverages, []);
  await db.execute("ALTER TABLE paper_log_import_batches ADD COLUMN source_kind TEXT");
  const partial = await dashboard(request("/api/dashboard"));
  assert.equal(partial.status, 200);
  assert.deepEqual((await partial.json()).sleepCoverages, []);
}, false));
