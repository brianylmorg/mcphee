import assert from "node:assert/strict";
import test from "node:test";
import { createClient, type Client } from "@libsql/client";
import { NextRequest } from "next/server";

import { createDB } from "@/db";
import { applyChildcareModeSchema } from "@/db/childcare-mode-schema";
import { applyCaretakerImportSchema } from "@/db/caretaker-import-schema";
import { POST as createActivity } from "@/app/api/activities/route";
import { DELETE as stopTimer } from "@/app/api/active-timers/route";
import { GET as getActivities } from "@/app/api/activities/route";
import { POST as stageImport } from "@/app/api/caretaker-import/stage/route";
import { GET as getImport } from "@/app/api/caretaker-import/route";
import { PATCH as reviewImport } from "@/app/api/caretaker-import/review/route";
import { POST as commitImport } from "@/app/api/caretaker-import/commit/route";
import type { CaretakerOcrLine } from "@/lib/caretaker-import-contract";
import { GET, POST } from "./route";
import { applySickModeSchema } from "@/db/sick-mode-schema";
import { POST as sleepState } from "@/app/api/sleep-state/route";
import { POST as sickMode } from "@/app/api/sick-mode/route";

const NOW = Date.parse("2026-10-16T18:00:00+08:00");
const at = (time: string) => Date.parse(`2026-10-16T${time}:00+08:00`);

function request(path: string, method = "GET", body?: unknown) {
  const headers = new Headers({
    cookie: "mcphee_hh=house; mcphee_user=member",
    origin: "http://localhost",
  });
  if (body != null) headers.set("content-type", "application/json");
  return new NextRequest(`http://localhost${path}`, {
    method,
    headers,
    ...(body == null ? {} : { body: JSON.stringify(body) }),
  });
}

async function fixture(run: (db: Client) => Promise<void>, migrate = true) {
  const previous = { url: process.env.TURSO_DATABASE_URL, token: process.env.TURSO_AUTH_TOKEN, now: Date.now };
  const url = `file:/tmp/mcphee-childcare-mode-${process.pid}-${Math.random().toString(36).slice(2)}.db`;
  process.env.TURSO_DATABASE_URL = url;
  delete process.env.TURSO_AUTH_TOKEN;
  Date.now = () => NOW;
  const db = createClient({ url });
  try {
    for (const sql of [
      "CREATE TABLE households (id TEXT PRIMARY KEY, invite_code TEXT, created_at INTEGER)",
      "CREATE TABLE users (id TEXT PRIMARY KEY, household_id TEXT, name TEXT, created_at INTEGER)",
      "CREATE TABLE babies (id TEXT PRIMARY KEY, household_id TEXT, name TEXT, birth_date INTEGER, created_at INTEGER)",
      "CREATE TABLE activities (id TEXT PRIMARY KEY, baby_id TEXT, type TEXT, started_at INTEGER, ended_at INTEGER, details TEXT, created_at INTEGER, created_by TEXT)",
      "CREATE TABLE active_timers (id TEXT PRIMARY KEY, baby_id TEXT, type TEXT, started_at INTEGER, current_side TEXT, side_switches TEXT, started_by TEXT)",
      "CREATE TABLE paper_log_import_batches (id TEXT PRIMARY KEY, household_id TEXT, baby_id TEXT, status TEXT, source_note TEXT, created_at INTEGER, created_by TEXT)",
      "CREATE TABLE paper_log_import_rows (id TEXT PRIMARY KEY, batch_id TEXT, row_index INTEGER, status TEXT, source_ref TEXT, confidence INTEGER, type TEXT, started_at INTEGER, ended_at INTEGER, details TEXT, note TEXT, raw_text TEXT, duplicate_activity_id TEXT, imported_activity_id TEXT, created_at INTEGER)",
    ]) await db.execute(sql);
    await db.batch([
      { sql: "INSERT INTO households VALUES ('house','INVITE',?)", args: [NOW] },
      { sql: "INSERT INTO users VALUES ('member','house','Parent',?)", args: [NOW] },
      { sql: "INSERT INTO babies VALUES ('baby','house','Baby',NULL,?)", args: [NOW] },
    ], "write");
    if (migrate) {
      await applyChildcareModeSchema(db);
      await applyCaretakerImportSchema(db);
    }
    await run(db);
  } finally {
    try { createDB().close(); } catch {}
    db.close();
    Date.now = previous.now;
    if (previous.url === undefined) delete process.env.TURSO_DATABASE_URL; else process.env.TURSO_DATABASE_URL = previous.url;
    if (previous.token === undefined) delete process.env.TURSO_AUTH_TOKEN; else process.env.TURSO_AUTH_TOKEN = previous.token;
  }
}

