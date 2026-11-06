import { randomUUID } from "node:crypto";
import type { Client, InStatement } from "@libsql/client";
import type { BrowserContext } from "@playwright/test";

export const fixtureNames = ["fresh-day", "sick-episode", "childcare-checked-in", "milk-bank", "breastfeed-timer"] as const;
export type FixtureName = typeof fixtureNames[number];
export type Fixture = { householdId: string; userId: string; babyId: string };

/** All SQL targets the verifier's temporary DB. Epoch milliseconds, SGT calendar days. */
export async function seedFixture(name: FixtureName, client: Client): Promise<Fixture> {
  if (!process.env.TURSO_DATABASE_URL?.startsWith("file:") || client.protocol !== "file") {
    throw new Error("Fixtures require a file: TURSO_DATABASE_URL");
  }
  if (!fixtureNames.includes(name)) throw new Error(`Unknown fixture: ${name}`);
  const now = Date.now();
  const hour = 3_600_000;
  const day = 24 * hour;
  const midnight = Math.floor((now + 8 * hour) / day) * day - 8 * hour;
  const elapsed = now - midnight;
  const householdId = randomUUID();
  const userId = randomUUID();
  const babyId = randomUUID();
  const statements: InStatement[] = [];
  const insert = (sql: string, args: (string | number | null)[]) => statements.push({ sql, args });
  insert("INSERT INTO households (id, invite_code, created_at) VALUES (?, ?, ?)", [householdId, householdId.replaceAll("-", "").slice(0, 6).toUpperCase(), now - 220 * day]);
  insert("INSERT INTO users (id, household_id, name, created_at) VALUES (?, ?, ?, ?)", [userId, householdId, "Alex", now - 220 * day]);
  insert("INSERT INTO babies (id, household_id, name, birth_date, created_at) VALUES (?, ?, ?, ?, ?)", [babyId, householdId, "Robin", midnight - 213 * day, now - 220 * day]);
  insert("INSERT INTO measurements (id, baby_id, measured_at, weight_g, length_mm, head_mm, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [randomUUID(), babyId, now - 2 * day, 7800, 680, 430, now - 2 * day]);
  const activity = (type: string, at: number, details: Record<string, unknown>, end: number | null = null) => {
    insert("INSERT INTO activities (id, baby_id, type, started_at, ended_at, details, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [randomUUID(), babyId, type, at, end, JSON.stringify(details), at, "Alex"]);
  };
  for (let daysAgo = 7; daysAgo >= 0; daysAgo--) {
    const start = midnight - daysAgo * day;
    // Today is compressed into elapsed time, so even a midnight run has no future logs.
    const span = daysAgo === 0 ? elapsed : 22 * hour;
    activity("pump", start + span * 0.02, { amount: 400 });
    for (let i = 0; i < 4; i++) {
      const milkType = i % 2 === 0 ? "breastmilk" : "formula";
      activity("bottlefeed", Math.floor(start + span * (0.12 + i * 0.25)), { amount: 150, milkType });
    }
    for (let i = 0; i < 3; i++) {
      activity("diaper", Math.floor(start + span * (0.18 + i * 0.32)), { poop: i === 1 ? "M" : "no", peeUnits: 1 });
    }
    activity("sleep", start - 3 * hour, {}, Math.floor(start + span * 0.06));
    activity("sleep", Math.floor(start + span * 0.32), {}, Math.floor(start + span * 0.40));
    activity("sleep", Math.floor(start + span * 0.65), {}, Math.floor(start + span * 0.73));
  }
  if (name === "sick-episode") {
    const episodeId = randomUUID();
    const medicationId = randomUUID();
    const started = now - day;
    const sourceDays = Array.from({ length: 7 }, (_, i) => ({
      date: new Date(midnight - (i + 1) * day + 8 * hour).toISOString().slice(0, 10), totalMl: 600,
    }));
    insert(`INSERT INTO sick_mode_episodes (id, baby_id, started_at, baseline_daily_ml, baseline_kind, baseline_available_day_count, baseline_source_days, created_at, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, [episodeId, babyId, started, 600, "calculated", 7, JSON.stringify(sourceDays), started, "Alex"]);
    insert(`INSERT INTO sick_mode_medications (id, episode_id, name, dose_text, as_needed, min_interval_minutes, max_interval_minutes, created_at, created_by, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [medicationId, episodeId, "Paracetamol", "2.5 ml", 1, 360, null, started, "Alex", started]);
    insert(`INSERT INTO sick_mode_doses (id, medication_id, given_at, dose_text, given_by, request_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [randomUUID(), medicationId, now - hour, "2.5 ml", "Alex", randomUUID(), now - hour, now - hour]);
    activity("temperature", now - 20 * hour, { celsius: 38.2, method: "armpit" });
    activity("temperature", now - hour / 2, { celsius: 37.8, method: "armpit" });
  }
  if (name === "childcare-checked-in") {
    const checkedIn = Math.floor(midnight + elapsed * 0.8);
    insert(`INSERT INTO childcare_sessions (id, baby_id, checked_in_at, checked_in_by, check_in_request_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`, [randomUUID(), babyId, checkedIn, "Alex", randomUUID(), checkedIn, checkedIn]);
  }
  if (name === "milk-bank") {
    activity("bankadjust", now - 60_000, { amount: 240, targetBankMl: 1040 });
    activity("bankfreeze", now - 30_000, { amount: 180, source: "reconcile" });
  }
  if (name === "breastfeed-timer") {
    insert(`INSERT INTO active_timers (id, baby_id, type, started_at, current_side, side_switches, started_by)
      VALUES (?, ?, ?, ?, ?, ?, ?)`, [randomUUID(), babyId, "breastfeed", now - 12 * 60_000, "L", "[]", userId]);
  }
  await client.batch(statements, "write");
  return { householdId, userId, babyId };
}

export async function setFixtureCookies(context: BrowserContext, fixture: Fixture) {
  await context.addCookies([
    { name: "mcphee_hh", value: fixture.householdId, url: "http://127.0.0.1:3217", httpOnly: true, sameSite: "Lax" },
    { name: "mcphee_user", value: fixture.userId, url: "http://127.0.0.1:3217", httpOnly: true, sameSite: "Lax" },
  ]);
}
