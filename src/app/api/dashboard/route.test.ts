import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { createClient, type Client } from "@libsql/client";
import { NextRequest } from "next/server";

import { GET as getDashboard } from "./route";
import { GET as legacyDashboard } from "./__fixtures__/legacy-dashboard";
import { GET as runMigrations } from "@/app/api/admin/migrate/route";
import { POST as postActivity } from "@/app/api/activities/route";
import { POST as startTimer } from "@/app/api/active-timers/route";
import {
  DASHBOARD_VERSION_TABLES,
  isDashboardVersionSchemaReady,
} from "@/db/dashboard-version-schema";

const HOUR = 60 * 60 * 1000;
const MINUTE = 60 * 1000;
const sgt = (date: string, time = "12:00") => Date.parse(`${date}T${time}:00+08:00`);
// Fixed clock for the fixture: mid-afternoon in Singapore.
const NOW = sgt("2026-10-20", "15:00");

function dashboardRequest(opts: { household?: string; ifNoneMatch?: string | null } = {}) {
  const headers = new Headers({ cookie: `mcphee_hh=${opts.household ?? "house-1"}; mcphee_user=user-1` });
  if (opts.ifNoneMatch) headers.set("if-none-match", opts.ifNoneMatch);
  return new NextRequest("http://localhost/api/dashboard", { headers });
}