async function json(response: Response) {
  return response.json() as Promise<Record<string, any>>;
}

async function closedSession(checkIn = "08:00", checkOut = "17:00") {
  const started = await json(await POST(request("/api/childcare-mode", "POST", {
    action: "checkIn", babyId: "baby", requestId: `linked-checkin-${checkIn}`, at: at(checkIn),
  })));
  const response = await POST(request("/api/childcare-mode", "POST", {
    action: "checkOut", babyId: "baby", sessionId: started.session.id, requestId: `linked-checkout-${checkOut}`, at: at(checkOut),
  }));
  assert.equal(response.status, 200);
  return (await json(response)).session as Record<string, any>;
}

function ocrLines(texts: string[]): CaretakerOcrLine[] {
  return texts.map((text, index) => ({
    id: `line-${index}`,
    text,
    confidence: 0.99,
    bounds: { x: 10, y: index * 30, width: 250, height: 24 },
    origin: { classification: "caretaker", confidence: 0.99 },
  }));
}

async function stageLinked(sessionId: string, source: CaretakerOcrLine[], suffix: string) {
  const form = new FormData();
  form.set("babyId", "baby");
  form.set("date", "2026-10-16");
  form.set("requestId", `linked-stage-${suffix}`);
  form.set("childcareSessionId", sessionId);
  form.set("lines", JSON.stringify(source));
  form.set("image", new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, suffix.length])], "synthetic.png", { type: "image/png" }));
  return stageImport(new NextRequest("http://localhost/api/caretaker-import/stage", {
    method: "POST",
    headers: { cookie: "mcphee_hh=house; mcphee_user=member", origin: "http://localhost" },
    body: form,
  }));
}

test("check-in and check-out are shared, retry-safe, concurrency-safe, and retain every pending import", async () => fixture(async db => {
  const checkIn = { action: "checkIn", babyId: "baby", requestId: "check-in-request-1", at: at("08:00") };
  const first = await POST(request("/api/childcare-mode", "POST", checkIn));
  assert.equal(first.status, 200);
  const firstBody = await json(first);
  assert.equal(firstBody.idempotent, false);
  assert.equal(firstBody.activeSession.checkedInAt, at("08:00"));

  const replay = await POST(request("/api/childcare-mode", "POST", checkIn));
  assert.equal(replay.status, 200);
  assert.equal((await json(replay)).idempotent, true);

  const competing = await Promise.all([
    POST(request("/api/childcare-mode", "POST", { action: "checkIn", babyId: "baby", requestId: "competing-checkin-a", at: at("08:01") })),
    POST(request("/api/childcare-mode", "POST", { action: "checkIn", babyId: "baby", requestId: "competing-checkin-b", at: at("08:02") })),
  ]);
  assert.deepEqual(competing.map((response) => response.status).sort(), [409, 409], "the original active session wins both competing commands");

  const checkOut = { action: "checkOut", babyId: "baby", sessionId: firstBody.session.id, requestId: "check-out-request-1", at: at("17:00") };
  const closed = await POST(request("/api/childcare-mode", "POST", checkOut));
  assert.equal(closed.status, 200);
  const closedBody = await json(closed);
  assert.equal(closedBody.activeSession, null);
  assert.equal(closedBody.pendingSessions.length, 1);
  assert.equal(closedBody.pendingSessions[0].checkedOutAt, at("17:00"));
  assert.equal((await json(await POST(request("/api/childcare-mode", "POST", checkOut)))).idempotent, true);

  await db.execute({
    sql: `INSERT INTO childcare_sessions
          (id,baby_id,checked_in_at,checked_out_at,check_in_request_id,check_out_request_id,pending_import,created_at,updated_at)
          VALUES ('older','baby',?,?,?,?,1,?,?)`,
    args: [at("06:00"), at("07:00"), "older-checkin", "older-checkout", at("06:00"), at("07:00")],
  });
  const state = await json(await GET(request("/api/childcare-mode?babyId=baby")));
  assert.equal(state.pendingSessions.length, 2, "pending sessions survive refresh and are not silently capped to the latest");

  const backdated = await POST(request("/api/childcare-mode", "POST", {
    action: "checkIn", babyId: "baby", requestId: "backdated-open-request", at: at("06:30"),
  }));
  assert.equal(backdated.status, 409, "a new open interval cannot begin before a later closed session ends");
  assert.equal((await json(backdated)).code, "SESSION_OVERLAP");

  const raced = await Promise.all([
    POST(request("/api/childcare-mode", "POST", { action: "checkIn", babyId: "baby", requestId: "fresh-race-request-a", at: at("17:30") })),
    POST(request("/api/childcare-mode", "POST", { action: "checkIn", babyId: "baby", requestId: "fresh-race-request-b", at: at("17:31") })),
  ]);
  assert.deepEqual(raced.map((response) => response.status).sort(), [200, 409], "the unique active-session index serializes simultaneous check-ins");
}));

