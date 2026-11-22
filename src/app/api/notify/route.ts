import { NextRequest, NextResponse } from "next/server";
import type { Client } from "@libsql/client";
import { createDB } from "@/db";
import { generateId } from "@/lib/utils";
import webpush from "web-push";
import { purgeExpiredCaretakerImports } from "@/db/caretaker-import-schema";
import { isChildcareModeSchemaReady } from "@/db/childcare-mode-schema";
import { isSickModeSchemaReady } from "@/db/sick-mode-schema";
import { episodeOverlapsSgtDate } from "@/lib/sick-mode";
import {
  ageWakeWindowGuide,
  calculateNapZones,
  calculateSleepWindowHistory,
  currentWakeWindow,
  napHint,
  type NapHint,
} from "@/lib/sleep-windows";
import { planPushes, isQuietHours, type PushMedication, type PlannedPush } from "@/lib/push-plan";

export const runtime = "nodejs";

const DAY_MS = 24 * 60 * 60 * 1000;
/** Sleep history for nap zones: the dashboard's 90-day window plus a margin. */
const SLEEP_LOOKBACK_MS = 92 * DAY_MS;
/** A push that cannot be delivered within this window is dropped by the push service. */
const PUSH_TTL_SECONDS = 30 * 60;

type Row = Record<string, unknown>;

async function householdPushState(db: Client, householdId: string, now: number) {
  const babies = await db.execute({
    sql: "SELECT id, name, birth_date FROM babies WHERE household_id = ? ORDER BY created_at ASC LIMIT 1",
    args: [householdId],
  });
  const baby = babies.rows[0] as Row | undefined;
  if (!baby) return null;
  const babyId = String(baby.id);
  const birthDate = baby.birth_date == null ? null : Number(baby.birth_date);

  const [lastSleep, lastFeed, timer, users] = await db.batch([
    {
      sql: `SELECT started_at, ended_at FROM activities WHERE baby_id = ? AND type = 'sleep'
            ORDER BY (ended_at IS NULL) DESC, COALESCE(ended_at, started_at) DESC LIMIT 1`,
      args: [babyId],
    },
    {
      sql: `SELECT id, started_at FROM activities WHERE baby_id = ? AND type IN ('bottlefeed', 'breastfeed')
            ORDER BY started_at DESC, created_at DESC LIMIT 1`,
      args: [babyId],
    },
    { sql: "SELECT id FROM active_timers WHERE baby_id = ? AND type = 'breastfeed' LIMIT 1", args: [babyId] },
    { sql: "SELECT id, name FROM users WHERE household_id = ?", args: [householdId] },
  ], "read");

  const asleep = lastSleep.rows[0] != null && lastSleep.rows[0].ended_at == null;
  const userNames = new Map(users.rows.map((row) => [String(row.id), String(row.name)]));

  let atChildcare = false;
  if (await isChildcareModeSchemaReady(db)) {
    const care = await db.execute({
      sql: "SELECT id FROM childcare_sessions WHERE baby_id = ? AND checked_out_at IS NULL AND removed_at IS NULL LIMIT 1",
      args: [babyId],
    });
    atChildcare = care.rows.length > 0;
  }

  let episodes: { id: string; startedAt: number; endedAt: number | null }[] = [];
  let medications: PushMedication[] = [];
  if (await isSickModeSchemaReady(db)) {
    const episodeRows = await db.execute({
      sql: "SELECT id, started_at, ended_at FROM sick_mode_episodes WHERE baby_id = ?",
      args: [babyId],
    });
    episodes = episodeRows.rows.map((row) => ({
      id: String(row.id),
      startedAt: Number(row.started_at),
      endedAt: row.ended_at == null ? null : Number(row.ended_at),
    }));
    const active = episodes.find((episode) => episode.endedAt == null);
    if (active) {
      const meds = await db.execute({
        sql: `SELECT m.id, m.name, m.dose_text, m.as_needed, m.min_interval_minutes, m.max_interval_minutes,
                     d.id AS dose_id, d.given_at, d.given_by
              FROM sick_mode_medications m
              LEFT JOIN sick_mode_doses d ON d.id = (
                SELECT id FROM sick_mode_doses
                WHERE medication_id = m.id AND deleted_at IS NULL
                ORDER BY given_at DESC, created_at DESC LIMIT 1
              )
              WHERE m.episode_id = ?`,
        args: [active.id],
      });
      medications = meds.rows.map((row) => ({
        id: String(row.id),
        name: String(row.name),
        doseText: String(row.dose_text ?? ""),
        asNeeded: Number(row.as_needed) === 1,
        minIntervalHours: row.min_interval_minutes == null ? null : Number(row.min_interval_minutes) / 60,
        maxIntervalHours: row.max_interval_minutes == null ? null : Number(row.max_interval_minutes) / 60,
        latestDose: row.dose_id == null ? null : {
          id: String(row.dose_id),
          givenAt: Number(row.given_at),
          givenBy: row.given_by == null ? null : (userNames.get(String(row.given_by)) ?? null),
        },
      }));
    }
  }

  // Nap zones need sleep history. Load it only when a nap push is possible.
  let hint: NapHint | null = null;
  let awakeSince: number | null = null;
  if (!asleep && !atChildcare && !isQuietHours(now)) {
    const sleeps = await db.execute({
      sql: `SELECT started_at, ended_at FROM activities
            WHERE baby_id = ? AND type = 'sleep' AND COALESCE(ended_at, started_at) > ?`,
      args: [babyId, now - SLEEP_LOOKBACK_MS],
    });
    const sessions = sleeps.rows.map((row) => ({
      startedAt: Number(row.started_at),
      endedAt: row.ended_at == null ? null : Number(row.ended_at),
    }));
    const current = currentWakeWindow(sessions, now);
    if (current) {
      awakeSince = current.awakeSince;
      const days = calculateSleepWindowHistory(sessions, now, 90);
      const sickDates = new Set(days.map((day) => day.date).filter((date) => episodes.some((episode) => episodeOverlapsSgtDate(episode, date))));
      const isSick = episodes.some((episode) => episode.endedAt == null);
      hint = napHint({
        current,
        now,
        normal: calculateNapZones(days, { includeDate: (date) => !sickDates.has(date) }),
        sick: calculateNapZones(days, { lookbackDays: 90, includeDate: (date) => sickDates.has(date) }),
        isSick,
        ageGuide: ageWakeWindowGuide(birthDate, now),
      });
    }
  }

  const feed = lastFeed.rows[0];
  return planPushes({
    now,
    babyName: String(baby.name),
    asleep,
    atChildcare,
    feedInProgress: timer.rows.length > 0,
    lastFeed: feed ? { id: String(feed.id), startedAt: Number(feed.started_at) } : null,
    napHint: hint,
    awakeSince,
    medications,
  });
}