function jsonRequest(path: string, body: unknown) {
  return new NextRequest(`http://localhost${path}`, {
    method: "POST",
    headers: { cookie: "mcphee_hh=house-1; mcphee_user=user-1", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function openDb(t: TestContext, opts: { migrate?: boolean } = {}) {
  const saved = {
    url: process.env.TURSO_DATABASE_URL,
    token: process.env.TURSO_AUTH_TOKEN,
    key: process.env.MIGRATION_KEY,
  };
  const path = `/tmp/mcphee-dashboard-${process.pid}-${Math.random().toString(36).slice(2)}.db`;
  process.env.TURSO_DATABASE_URL = `file:${path}`;
  delete process.env.TURSO_AUTH_TOKEN;
  process.env.MIGRATION_KEY = "test-key";
  const client = createClient({ url: `file:${path}` });
  t.after(() => {
    client.close();
    for (const [name, value] of [["TURSO_DATABASE_URL", saved.url], ["TURSO_AUTH_TOKEN", saved.token], ["MIGRATION_KEY", saved.key]] as const) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });
  if (opts.migrate !== false) await migrate();
  return client;
}

async function migrate() {
  const response = await runMigrations(new NextRequest("http://localhost/api/admin/migrate?key=test-key"));
  assert.equal(response.status, 200, await response.clone().text());
}

async function insertActivity(
  client: Client,
  row: { id: string; baby?: string; type: string; at: number; ended?: number | null; details?: unknown; createdBy?: string },
) {
  await client.execute({
    sql: `INSERT INTO activities (id, baby_id, type, started_at, ended_at, details, created_at, created_by)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      row.id,
      row.baby ?? "baby-1",
      row.type,
      row.at,
      row.ended ?? null,
      row.details === undefined ? null : JSON.stringify(row.details),
      row.at,
      row.createdBy ?? "Mum",
    ],
  });
}

/**
 * Two households. house-1 has two babies and every kind of dashboard input:
 * more than 50 recent entries, today's and older milk, a frozen packet near its
 * expiry, future-dated entries, open and closed sleeps, a timer, a weight, a
 * childcare session and a committed caretaker import.
 */
async function seed(client: Client) {
  const stmts: Array<{ sql: string; args: unknown[] }> = [
    { sql: "INSERT INTO households (id, invite_code, created_at) VALUES (?, ?, ?)", args: ["house-1", "AAA111", sgt("2026-07-01")] },
    { sql: "INSERT INTO households (id, invite_code, created_at) VALUES (?, ?, ?)", args: ["house-2", "BBB222", sgt("2026-07-01")] },
    { sql: "INSERT INTO users (id, household_id, name, created_at) VALUES (?, ?, ?, ?)", args: ["user-1", "house-1", "Mum", sgt("2026-07-01")] },
    { sql: "INSERT INTO users (id, household_id, name, created_at) VALUES (?, ?, ?, ?)", args: ["user-2", "house-1", "JY", sgt("2026-07-01")] },
    { sql: "INSERT INTO users (id, household_id, name, created_at) VALUES (?, ?, ?, ?)", args: ["user-3", "house-2", "Dad", sgt("2026-07-01")] },
    { sql: "INSERT INTO babies (id, household_id, name, birth_date, created_at) VALUES (?, ?, ?, ?, ?)", args: ["baby-1", "house-1", "Pip", sgt("2026-07-01"), sgt("2026-07-01")] },
    { sql: "INSERT INTO babies (id, household_id, name, birth_date, created_at) VALUES (?, ?, ?, ?, ?)", args: ["baby-2", "house-1", "Pod", sgt("2026-07-01"), sgt("2026-07-02")] },
    { sql: "INSERT INTO babies (id, household_id, name, birth_date, created_at) VALUES (?, ?, ?, ?, ?)", args: ["baby-3", "house-2", "Other", sgt("2026-08-01"), sgt("2026-08-01")] },
    { sql: "INSERT INTO measurements (id, baby_id, measured_at, weight_g, created_at) VALUES (?, ?, ?, ?, ?)", args: ["m-1", "baby-1", sgt("2026-10-01"), 5200, sgt("2026-10-01")] },
    { sql: "INSERT INTO measurements (id, baby_id, measured_at, weight_g, created_at) VALUES (?, ?, ?, ?, ?)", args: ["m-2", "baby-1", sgt("2026-10-15"), 5600, sgt("2026-10-15")] },
    {
      sql: "INSERT INTO active_timers (id, baby_id, type, started_at, current_side, side_switches, started_by) VALUES (?, ?, ?, ?, ?, ?, ?)",
      args: ["timer-1", "baby-2", "breastfeed", NOW - 20 * MINUTE, "left", "[]", "Mum"],
    },
  ];
  for (const stmt of stmts) await client.execute(stmt as never);

  // Three weeks of interleaved history for both babies (well over 50 rows).
  let n = 0;
  for (let day = 21; day >= 0; day -= 1) {
    const base = NOW - day * 24 * HOUR;
    for (const [offset, baby] of [[-9 * HOUR, "baby-1"], [-7 * HOUR, "baby-2"], [-5 * HOUR, "baby-1"], [-3 * HOUR, "baby-1"]] as const) {
      const at = base + offset - (n % 7) * MINUTE;
      n += 1;
      await insertActivity(client, { id: `bf-${n}`, baby, type: "bottlefeed", at, details: { milkType: n % 3 ? "breastmilk" : "formula", amount: 60 + (n % 5) * 10 }, createdBy: n % 4 ? "Mum" : "user-2" });
      await insertActivity(client, { id: `pump-${n}`, baby, type: "pump", at: at - 30 * MINUTE, details: { amount: 90 } });
      await insertActivity(client, { id: `diaper-${n}`, baby, type: "diaper", at: at + 10 * MINUTE, details: { kind: "wet" } });
    }
    await insertActivity(client, { id: `sleep-${day}`, type: "sleep", at: base - 2 * HOUR, ended: base - HOUR });
  }
  await insertActivity(client, { id: "sleep-open", type: "sleep", at: NOW - 40 * MINUTE, ended: null });
  await insertActivity(client, { id: "adjust-1", type: "bankadjust", at: NOW - 6 * 24 * HOUR, details: { amount: 120 } });
  await insertActivity(client, { id: "adjust-2", type: "bankadjust", at: NOW - 5 * 24 * HOUR, details: { amount: -30 } });
  // Frozen packet whose 3-month expiry falls 45 minutes after NOW.
  await insertActivity(client, { id: "freeze-old", type: "bankfreeze", at: Date.parse("2026-07-20T07:45:00Z"), details: { amount: 100, source: "reconcile" } });
  await insertActivity(client, { id: "freeze-new", type: "bankfreeze", at: NOW - 2 * 24 * HOUR, details: { amount: 80, source: "available" } });
  await insertActivity(client, { id: "thaw-1", type: "bankthaw", at: NOW - 24 * HOUR, details: { packetId: "freeze-new", amount: 80 } });
  // Future-dated entries go live 20 minutes and 3 hours after NOW.
  await insertActivity(client, { id: "pump-future", type: "pump", at: NOW + 20 * MINUTE, details: { amount: 150 } });
  await insertActivity(client, { id: "bf-future", type: "bottlefeed", at: NOW + 3 * HOUR, details: { milkType: "breastmilk", amount: 70 } });
  // house-2 gets a little data of its own.
  await insertActivity(client, { id: "other-1", baby: "baby-3", type: "bottlefeed", at: NOW - HOUR, details: { milkType: "formula", amount: 50 } });

  const childcareColumns = await client.execute("SELECT name FROM pragma_table_info('childcare_sessions')");
  if (childcareColumns.rows.length > 0) {
    await client.execute({
      sql: `INSERT INTO childcare_sessions (id, baby_id, checked_in_at, checked_out_at, check_in_request_id, pending_import, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      args: ["cc-1", "baby-1", NOW - 26 * HOUR, NOW - 18 * HOUR, "req-1", 1, NOW - 26 * HOUR, NOW - 18 * HOUR],
    });
  }
}

const etag = (response: Response) => response.headers.get("etag");

// The old query left entries with the same start time in arbitrary order; the
// new one breaks ties newest-entered first. Compare with ties ordered alike.
type Row = { started_at: number; created_at: number; id: string };
function tieOrdered<T extends { activities?: Row[] }>(body: T): T {
  if (!Array.isArray(body.activities)) return body;
  const activities = [...body.activities].sort((a, b) =>
    b.started_at - a.started_at || b.created_at - a.created_at || a.id.localeCompare(b.id));
  return { ...body, activities };
}

async function dashboardJson(handler: typeof getDashboard, opts?: Parameters<typeof dashboardRequest>[0]) {
  const response = await handler(dashboardRequest(opts));
  assert.equal(response.status, 200);
  return response.json();
}

function setClock(t: TestContext, at: number) {
  t.mock.timers.enable({ apis: ["Date"], now: at });
}

test("migration creates the counter and triggers, is idempotent, and bumps the counter", async (t) => {
  const client = await openDb(t);
  assert.equal(await isDashboardVersionSchemaReady(client), true);
  const triggers = await client.execute("SELECT name FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'trg_dashboard_version_%'");
  assert.equal(triggers.rows.length, DASHBOARD_VERSION_TABLES.length * 3);
  const before = Number((await client.execute("SELECT version FROM dashboard_version")).rows[0].version);
  await migrate();
  const rows = await client.execute("SELECT version FROM dashboard_version");
  assert.equal(rows.rows.length, 1, "exactly one counter row");
  assert.ok(Number(rows.rows[0].version) > before, "re-running migrations invalidates cached dashboards");
});

test("responses are identical to the pre-change route at many points in time", async (t) => {
  const client = await openDb(t);
  await seed(client);
  const instants = [
    NOW,
    NOW + 19 * MINUTE,
    NOW + 21 * MINUTE,
    NOW + 44 * MINUTE,
    NOW + 46 * MINUTE,
    NOW + 3 * HOUR + MINUTE,
    sgt("2026-10-20", "23:59"),
    sgt("2026-10-21", "00:00"),
    sgt("2026-10-21", "00:01"),
    sgt("2026-10-22", "09:00"),
  ];
  for (const at of instants) {
    t.mock.timers.reset();
    setClock(t, at);
    for (const household of ["house-1", "house-2", "missing-house"]) {
      const legacy = await dashboardJson(legacyDashboard, { household });
      const current = await dashboardJson(getDashboard, { household });
      assert.deepEqual(tieOrdered(current), tieOrdered(legacy), `${household} at ${new Date(at).toISOString()}`);
    }
  }
});

test("the recent list is the newest 50 across all of a household's babies", async (t) => {
  const client = await openDb(t);
  await seed(client);
  setClock(t, NOW);
  const body = await dashboardJson(getDashboard);
  assert.equal(body.activities.length, 50);
  assert.deepEqual(new Set(body.activities.map((a: { baby_id: string }) => a.baby_id)), new Set(["baby-1", "baby-2"]));
  const startedAts = body.activities.map((a: { started_at: number }) => a.started_at);
  assert.deepEqual(startedAts, [...startedAts].sort((a, b) => b - a));
  const newestInDb = await client.execute(`SELECT a.id FROM activities a JOIN babies b ON b.id = a.baby_id
    WHERE b.household_id = 'house-1' AND a.type NOT IN ('bankfreeze','bankthaw','bankdiscard')
    ORDER BY a.started_at DESC LIMIT 50`);
  assert.deepEqual(body.activities.map((a: { id: string }) => a.id), newestInDb.rows.map((r) => r.id));
});

test("an unchanged poll answers 304 with no body, and a matching tag is required", async (t) => {
  const client = await openDb(t);
  await seed(client);
  setClock(t, NOW);
  const first = await getDashboard(dashboardRequest());
  assert.equal(first.status, 200);
  const tag = etag(first);
  assert.match(tag ?? "", /^"dv1\./);
  assert.equal(first.headers.get("cache-control"), "private, no-store");

  const second = await getDashboard(dashboardRequest({ ifNoneMatch: tag }));
  assert.equal(second.status, 304);
  assert.equal(await second.text(), "");
  assert.equal(etag(second), tag);

  assert.equal((await getDashboard(dashboardRequest({ ifNoneMatch: `W/${tag}` }))).status, 304, "weak form accepted");
  assert.equal((await getDashboard(dashboardRequest({ ifNoneMatch: `"other", ${tag}` }))).status, 304, "tag lists accepted");
  for (const bad of ['"garbage"', "*", tag!.replace("dv1.", "dv2."), tag!.replace(/\.\d+"$/, '.99999999999999"').replace(/\.(\d+)-(\d+)\./, ".$1-0.")]) {
    assert.equal((await getDashboard(dashboardRequest({ ifNoneMatch: bad }))).status, 200, `rejects ${bad}`);
  }
  assert.equal((await getDashboard(dashboardRequest({ household: "house-2", ifNoneMatch: tag }))).status, 200,
    "another household never gets a 304 for this tag");
});

test("every insert, update and delete on a dashboard input invalidates the tag", async (t) => {
  const client = await openDb(t);
  await seed(client);
  setClock(t, NOW);
  const writes: Record<string, [string, string, string]> = {
    households: [
      "INSERT INTO households (id, invite_code, created_at) VALUES ('house-x', 'XXX999', 1)",
      "UPDATE households SET created_at = created_at WHERE id = 'house-x'",
      "DELETE FROM households WHERE id = 'house-x'",
    ],
    users: [
      "INSERT INTO users (id, household_id, name, created_at) VALUES ('user-x', 'house-1', 'Gran', 1)",
      "UPDATE users SET name = 'Granny' WHERE id = 'user-x'",
      "DELETE FROM users WHERE id = 'user-x'",
    ],
    babies: [
      "INSERT INTO babies (id, household_id, name, created_at) VALUES ('baby-x', 'house-1', 'New', 1)",
      "UPDATE babies SET name = 'Newer' WHERE id = 'baby-x'",
      "DELETE FROM babies WHERE id = 'baby-x'",
    ],
    activities: [
      `INSERT INTO activities (id, baby_id, type, started_at, created_at) VALUES ('act-x', 'baby-1', 'diaper', ${NOW - 1000}, ${NOW})`,
      "UPDATE activities SET details = '{\"kind\":\"dirty\"}' WHERE id = 'act-x'",
      "DELETE FROM activities WHERE id = 'act-x'",
    ],
    active_timers: [
      `INSERT INTO active_timers (id, baby_id, type, started_at) VALUES ('timer-x', 'baby-1', 'breastfeed', ${NOW})`,
      "UPDATE active_timers SET current_side = 'right' WHERE id = 'timer-x'",
      "DELETE FROM active_timers WHERE id = 'timer-x'",
    ],
    measurements: [
      `INSERT INTO measurements (id, baby_id, measured_at, weight_g, created_at) VALUES ('m-x', 'baby-1', ${NOW}, 5700, ${NOW})`,
      "UPDATE measurements SET weight_g = 5800 WHERE id = 'm-x'",
      "DELETE FROM measurements WHERE id = 'm-x'",
    ],
    childcare_sessions: [
      `INSERT INTO childcare_sessions (id, baby_id, checked_in_at, check_in_request_id, created_at, updated_at) VALUES ('cc-x', 'baby-1', ${NOW}, 'req-x', ${NOW}, ${NOW})`,
      `UPDATE childcare_sessions SET checked_out_at = ${NOW} WHERE id = 'cc-x'`,
      "DELETE FROM childcare_sessions WHERE id = 'cc-x'",
    ],
    paper_log_import_batches: [
      `INSERT INTO paper_log_import_batches (id, household_id, baby_id, status, created_at) VALUES ('batch-x', 'house-1', 'baby-1', 'staged', ${NOW})`,
      "UPDATE paper_log_import_batches SET status = 'committed' WHERE id = 'batch-x'",
      "DELETE FROM paper_log_import_batches WHERE id = 'batch-x'",
    ],
  };
  assert.deepEqual(Object.keys(writes).sort(), [...DASHBOARD_VERSION_TABLES].sort(), "every covered table is exercised");

  let tag = etag(await getDashboard(dashboardRequest()));
  for (const [table, statements] of Object.entries(writes)) {
    for (const sql of statements) {
      await client.execute(sql);
      const response = await getDashboard(dashboardRequest({ ifNoneMatch: tag }));
      assert.equal(response.status, 200, `${table}: ${sql.slice(0, 40)} must invalidate`);
      const next = etag(response);
      assert.notEqual(next, tag);
      tag = next;
      assert.equal((await getDashboard(dashboardRequest({ ifNoneMatch: tag }))).status, 304, "settles again");
    }
  }

  // Writes the dashboard never reads leave cached answers alone.
  await client.execute(`INSERT INTO notification_log (id, household_id, kind, sent_at) VALUES ('n-x', 'house-1', 'feed', ${NOW})`);
  assert.equal((await getDashboard(dashboardRequest({ ifNoneMatch: tag }))).status, 304);
});

test("writes through the real API routes invalidate the tag and show up", async (t) => {
  const client = await openDb(t);
  await seed(client);
  setClock(t, NOW);
  const tag = etag(await getDashboard(dashboardRequest()));

  const created = await postActivity(jsonRequest("/api/activities", {
    babyId: "baby-1", type: "diaper", startedAt: NOW - MINUTE, details: { kind: "dirty" },
  }));
  assert.equal(created.status, 200, await created.clone().text());
  const afterPost = await getDashboard(dashboardRequest({ ifNoneMatch: tag }));
  assert.equal(afterPost.status, 200);
  const body = await afterPost.json();
  assert.ok(body.activities.some((a: { type: string; started_at: number }) => a.type === "diaper" && a.started_at === NOW - MINUTE),
    "the new entry is in the recent list");

  const timer = await startTimer(jsonRequest("/api/active-timers", { babyId: "baby-1", type: "breastfeed" }));
  assert.ok(timer.status < 300, await timer.clone().text());
  assert.equal((await getDashboard(dashboardRequest({ ifNoneMatch: etag(afterPost) }))).status, 200);
});

test("tags expire at SGT midnight, when future entries go live, when packets expire, and after an hour", async (t) => {
  const client = await openDb(t);
  await seed(client);
  const tagAt = async (at: number) => {
    t.mock.timers.reset();
    setClock(t, at);
    return etag(await getDashboard(dashboardRequest()));
  };
  const statusAt = async (at: number, tag: string | null) => {
    t.mock.timers.reset();
    setClock(t, at);
    return (await getDashboard(dashboardRequest({ ifNoneMatch: tag }))).status;
  };

  // pump-future goes live at NOW + 20 min.
  const tag = await tagAt(NOW);
  assert.equal(await statusAt(NOW + 19 * MINUTE, tag), 304);
  assert.equal(await statusAt(NOW + 20 * MINUTE, tag), 200);

  // freeze-old expires at 15:45 SGT, 45 min after NOW.
  const afterPump = await tagAt(NOW + 21 * MINUTE);
  assert.equal(await statusAt(NOW + 44 * MINUTE, afterPump), 304);
  t.mock.timers.reset();
  setClock(t, NOW + 45 * MINUTE);
  const expired = await dashboardJson(getDashboard);
  assert.equal(expired.pumpedMilk.frozenPackets.find((p: { id: string }) => p.id === "freeze-old").isExpired, true);
  assert.equal(await statusAt(NOW + 45 * MINUTE, afterPump), 200);

  // bf-future goes live at 18:00; between, the one-hour cap still forces a refetch.
  const afterExpiry = await tagAt(NOW + 46 * MINUTE);
  assert.equal(await statusAt(NOW + 105 * MINUTE, afterExpiry), 304);
  assert.equal(await statusAt(NOW + 106 * MINUTE, afterExpiry), 200, "one-hour cap");

  // Nothing pending late at night: midnight still rolls the day over.
  await client.execute("DELETE FROM activities WHERE started_at > ?", [NOW]);
  const lateTag = await tagAt(sgt("2026-10-20", "23:30"));
  assert.equal(await statusAt(sgt("2026-10-20", "23:59"), lateTag), 304);
  assert.equal(await statusAt(sgt("2026-10-21", "00:00"), lateTag), 200);
});

test("whenever a 304 is given, the full answer really would have been the same", async (t) => {
  // Property check for time-dependence nobody listed: across many random
  // moments with no writes, any time the new route reuses an earlier answer,
  // the pre-change route must produce identical JSON at both moments.
  const client = await openDb(t);
  await seed(client);
  let seedValue = 20261020;
  const random = () => (seedValue = (seedValue * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
  const start = sgt("2026-10-20", "12:00");
  const moments = Array.from({ length: 120 }, () => start + Math.floor(random() * 40 * HOUR)).sort((a, b) => a - b);
  let reused = 0;
  for (let i = 0; i < moments.length - 1; i += 1) {
    const [early, late] = [moments[i], moments[i + 1 + Math.floor(random() * Math.min(3, moments.length - i - 1))]];
    t.mock.timers.reset();
    setClock(t, early);
    const earlyResponse = await getDashboard(dashboardRequest());
    const earlyLegacy = await dashboardJson(legacyDashboard);
    t.mock.timers.reset();
    setClock(t, late);
    const lateResponse = await getDashboard(dashboardRequest({ ifNoneMatch: etag(earlyResponse) }));
    if (lateResponse.status !== 304) continue;
    reused += 1;
    assert.deepEqual(await dashboardJson(legacyDashboard), earlyLegacy,
      `304 at ${new Date(late).toISOString()} for answer from ${new Date(early).toISOString()}`);
  }
  assert.ok(reused >= 30, `expected many reuses to check, got ${reused}`);
});

test("before the migration the route still works, matches the old answer, and sends no tag", async (t) => {
  const client = await openDb(t);
  await client.execute("DROP TABLE dashboard_version");
  for (const row of (await client.execute("SELECT name FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'trg_dashboard_version_%'")).rows) {
    await client.execute(`DROP TRIGGER ${row.name}`);
  }
  await seed(client);
  setClock(t, NOW);
  const response = await getDashboard(dashboardRequest({ ifNoneMatch: '"dv1.local.0000000000000000.1-1.2026-10-20.9999999999999"' }));
  assert.equal(response.status, 200);
  assert.equal(etag(response), null);
  assert.deepEqual(tieOrdered(await response.json()), tieOrdered(await dashboardJson(legacyDashboard)));
});

test("optional: identical answers on a local copy of real data (MCPHEE_DASHBOARD_FIXTURE_DB)", async (t) => {
  const fixture = process.env.MCPHEE_DASHBOARD_FIXTURE_DB;
  if (!fixture) return t.skip("set MCPHEE_DASHBOARD_FIXTURE_DB to a local copy of the preview database");
  const saved = process.env.TURSO_DATABASE_URL;
  process.env.TURSO_DATABASE_URL = `file:${fixture}`;
  t.after(() => {
    if (saved === undefined) delete process.env.TURSO_DATABASE_URL;
    else process.env.TURSO_DATABASE_URL = saved;
  });
  const client = createClient({ url: `file:${fixture}` });
  const households = (await client.execute("SELECT id FROM households")).rows.map((r) => String(r.id));
  client.close();
  const realNow = Date.now();
  for (const at of [realNow, realNow - 2 * HOUR, realNow - 7 * 24 * HOUR, sgt("2026-10-16", "00:00"), sgt("2026-10-15", "23:59")]) {
    t.mock.timers.reset();
    setClock(t, at);
    for (const household of households) {
      assert.deepEqual(tieOrdered(await dashboardJson(getDashboard, { household })), tieOrdered(await dashboardJson(legacyDashboard, { household })),
        `household ${household.slice(0, 4)}… at ${new Date(at).toISOString()}`);
      const first = await getDashboard(dashboardRequest({ household }));
      assert.equal((await getDashboard(dashboardRequest({ household, ifNoneMatch: etag(first) }))).status, 304);
    }
  }
});