test("an active check-in can be edited safely without overlapping history or accepting stale edits", async () => fixture(async db => {
  await db.execute({
    sql: `INSERT INTO childcare_sessions
          (id,baby_id,checked_in_at,checked_out_at,check_in_request_id,check_out_request_id,pending_import,created_at,updated_at)
          VALUES ('prior','baby',?,?,?,?,0,?,?)`,
    args: [at("08:00"), at("09:00"), "prior-checkin-command", "prior-checkout-command", at("08:00"), at("09:00")],
  });
  const started = await json(await POST(request("/api/childcare-mode", "POST", {
    action: "checkIn", babyId: "baby", requestId: "editable-checkin-command", at: at("10:00"),
  })));
  const base = {
    action: "editCheckIn", babyId: "baby", sessionId: started.session.id,
    expectedCheckedInAt: at("10:00"), requestId: "edit-checkin-command",
  };

  const overlap = await POST(request("/api/childcare-mode", "POST", { ...base, at: at("08:30") }));
  assert.equal(overlap.status, 409);
  assert.equal((await json(overlap)).code, "SESSION_OVERLAP");
  assert.equal((await json(await GET(request("/api/childcare-mode?babyId=baby")))).activeSession.checkedInAt, at("10:00"));

  const edited = await POST(request("/api/childcare-mode", "POST", { ...base, at: at("09:00") }));
  assert.equal(edited.status, 200);
  const editedBody = await json(edited);
  assert.equal(editedBody.idempotent, false);
  assert.equal(editedBody.session.checkedInAt, at("09:00"));
  assert.equal(editedBody.activeSession.checkedInAt, at("09:00"));

  const replay = await POST(request("/api/childcare-mode", "POST", { ...base, at: at("09:00") }));
  assert.equal(replay.status, 200);
  assert.equal((await json(replay)).idempotent, true);

  const stale = await POST(request("/api/childcare-mode", "POST", { ...base, requestId: "stale-edit-command", at: at("09:30") }));
  assert.equal(stale.status, 409);
  assert.equal((await json(stale)).code, "CHILDCARE_STATE_CHANGED");

  const competing = await Promise.all([
    POST(request("/api/childcare-mode", "POST", { ...base, expectedCheckedInAt: at("09:00"), requestId: "competing-edit-one", at: at("09:15") })),
    POST(request("/api/childcare-mode", "POST", { ...base, expectedCheckedInAt: at("09:00"), requestId: "competing-edit-two", at: at("09:30") })),
  ]);
  assert.deepEqual(competing.map(response => response.status).sort(), [200, 409]);
  const current = await json(await GET(request("/api/childcare-mode?babyId=baby")));
  assert.ok([at("09:15"), at("09:30")].includes(current.activeSession.checkedInAt));
}));

