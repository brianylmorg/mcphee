import assert from "node:assert/strict";
import test from "node:test";
import { createClient, type Client } from "@libsql/client";
import { NextRequest } from "next/server";
import webpush from "web-push";

import { applyChildcareModeSchema } from "@/db/childcare-mode-schema";
import { applySickModeSchema } from "@/db/sick-mode-schema";
import { GET } from "./route";

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const at = (sgt: string) => Date.parse(`2026-11-22T${sgt}:00+08:00`);

let clock = at("10:00");
let delivered: { endpoint: string; payload: Record<string, unknown> }[] = [];
let failWith: number | null = null;

function notify() {
  return GET(new NextRequest("http://localhost/api/notify", { headers: { authorization: "Bearer cron-secret" } }));
}

async function fixture(run: (db: Client) => Promise<void>) {
  const previous = {
    url: process.env.TURSO_DATABASE_URL,
    token: process.env.TURSO_AUTH_TOKEN,
    cron: process.env.CRON_SECRET,
    vapid: [process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY, process.env.VAPID_SUBJECT],
    now: Date.now,
    send: webpush.sendNotification,
    setVapid: webpush.setVapidDetails,
  };
  const url = `file:/tmp/mcphee-notify-${process.pid}-${Math.random().toString(36).slice(2)}.db`;
  process.env.TURSO_DATABASE_URL = url;
  delete process.env.TURSO_AUTH_TOKEN;
  process.env.CRON_SECRET = "cron-secret";
  process.env.VAPID_PUBLIC_KEY = "public";
  process.env.VAPID_PRIVATE_KEY = "private";
  process.env.VAPID_SUBJECT = "mailto:test@example.com";
  clock = at("10:00");
  delivered = [];
  failWith = null;
  Date.now = () => clock;
  webpush.setVapidDetails = () => {};
  webpush.sendNotification = (async (sub: { endpoint: string }, payload: string) => {
    if (failWith != null) throw Object.assign(new Error("push failed"), { statusCode: failWith });
    delivered.push({ endpoint: sub.endpoint, payload: JSON.parse(payload) });
    return { statusCode: 201, body: "", headers: {} };
  }) as typeof webpush.sendNotification;
  const db = createClient({ url });
  try {
    for (const sql of [
      "CREATE TABLE households (id TEXT PRIMARY KEY, invite_code TEXT, created_at INTEGER)",
      "CREATE TABLE users (id TEXT PRIMARY KEY, household_id TEXT, name TEXT, created_at INTEGER)",
      "CREATE TABLE babies (id TEXT PRIMARY KEY, household_id TEXT, name TEXT, birth_date INTEGER, created_at INTEGER)",
      "CREATE TABLE activities (id TEXT PRIMARY KEY, baby_id TEXT, type TEXT, started_at INTEGER, ended_at INTEGER, details TEXT, created_at INTEGER, created_by TEXT)",
      "CREATE TABLE active_timers (id TEXT PRIMARY KEY, baby_id TEXT, type TEXT, started_at INTEGER, current_side TEXT, side_switches TEXT, started_by TEXT)",
      "CREATE TABLE push_subscriptions (id TEXT PRIMARY KEY, household_id TEXT, endpoint TEXT, p256dh TEXT, auth TEXT, label TEXT)",
      "CREATE TABLE notification_log (id TEXT PRIMARY KEY, household_id TEXT, kind TEXT, sent_at INTEGER)",
      "CREATE TABLE paper_log_import_batches (id TEXT PRIMARY KEY, household_id TEXT, baby_id TEXT, status TEXT, source_note TEXT, created_at INTEGER, created_by TEXT)",
    ]) await db.execute(sql);
    await applySickModeSchema(db);
    await applyChildcareModeSchema(db);
    await db.batch([
      { sql: "INSERT INTO households VALUES ('house','INVITE',?)", args: [clock] },
      { sql: "INSERT INTO households VALUES ('quiet','QUIET1',?)", args: [clock] },
      { sql: "INSERT INTO users VALUES ('alex','house','Alex',?)", args: [clock] },
      { sql: "INSERT INTO babies VALUES ('baby','house','Robin',NULL,?)", args: [clock] },
      { sql: "INSERT INTO babies VALUES ('quietbaby','quiet','Sam',NULL,?)", args: [clock] },
      { sql: "INSERT INTO push_subscriptions VALUES ('s1','house','https://push.example/1','p','a',NULL)", args: [] },
      // Last night ended 07:00; feed at 07:00.
      { sql: "INSERT INTO activities VALUES ('night','baby','sleep',?,?,NULL,?,NULL)", args: [at("07:00") - 10 * HOUR, at("07:00"), clock] },
      { sql: "INSERT INTO activities VALUES ('feed','baby','bottlefeed',?,NULL,'{}',?,NULL)", args: [at("07:00"), clock] },
      // The other household has a due feed but no enabled device.
      { sql: "INSERT INTO activities VALUES ('qfeed','quietbaby','bottlefeed',?,NULL,'{}',?,NULL)", args: [at("07:00"), clock] },
    ], "write");
    await run(db);
  } finally {
    db.close();
    Date.now = previous.now;
    webpush.sendNotification = previous.send;
    webpush.setVapidDetails = previous.setVapid;
    for (const [key, value] of [
      ["TURSO_DATABASE_URL", previous.url], ["TURSO_AUTH_TOKEN", previous.token], ["CRON_SECRET", previous.cron],
      ["VAPID_PUBLIC_KEY", previous.vapid[0]], ["VAPID_PRIVATE_KEY", previous.vapid[1]], ["VAPID_SUBJECT", previous.vapid[2]],
    ] as const) {
      if (value == null) delete process.env[key]; else process.env[key] = value;
    }
  }
}

