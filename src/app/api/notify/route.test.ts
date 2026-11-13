import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { rm } from "node:fs/promises";
import { createClient } from "@libsql/client";
import { NextRequest } from "next/server";
import webpush from "web-push";
import { createDB } from "@/db";
import { applySickModeSchema } from "@/db/sick-mode-schema";
import { GET } from "./route";

const DAY = 86400_000;
const NOW = Date.parse("2026-11-12T17:45:00+08:00");
const request = (authorized = true) => new NextRequest("http://localhost/api/notify", {
  headers: authorized ? { authorization: "Bearer test-cron" } : {},
});

async function fixture(t: TestContext, { subscriptions = true } = {}) {
  const previous = { ...process.env };
  const path = `/tmp/mcphee-nightplan-${process.pid}-${Math.random().toString(36).slice(2)}.db`;
  process.env.TURSO_DATABASE_URL = `file:${path}`;
  process.env.TURSO_AUTH_TOKEN = "";
  process.env.CRON_SECRET = "test-cron";
  process.env.VAPID_PUBLIC_KEY = "stubbed";
  process.env.VAPID_PRIVATE_KEY = "stubbed";
  process.env.VAPID_SUBJECT = "mailto:test@example.invalid";
  t.mock.method(Date, "now", () => NOW);
  t.mock.method(webpush, "setVapidDetails", () => {});
  const payloads: Array<{ endpoint: string; payload: { title: string; body: string; url: string } }> = [];
  const send = t.mock.method(webpush, "sendNotification", async (sub: webpush.PushSubscription, payload: string | Buffer | null) => {
    payloads.push({ endpoint: sub.endpoint, payload: JSON.parse(String(payload)) });
    return { statusCode: 201, body: "", headers: {} };
  });
  const db = createClient({ url: `file:${path}` });
  t.after(async () => {
    createDB().close();
    db.close();
    for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
    Object.assign(process.env, previous);
    await rm(path, { force: true });
  });
  for (const sql of [
    "CREATE TABLE households (id TEXT PRIMARY KEY)",
    "CREATE TABLE babies (id TEXT PRIMARY KEY, household_id TEXT, name TEXT, created_at INTEGER)",
    "CREATE TABLE activities (id TEXT PRIMARY KEY, baby_id TEXT, type TEXT, started_at INTEGER, ended_at INTEGER, details TEXT)",
    "CREATE TABLE measurements (id TEXT PRIMARY KEY, baby_id TEXT, measured_at INTEGER, weight_g INTEGER, created_at INTEGER)",
    "CREATE TABLE push_subscriptions (id TEXT PRIMARY KEY, household_id TEXT, endpoint TEXT, p256dh TEXT, auth TEXT)",
    "CREATE TABLE notification_log (id TEXT PRIMARY KEY, household_id TEXT, kind TEXT, sent_at INTEGER)",
    "INSERT INTO households VALUES ('house')",
    "INSERT INTO babies VALUES ('baby', 'house', 'Robin', 1)",
  ]) await db.execute(sql);
  await applySickModeSchema(db);
  // Existing overdue throttle proves its continue cannot suppress the plan.
  await db.execute({ sql: "INSERT INTO notification_log VALUES ('overdue', 'house', 'overdue', ?)", args: [NOW] });
  if (subscriptions) for (const id of ["one", "two"]) await db.execute({
    sql: "INSERT INTO push_subscriptions VALUES (?, 'house', ?, 'key', 'auth')", args: [id, `https://example.invalid/${id}`],
  });
  for (let i = 1; i <= 4; i++) {
    const start = Date.parse("2026-11-12T20:00:00+08:00") - i * DAY;
    for (const [id, type, at, end, ml] of [
      [`sleep${i}`, "sleep", start, start + 11 * 3600_000, 0],
      [`day${i}`, "bottlefeed", start - 8 * 3600_000, null, 800],
      [`night${i}`, "bottlefeed", start + 3600_000, null, 120],
    ] as const) await db.execute({
      sql: "INSERT INTO activities VALUES (?, 'baby', ?, ?, ?, ?)", args: [id, type, at, end, JSON.stringify({ amount: ml, milkType: "formula" })],
    });
  }
  return { db, payloads, send };
}

async function run() {
  const response = await GET(request());
  assert.equal(response.status, 200, await response.clone().text());
  return response.json();
}

test("sends the plan to every subscription once, independently of overdue, then throttles for 20h", async (t) => {
  const { db, payloads } = await fixture(t);
  assert.equal((await run()).nightplanSent, 1);
  assert.equal(payloads.length, 2);
  assert.deepEqual(payloads[0].payload, { title: "mcphee", body: "Milk since 7am: 0 of 650 ml. Tonight: Evening 100 ml.", url: "/dashboard" });
  assert.equal((await run()).nightplanSent, 0);
  assert.equal(payloads.length, 2);
  await db.execute({ sql: "UPDATE notification_log SET sent_at = ? WHERE kind = 'nightplan'", args: [NOW - 20 * 3600_000 + 1] });
  assert.equal((await run()).nightplanSent, 0);
  await db.execute({ sql: "UPDATE notification_log SET sent_at = ? WHERE kind = 'nightplan'", args: [NOW - 20 * 3600_000] });
  assert.equal((await run()).nightplanSent, 1);
  assert.equal(payloads.length, 4);
});

test("skips paused plans", async (t) => {
  const { db, payloads } = await fixture(t);
  await db.execute({
    sql: "INSERT INTO sick_mode_episodes (id, baby_id, started_at, baseline_daily_ml, baseline_kind, baseline_available_day_count, baseline_source_days, created_at) VALUES ('sick', 'baby', ?, 800, 'manual', 0, '[]', ?)",
    args: [NOW - DAY, NOW - DAY],
  });
  assert.equal((await run()).nightplanSent, 0);
  assert.equal(payloads.length, 0);
});

test("skips without subscriptions or enough history and requires ready sick schema", async (t) => {
  const { db, payloads } = await fixture(t, { subscriptions: false });
  assert.equal((await run()).nightplanSent, 0);
  await db.execute("INSERT INTO push_subscriptions VALUES ('one', 'house', 'https://example.invalid/one', 'key', 'auth')");
  await db.execute("DELETE FROM activities WHERE id = 'sleep4'");
  assert.equal((await run()).nightplanSent, 0);
  await db.execute("DROP INDEX idx_sick_mode_episodes_one_active");
  assert.equal((await run()).nightplanSent, 0);
  assert.equal(payloads.length, 0);
});

test("410 removes only the expired household subscription and still sends to other devices", async (t) => {
  const { db, send, payloads } = await fixture(t);
  send.mock.mockImplementationOnce(async () => { throw Object.assign(new Error("gone"), { statusCode: 410 }); });
  assert.equal((await run()).nightplanSent, 1);
  assert.equal(payloads.length, 1);
  const rows = await db.execute("SELECT endpoint FROM push_subscriptions");
  assert.equal(rows.rows.length, 1);
});

test("unauthorized is 401 and cannot send", async (t) => {
  const { payloads } = await fixture(t);
  assert.equal((await GET(request(false))).status, 401);
  assert.equal(payloads.length, 0);
});