test("check-in edits race safely with checkout and never produce an invalid closed window", async () => fixture(async db => {
  const started = await json(await POST(request("/api/childcare-mode", "POST", {
    action: "checkIn", babyId: "baby", requestId: "race-edit-start-command", at: at("10:00"),
  })));
  const [edited, checkedOut] = await Promise.all([
    POST(request("/api/childcare-mode", "POST", {
      action: "editCheckIn", babyId: "baby", sessionId: started.session.id,
      expectedCheckedInAt: at("10:00"), at: at("11:00"), requestId: "race-edit-command",
    })),
    POST(request("/api/childcare-mode", "POST", {
      action: "checkOut", babyId: "baby", sessionId: started.session.id,
      at: at("10:30"), requestId: "race-checkout-command",
    })),
  ]);
  assert.equal([edited, checkedOut].filter(response => response.status === 200).length, 1);
  const stored = (await db.execute({
    sql: "SELECT checked_in_at, checked_out_at FROM childcare_sessions WHERE id = ?",
    args: [started.session.id],
  })).rows[0];
  if (stored.checked_out_at == null) {
    assert.equal(Number(stored.checked_in_at), at("11:00"));
  } else {
    assert.equal(Number(stored.checked_in_at), at("10:00"));
    assert.ok(Number(stored.checked_out_at) > Number(stored.checked_in_at));
  }
}));

test("active childcare blocks new activity and timer completion until the exact request is explicitly confirmed", async () => fixture(async db => {
  await db.execute({
    sql: "INSERT INTO active_timers VALUES ('timer','baby','breastfeed',?,'L','[]','member')",
    args: [at("07:30")],
  });
  const checkedIn = await POST(request("/api/childcare-mode", "POST", {
    action: "checkIn", babyId: "baby", requestId: "guard-checkin-request", at: at("08:00"),
  }));
  assert.equal(checkedIn.status, 200);

  const activity = { babyId: "baby", type: "note", startedAt: at("09:00"), details: { notes: "manual" } };
  const blocked = await createActivity(request("/api/activities", "POST", activity));
  assert.equal(blocked.status, 409);
  assert.equal((await json(blocked)).code, "CHILDCARE_CONFIRMATION_REQUIRED");
  assert.equal(Number((await db.execute("SELECT COUNT(*) AS n FROM activities")).rows[0].n), 0);

  const confirmed = await createActivity(request("/api/activities", "POST", { ...activity, childcareOverride: true }));
  assert.equal(confirmed.status, 200);
  assert.equal(Number((await db.execute("SELECT COUNT(*) AS n FROM activities")).rows[0].n), 1);

  const stopBlocked = await stopTimer(request("/api/active-timers?babyId=baby&id=timer", "DELETE"));
  assert.equal(stopBlocked.status, 409);
  assert.equal(Number((await db.execute("SELECT COUNT(*) AS n FROM active_timers")).rows[0].n), 1);
  assert.equal(Number((await db.execute("SELECT COUNT(*) AS n FROM activities WHERE type='breastfeed'")).rows[0].n), 0);

  const stopConfirmed = await stopTimer(request("/api/active-timers?babyId=baby&id=timer&childcareOverride=true", "DELETE"));
  assert.equal(stopConfirmed.status, 200);
  assert.equal(Number((await db.execute("SELECT COUNT(*) AS n FROM active_timers")).rows[0].n), 0);
  assert.equal(Number((await db.execute("SELECT COUNT(*) AS n FROM activities WHERE type='breastfeed'")).rows[0].n), 1);
}));