test("rejects calls without the cron secret", async () => {
  await fixture(async () => {
    const response = await GET(new NextRequest("http://localhost/api/notify"));
    assert.equal(response.status, 401);
  });
});

test("a due feed pushes once, only to enabled devices", async () => {
  await fixture(async (db) => {
    clock = at("09:44");
    assert.deepEqual((await (await notify()).json()).keys, []);

    clock = at("09:45");
    assert.deepEqual((await (await notify()).json()).keys, ["feed:feed"]);
    assert.equal(delivered.length, 1);
    assert.equal(delivered[0].endpoint, "https://push.example/1");
    assert.deepEqual(delivered[0].payload, { title: "Milk time", body: "Robin's last feed was at 07:00, 2h45 ago.", url: "/dashboard", tag: "feed" });

    clock = at("10:30");
    assert.deepEqual((await (await notify()).json()).keys, []);
    assert.equal(delivered.length, 1);

    const logged = await db.execute("SELECT household_id, kind FROM notification_log");
    assert.deepEqual(logged.rows.map((row) => [row.household_id, row.kind]), [["house", "feed:feed"]]);
  });
});

test("no feed push while asleep or checked in at childcare", async () => {
  await fixture(async (db) => {
    clock = at("09:50");
    await db.execute({ sql: "INSERT INTO activities VALUES ('nap','baby','sleep',?,NULL,NULL,?,NULL)", args: [at("09:30"), clock] });
    assert.deepEqual((await (await notify()).json()).keys, []);
    await db.execute("DELETE FROM activities WHERE id = 'nap'");
    await db.execute({
      sql: "INSERT INTO childcare_sessions (id, baby_id, checked_in_at, check_in_request_id, created_at, updated_at) VALUES ('care','baby',?,'req',?,?)",
      args: [at("08:00"), clock, clock],
    });
    assert.deepEqual((await (await notify()).json()).keys, []);
  });
});

test("a failed delivery is retried on the next run; a gone device is removed", async () => {
  await fixture(async (db) => {
    clock = at("09:45");
    failWith = 500;
    assert.deepEqual((await (await notify()).json()).keys, []);
    failWith = null;
    assert.deepEqual((await (await notify()).json()).keys, ["feed:feed"]);

    await db.execute({ sql: "INSERT INTO activities VALUES ('feed2','baby','bottlefeed',?,NULL,'{}',?,NULL)", args: [at("09:50"), clock] });
    clock = at("12:40");
    failWith = 410;
    assert.deepEqual((await (await notify()).json()).keys, []);
    assert.equal((await db.execute("SELECT COUNT(*) AS n FROM push_subscriptions")).rows[0].n, 0);
  });
});