async function sendPushes(db: Client, householdId: string, pushes: PlannedPush[], now: number): Promise<string[]> {
  if (pushes.length === 0) return [];
  const keys = pushes.map((push) => push.key);
  const logged = await db.execute({
    sql: `SELECT kind FROM notification_log WHERE household_id = ? AND kind IN (${keys.map(() => "?").join(", ")})`,
    args: [householdId, ...keys],
  });
  const done = new Set(logged.rows.map((row) => String(row.kind)));
  const fresh = pushes.filter((push) => !done.has(push.key));
  if (fresh.length === 0) return [];

  // Only devices whose owner tapped "Enable notifications" have a subscription.
  const subs = await db.execute({
    sql: "SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE household_id = ?",
    args: [householdId],
  });
  const sent: string[] = [];
  for (const push of fresh) {
    let delivered = false;
    for (const sub of subs.rows) {
      try {
        await webpush.sendNotification(
          { endpoint: String(sub.endpoint), keys: { p256dh: String(sub.p256dh), auth: String(sub.auth) } },
          JSON.stringify({ title: push.title, body: push.body, url: push.url, tag: push.tag }),
          { TTL: PUSH_TTL_SECONDS, urgency: "high" },
        );
        delivered = true;
      } catch (err: unknown) {
        const status = (err as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          await db.execute({
            sql: "DELETE FROM push_subscriptions WHERE household_id = ? AND endpoint = ?",
            args: [householdId, String(sub.endpoint)],
          });
        } else {
          console.error("Push send failed", status ?? err);
        }
      }
    }
    // Log only delivered events, so a push service outage retries on the next run.
    if (delivered) {
      await db.execute({
        sql: "INSERT INTO notification_log (id, household_id, kind, sent_at) VALUES (?, ?, ?, ?)",
        args: [generateId(), householdId, push.key, now],
      });
      sent.push(push.key);
    }
  }
  return sent;
}

async function handleNotify(request: NextRequest) {
  const cronSecret = request.headers.get("authorization")?.replace("Bearer ", "");
  const queryKey = new URL(request.url).searchParams.get("key");
  const authorized =
    (process.env.CRON_SECRET && cronSecret === process.env.CRON_SECRET) ||
    (process.env.MIGRATION_KEY && queryKey === process.env.MIGRATION_KEY);
  if (!authorized) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = createDB();
  const now = Date.now();
  // The Vercel cron runs daily, so it purges sources due before its next run;
  // the 5-minute VPS scheduler only needs to look 10 minutes ahead. Either way
  // a source/draft lives no more than seven days while a scheduler runs.
  const dailyRun = request.headers.get("user-agent")?.startsWith("vercel-cron") ?? false;
  const purge = await purgeExpiredCaretakerImports(db, now + (dailyRun ? DAY_MS : 10 * 60 * 1000), now);

  const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } = process.env;
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY || !VAPID_SUBJECT) {
    return NextResponse.json({ error: "VAPID not configured", caretakerImportPurge: purge }, { status: 503 });
  }
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

  // Households with no enabled device are skipped without reading their data.
  const households = await db.execute("SELECT DISTINCT household_id FROM push_subscriptions");
  const sent: string[] = [];
  for (const row of households.rows) {
    const householdId = String(row.household_id);
    const pushes = await householdPushState(db, householdId, now);
    if (!pushes) continue;
    sent.push(...await sendPushes(db, householdId, pushes, now));
  }

  return NextResponse.json({ sent: sent.length, keys: sent, caretakerImportPurge: purge });
}

export async function GET(request: NextRequest) {
  return handleNotify(request);
}

export async function POST(request: NextRequest) {
  return handleNotify(request);
}