test("a linked screenshot keeps canonical session bounds, clears pending atomically, and projects one marker pair", async () => fixture(async db => {
  const session = await closedSession();
  const stagedResponse = await stageLinked(session.id, ocrLines([
    "Past Nap Times", "11:00 a.m. Nap End", "10:00 a.m. Nap Start",
  ]), "nap");
  assert.equal(stagedResponse.status, 200, await stagedResponse.clone().text());
  const staged = await json(stagedResponse);
  assert.equal(staged.childcareSession.id, session.id);

  const wrongBounds = await reviewImport(request("/api/caretaker-import/review", "PATCH", {
    batchId: staged.batch.id,
    expectedRevision: staged.batch.revision,
    rows: staged.rows.map((row: Record<string, unknown>) => ({ id: row.id, action: "include" })),
    sleepCoverage: { startedAt: at("08:01"), endedAt: at("17:00"), napsChecked: true },
  }));
  assert.equal(wrongBounds.status, 409);
  assert.equal((await json(wrongBounds)).code, "CHILDCARE_SESSION_BOUNDS_LOCKED");

  const reviewedResponse = await reviewImport(request("/api/caretaker-import/review", "PATCH", {
    batchId: staged.batch.id,
    expectedRevision: staged.batch.revision,
    rows: staged.rows.map((row: Record<string, unknown>) => ({ id: row.id, action: "include" })),
    sleepCoverage: { startedAt: at("08:00"), endedAt: at("17:00"), napsChecked: true },
  }));
  assert.equal(reviewedResponse.status, 200, await reviewedResponse.clone().text());
  const reviewed = await json(reviewedResponse);

  const commitBody = { batchId: staged.batch.id, expectedRevision: reviewed.batch.revision, requestId: "linked-commit-request" };
  const committed = await commitImport(request("/api/caretaker-import/commit", "POST", commitBody));
  assert.equal(committed.status, 200, await committed.clone().text());
  const stored = (await db.execute({ sql: "SELECT * FROM childcare_sessions WHERE id = ?", args: [session.id] })).rows[0];
  assert.equal(stored.pending_import, 0);
  assert.equal(stored.import_batch_id, staged.batch.id);
  assert.equal(Number(stored.import_completed_at), NOW);

  const replay = await commitImport(request("/api/caretaker-import/commit", "POST", commitBody));
  assert.equal(replay.status, 200);
  assert.equal((await json(replay)).idempotent, true);

  const timeline = await json(await getActivities(request("/api/activities?babyId=baby&limit=all")));
  const markers = timeline.activities.filter((row: Record<string, unknown>) => row.careBoundary != null);
  assert.deepEqual(markers.map((row: Record<string, unknown>) => row.id).sort(), [
    `childcare-care:${session.id}:end`, `childcare-care:${session.id}:start`,
  ]);
  assert.equal(timeline.activities.some((row: Record<string, unknown>) => String(row.id).startsWith("caretaker-care:")), false);
}));

test("an abandoned screenshot offers its original unfinished review without relinking sessions", async () => fixture(async db => {
  const original = await closedSession("08:00", "13:00");
  const source = ocrLines(["Past Nap Times", "11:00 a.m. Nap End", "10:00 a.m. Nap Start"]);
  const staged = await json(await stageLinked(original.id, source, "first"));
  const other = await closedSession("14:00", "17:00");
  for (const [sessionId, suffix] of [[other.id, "again"], ["", "plain"]]) {
    const retry = await stageLinked(sessionId, source, suffix);
    assert.equal(retry.status, 409);
    const conflict = await json(retry);
    assert.equal(conflict.code, "SCREENSHOT_SESSION_CONFLICT");
    assert.equal(conflict.existingBatchId, staged.batch.id);
  }
  const resumed = await json(await getImport(request(`/api/caretaker-import?batchId=${staged.batch.id}`)));
  assert.equal(resumed.childcareSession.id, original.id);
  assert.equal(resumed.batch.expiresAt, staged.batch.expiresAt);
  assert.equal(resumed.batch.revision, staged.batch.revision);
  assert.equal(Number((await db.execute("SELECT COUNT(*) AS n FROM paper_log_import_batches")).rows[0].n), 1);
  assert.equal(Number((await db.execute("SELECT COUNT(*) AS n FROM activities")).rows[0].n), 0);
  const saved = await json(await reviewImport(request("/api/caretaker-import/review", "PATCH", {
    batchId: resumed.batch.id, expectedRevision: resumed.batch.revision,
    rows: resumed.rows.map((row: Record<string, unknown>) => ({ id: row.id, action: "include" })),
    sleepCoverage: { startedAt: at("08:00"), endedAt: at("13:00"), napsChecked: true },
  })));
  const applied = await commitImport(request("/api/caretaker-import/commit", "POST", {
    batchId: saved.batch.id, expectedRevision: saved.batch.revision, requestId: "resumed-review-commit",
  }));
  assert.equal(applied.status, 200, await applied.clone().text());
  const sessions = (await db.execute("SELECT id, pending_import, import_batch_id FROM childcare_sessions")).rows;
  assert.equal(sessions.find(row => row.id === original.id)?.import_batch_id, staged.batch.id);
  assert.equal(sessions.find(row => row.id === other.id)?.pending_import, 1);
  const alreadyApplied = await json(await stageLinked(other.id, source, "later"));
  assert.equal(alreadyApplied.code, "SCREENSHOT_SESSION_CONFLICT");
  assert.equal(alreadyApplied.existingBatchId, undefined);
}));