test("a scheduled dose pushes when due with the giver's name; as-needed does not", async () => {
  await fixture(async (db) => {
    clock = at("10:00");
    // A feed just now keeps the feed push out of this test.
    await db.execute({ sql: "INSERT INTO activities VALUES ('feed2','baby','bottlefeed',?,NULL,'{}',?,NULL)", args: [at("09:55"), clock] });
    await db.execute({
      sql: `INSERT INTO sick_mode_episodes (id, baby_id, started_at, ended_at, baseline_daily_ml, baseline_kind, baseline_available_day_count, baseline_source_days, created_at)
            VALUES ('ep','baby',?,NULL,700,'manual',0,'[]',?)`,
      args: [at("07:00"), clock],
    });
    await db.batch([
      { sql: "INSERT INTO sick_mode_medications (id, episode_id, name, dose_text, as_needed, min_interval_minutes, max_interval_minutes, created_at, updated_at) VALUES ('para','ep','Paracetamol','3.5 ml',0,360,NULL,?,?)", args: [clock, clock] },
      { sql: "INSERT INTO sick_mode_medications (id, episode_id, name, dose_text, as_needed, min_interval_minutes, max_interval_minutes, created_at, updated_at) VALUES ('ibu','ep','Ibuprofen','2 ml',1,360,NULL,?,?)", args: [clock, clock] },
      { sql: "INSERT INTO sick_mode_doses (id, medication_id, given_at, dose_text, given_by, request_id, created_at, updated_at) VALUES ('d1','para',?,'3.5 ml','alex','r1',?,?)", args: [at("08:00"), clock, clock] },
      { sql: "INSERT INTO sick_mode_doses (id, medication_id, given_at, dose_text, given_by, request_id, created_at, updated_at) VALUES ('d2','ibu',?,'2 ml','alex','r2',?,?)", args: [at("08:00"), clock, clock] },
      // A deleted later dose does not count as the latest.
      { sql: "INSERT INTO sick_mode_doses (id, medication_id, given_at, dose_text, given_by, request_id, created_at, updated_at, deleted_at) VALUES ('d0','para',?,'3.5 ml','alex','r0',?,?,?)", args: [at("09:00"), clock, clock, clock] },
    ], "write");

    clock = at("14:00");
    // Keep the feed push out: log a feed just before.
    await db.execute({ sql: "INSERT INTO activities VALUES ('feed3','baby','bottlefeed',?,NULL,'{}',?,NULL)", args: [at("13:55"), clock] });
    assert.deepEqual((await (await notify()).json()).keys, ["med:para:d1:due"]);
    assert.deepEqual(delivered.at(-1)?.payload, { title: "Paracetamol due", body: "3.5 ml. Last given at 08:00 by Alex.", url: "/dashboard", tag: "med:para" });

    clock = at("14:30");
    assert.deepEqual((await (await notify()).json()).keys, ["med:para:d1:late"]);
  });
});

test("night: feed push suppressed, scheduled dose still pushes", async () => {
  await fixture(async (db) => {
    clock = at("21:00");
    await db.batch([
      { sql: "INSERT INTO activities VALUES ('eve','baby','bottlefeed',?,NULL,'{}',?,NULL)", args: [at("18:00"), clock] },
      {
        sql: `INSERT INTO sick_mode_episodes (id, baby_id, started_at, ended_at, baseline_daily_ml, baseline_kind, baseline_available_day_count, baseline_source_days, created_at)
              VALUES ('ep','baby',?,NULL,700,'manual',0,'[]',?)`,
        args: [at("07:00"), clock],
      },
      { sql: "INSERT INTO sick_mode_medications (id, episode_id, name, dose_text, as_needed, min_interval_minutes, max_interval_minutes, created_at, updated_at) VALUES ('abx','ep','Amoxicillin','5 ml',0,480,NULL,?,?)", args: [clock, clock] },
      { sql: "INSERT INTO sick_mode_doses (id, medication_id, given_at, dose_text, given_by, request_id, created_at, updated_at) VALUES ('d1','abx',?,'5 ml',NULL,'r1',?,?)", args: [at("13:00"), clock, clock] },
    ], "write");
    assert.deepEqual((await (await notify()).json()).keys, ["med:abx:d1:due"]);
  });
});

test("nap zone push uses his own wake windows", async () => {
  await fixture(async (db) => {
    // Seven earlier days: wake 07:00, first nap 09:00-10:00, so window 1 is 2h.
    const rows = [];
    for (let day = 1; day <= 7; day += 1) {
      const wake = at("07:00") - day * 24 * HOUR;
      rows.push({ sql: "INSERT INTO activities VALUES (?,'baby','sleep',?,?,NULL,?,NULL)", args: [`n${day}`, wake - 10 * HOUR, wake, clock] });
      rows.push({ sql: "INSERT INTO activities VALUES (?,'baby','sleep',?,?,NULL,?,NULL)", args: [`a${day}`, wake + 2 * HOUR, wake + 3 * HOUR, clock] });
      rows.push({ sql: "INSERT INTO activities VALUES (?,'baby','sleep',?,?,NULL,?,NULL)", args: [`b${day}`, wake + 12 * HOUR, wake + 12 * HOUR + MIN, clock] });
    }
    // Feed just now so only the nap push is due.
    rows.push({ sql: "INSERT INTO activities VALUES ('feed2','baby','bottlefeed',?,NULL,'{}',?,NULL)", args: [at("08:30"), clock] });
    await db.batch(rows, "write");

    clock = at("08:45");
    assert.deepEqual((await (await notify()).json()).keys, []);
    clock = at("08:52");
    assert.deepEqual((await (await notify()).json()).keys, [`nap:${at("07:00")}`]);
    assert.equal(delivered.at(-1)?.payload.title, "Nap zone in 8m");
    clock = at("09:05");
    assert.deepEqual((await (await notify()).json()).keys, []);
  });
});