test("an unlinked abandoned review can be reopened without attaching it to a new session", async () => fixture(async db => {
  const source = ocrLines(["Past Nap Times", "11:00 a.m. Nap End", "10:00 a.m. Nap Start"]);
  const staged = await json(await stageLinked("", source, "free"));
  const session = await closedSession();
  const retry = await stageLinked(session.id, source, "link");
  assert.equal(retry.status, 409);
  assert.equal((await json(retry)).existingBatchId, staged.batch.id);
  const resumed = await json(await getImport(request(`/api/caretaker-import?batchId=${staged.batch.id}`)));
  assert.equal(resumed.childcareSession, null);
  assert.equal((await db.execute({ sql: "SELECT childcare_session_id FROM paper_log_import_batches WHERE id = ?", args: [staged.batch.id] })).rows[0].childcare_session_id, null);
}));

test("a failed linked milk commit leaves the care log pending and all sleep/activity data untouched", async () => fixture(async db => {
  const session = await closedSession("08:00", "13:00");
  const stagedResponse = await stageLinked(session.id, ocrLines([
    "Past Milk Feeds", "9:00 a.m. 80 ml Breast Milk",
  ]), "milk");
  assert.equal(stagedResponse.status, 200, await stagedResponse.clone().text());
  const staged = await json(stagedResponse);
  const reviewedResponse = await reviewImport(request("/api/caretaker-import/review", "PATCH", {
    batchId: staged.batch.id,
    expectedRevision: staged.batch.revision,
    rows: staged.rows.map((row: Record<string, unknown>) => ({ id: row.id, action: "include" })),
    sleepCoverage: { startedAt: at("08:00"), endedAt: at("13:00"), napsChecked: true },
  }));
  assert.equal(reviewedResponse.status, 200, await reviewedResponse.clone().text());
  const reviewed = await json(reviewedResponse);
  const failed = await commitImport(request("/api/caretaker-import/commit", "POST", {
    batchId: staged.batch.id, expectedRevision: reviewed.batch.revision, requestId: "linked-milk-failure",
  }));
  assert.equal(failed.status, 400);
  assert.equal((await json(failed)).code, "INSUFFICIENT_BREASTMILK");
  const stored = (await db.execute({ sql: "SELECT * FROM childcare_sessions WHERE id = ?", args: [session.id] })).rows[0];
  assert.equal(stored.pending_import, 1);
  assert.equal(stored.import_batch_id, null);
  assert.equal(Number((await db.execute("SELECT COUNT(*) AS n FROM activities")).rows[0].n), 0);
  assert.equal(String((await db.execute({ sql: "SELECT status FROM paper_log_import_batches WHERE id = ?", args: [staged.batch.id] })).rows[0].status), "staged");
}));

test("concurrent identical commands replay once and a stale checkout cannot end a newer session", async () => fixture(async db => {
  const start = { action: "checkIn", babyId: "baby", requestId: "same-start-command", at: at("08:00") };
  const starts = await Promise.all([POST(request("/api/childcare-mode", "POST", start)), POST(request("/api/childcare-mode", "POST", start))]);
  assert.deepEqual(starts.map(r => r.status), [200, 200]);
  const bodies = await Promise.all(starts.map(json));
  assert.equal(bodies[0].session.id, bodies[1].session.id);
  assert.equal(bodies.filter(b => b.idempotent).length, 1);
  const end = { action: "checkOut", babyId: "baby", sessionId: bodies[0].session.id, requestId: "same-end-command", at: at("17:00") };
  const ends = await Promise.all([POST(request("/api/childcare-mode", "POST", end)), POST(request("/api/childcare-mode", "POST", end))]);
  assert.deepEqual(ends.map(r => r.status), [200, 200]);
  assert.equal(Number((await db.execute("SELECT COUNT(*) AS n FROM childcare_sessions")).rows[0].n), 1);
  const newer = await json(await POST(request("/api/childcare-mode", "POST", { action: "checkIn", babyId: "baby", requestId: "newer-start-command", at: at("17:30") })));
  const stale = await POST(request("/api/childcare-mode", "POST", { ...end, requestId: "stale-end-command", at: at("17:45") }));
  assert.equal(stale.status, 409);
  assert.equal((await json(stale)).code, "CHILDCARE_STATE_CHANGED");
  const current = await json(await GET(request("/api/childcare-mode?babyId=baby")));
  assert.equal(current.activeSession.id, newer.session.id);
  const mismatchedReplay = await POST(request("/api/childcare-mode", "POST", { ...end, sessionId: newer.session.id }));
  assert.equal(mismatchedReplay.status, 409);
  assert.equal((await json(mismatchedReplay)).code, "REQUEST_ID_CONFLICT");
}));

test("a missed checkout can record the actual prior-day time without persisting an unimportable overnight session", async () => fixture(async () => {
  const previousDay = 86400_000;
  const started = await json(await POST(request("/api/childcare-mode", "POST", { action: "checkIn", babyId: "baby", requestId: "missed-start-command", at: at("08:00") - previousDay })));
  const end = { action: "checkOut", babyId: "baby", sessionId: started.session.id, requestId: "missed-end-command", at: NOW };
  const wrongDate = await POST(request("/api/childcare-mode", "POST", end));
  assert.equal(wrongDate.status, 400);
  assert.equal((await json(wrongDate)).code, "CHILDCARE_DATE_MISMATCH");
  assert.equal((await json(await GET(request("/api/childcare-mode?babyId=baby")))).activeSession.id, started.session.id);
  const corrected = await POST(request("/api/childcare-mode", "POST", { ...end, requestId: "corrected-end-command", at: at("17:00") - previousDay }));
  assert.equal(corrected.status, 200);
  assert.equal((await json(corrected)).session.checkedOutAt, at("17:00") - previousDay);
}));

test("mode commands and linked imports reject foreign babies, sessions, members and cross-site requests", async () => fixture(async db => {
  const session = await closedSession();
  await db.batch([
    { sql: "INSERT INTO households VALUES ('foreign-house','FOREIGN',?)", args: [NOW] },
    { sql: "INSERT INTO users VALUES ('foreign-member','foreign-house','Other parent',?)", args: [NOW] },
    { sql: "INSERT INTO babies VALUES ('foreign-baby','foreign-house','Other baby',NULL,?)", args: [NOW] },
    { sql: "INSERT INTO childcare_sessions (id,baby_id,checked_in_at,checked_out_at,check_in_request_id,pending_import,created_at,updated_at) VALUES ('foreign-session','foreign-baby',?,?,?,1,?,?)", args: [at("08:00"), at("17:00"), "foreign-start-command", NOW, NOW] },
  ], "write");
  const foreign = await stageLinked("foreign-session", ocrLines(["Past Nap Times"]), "foreign");
  assert.equal(foreign.status, 409);
  assert.equal((await json(foreign)).code, "CHILDCARE_SESSION_UNAVAILABLE");
  const mode = await POST(request("/api/childcare-mode", "POST", { action: "checkIn", babyId: "foreign-baby", requestId: "foreign-baby-command" }));
  assert.equal(mode.status, 404);
  const anonymous = await GET(new NextRequest("http://localhost/api/childcare-mode?babyId=baby"));
  assert.equal(anonymous.status, 401);
  const wrongMember = await GET(new NextRequest("http://localhost/api/childcare-mode?babyId=baby", { headers: { cookie: "mcphee_hh=house; mcphee_user=foreign-member" } }));
  assert.equal(wrongMember.status, 401);
  const crossSite = await POST(new NextRequest("http://localhost/api/childcare-mode", { method: "POST", headers: { origin: "https://foreign.invalid", cookie: "mcphee_hh=house; mcphee_user=member", "content-type": "application/json" }, body: JSON.stringify({ action: "checkIn", babyId: "baby", requestId: "cross-site-command" }) }));
  assert.equal(crossSite.status, 403);
  assert.equal((await json(await GET(request("/api/childcare-mode?babyId=baby")))).pendingSessions[0].id, session.id);
}));

test("sleep transitions and new medication doses require childcare consent without blocking idempotent dose replay", async () => fixture(async db => {
  await applySickModeSchema(db);
  await db.execute({ sql: "INSERT INTO sick_mode_episodes (id,baby_id,started_at,baseline_daily_ml,baseline_kind,baseline_available_day_count,baseline_source_days,created_at) VALUES ('episode','baby',?,600,'manual',0,'[]',?)", args: [at("07:00"), NOW] });
  await db.execute({ sql: "INSERT INTO sick_mode_medications (id,episode_id,name,dose_text,as_needed,created_at,updated_at) VALUES ('medicine','episode','Synthetic medication','2 ml',1,?,?)", args: [NOW, NOW] });
  await POST(request("/api/childcare-mode", "POST", { action: "checkIn", babyId: "baby", requestId: "guarded-care-command", at: at("08:00") }));
  const sleep = { babyId: "baby", action: "sleep" };
  const blockedSleep = await sleepState(request("/api/sleep-state", "POST", sleep));
  assert.equal(blockedSleep.status, 409);
  assert.equal((await json(blockedSleep)).code, "CHILDCARE_CONFIRMATION_REQUIRED");
  assert.equal((await sleepState(request("/api/sleep-state", "POST", { ...sleep, childcareOverride: true }))).status, 200);
  const wake = { babyId: "baby", action: "wake" };
  assert.equal((await sleepState(request("/api/sleep-state", "POST", wake))).status, 409);
  assert.equal((await sleepState(request("/api/sleep-state", "POST", { ...wake, childcareOverride: true }))).status, 200);
  const dose = { action: "logDose", babyId: "baby", episodeId: "episode", medicationId: "medicine", givenAt: at("10:00"), doseText: "2 ml", requestId: "guarded-dose-command" };
  const blockedDose = await sickMode(request("/api/sick-mode", "POST", dose));
  assert.equal(blockedDose.status, 409);
  assert.equal(Number((await db.execute("SELECT COUNT(*) AS n FROM sick_mode_doses")).rows[0].n), 0);
  const accepted = await sickMode(request("/api/sick-mode", "POST", { ...dose, childcareOverride: true }));
  assert.equal(accepted.status, 200, await accepted.clone().text());
  const replay = await sickMode(request("/api/sick-mode", "POST", dose));
  assert.equal(replay.status, 200);
  assert.equal((await json(replay)).idempotent, true);
  assert.equal(Number((await db.execute("SELECT COUNT(*) AS n FROM sick_mode_doses")).rows[0].n), 1);
}));

test("absent or partial childcare schema remains unavailable without creating schema on a read", async () => fixture(async db => {
  for (const partial of [false, true]) {
    if (partial) await db.execute("CREATE TABLE childcare_sessions (id TEXT PRIMARY KEY)");
    const state = await json(await GET(request("/api/childcare-mode?babyId=baby")));
    assert.deepEqual(state, { schemaReady: false, activeSession: null, pendingSessions: [], historySessions: [] });
    const response = await POST(request("/api/childcare-mode", "POST", { action: "checkIn", babyId: "baby", requestId: "unready-schema-command" }));
    assert.equal(response.status, 503);
  }
  const columns = await db.execute("PRAGMA table_info(childcare_sessions)");
  assert.deepEqual(columns.rows.map(row => row.name), ["id"]);
}, false));
