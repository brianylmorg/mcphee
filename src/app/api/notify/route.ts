import { NextRequest, NextResponse } from "next/server";
import type { Client, Row } from "@libsql/client";
import { isSickModeSchemaReady } from "@/db/sick-mode-schema";
import { computeNightPlan, nightPlanSummaryText } from "@/lib/night-plan";
import { bottleVolumes, parseActivityDetails } from "@/lib/milk-volumes";
import { createDB } from "@/db";
import { generateId } from "@/lib/utils";
import webpush from "web-push";
import { purgeExpiredCaretakerImports } from "@/db/caretaker-import-schema";

export const runtime = "nodejs";

function median(arr: number[]): number {
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Send the same payload to every device; expired endpoints are household scoped. */
async function sendToAllSubscriptions(db: Client, householdId: string, subscriptions: Row[], body: string): Promise<number> {
  let delivered = 0;
  for (const sub of subscriptions) {
    try {
      await webpush.sendNotification({
        endpoint: String(sub.endpoint),
        keys: { p256dh: String(sub.p256dh), auth: String(sub.auth) },
      }, JSON.stringify({ title: "mcphee", body, url: "/dashboard" }));
      delivered++;
    } catch (err: unknown) {
      if ((err as { statusCode?: number }).statusCode === 410) {
        await db.execute({
          sql: "DELETE FROM push_subscriptions WHERE household_id = ? AND endpoint = ?",
          args: [householdId, sub.endpoint],
        });
      }
    }
  }
  return delivered;
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
  // Hobby cron runs daily. Purging sources due before the next run keeps the
  // physical source/draft lifetime at no more than seven days when cron runs.
  const purge = await purgeExpiredCaretakerImports(
    db,
    Date.now() + 24 * 60 * 60 * 1000,
    Date.now(),
  );

  const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } = process.env;
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY || !VAPID_SUBJECT) {
    return NextResponse.json({ error: "VAPID not configured", caretakerImportPurge: purge }, { status: 503 });
  }
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

  const households = await db.execute({ sql: "SELECT id FROM households", args: [] });
  const sent: string[] = [];

  for (const hh of households.rows) {
    const hhId = hh.id as string;

    const recentLog = await db.execute({
      sql: "SELECT sent_at FROM notification_log WHERE household_id = ? AND kind = 'overdue' ORDER BY sent_at DESC LIMIT 1",
      args: [hhId],
    });
    if (recentLog.rows.length > 0) {
      const lastSent = Number(recentLog.rows[0].sent_at);
      if (Date.now() - lastSent < 30 * 60 * 1000) continue;
    }

    const babies = await db.execute({
      sql: "SELECT id, name FROM babies WHERE household_id = ?",
      args: [hhId],
    });
    if (babies.rows.length === 0) continue;

    const babyId = babies.rows[0].id as string;
    const babyName = babies.rows[0].name as string;

    const acts = await db.execute({
      sql: "SELECT type, started_at FROM activities WHERE baby_id = ? ORDER BY started_at DESC LIMIT 50",
      args: [babyId],
    });
    const rows = acts.rows as unknown as { type: string; started_at: number }[];

    const overdueTypes: string[] = [];
    for (const type of ["bottlefeed", "breastfeed", "diaper"]) {
      const typed = rows.filter((r) => r.type === type);
      if (typed.length < 3) continue;
      const intervals: number[] = [];
      for (let i = 1; i < Math.min(typed.length, 9); i++) {
        intervals.push(typed[i - 1].started_at - typed[i].started_at);
      }
      const med = median(intervals);
      const elapsed = Date.now() - typed[0].started_at;
      if (elapsed > med * 1.2) overdueTypes.push(type);
    }

    if (overdueTypes.length === 0) continue;

    const labels: Record<string, string> = { bottlefeed: "feed", breastfeed: "feed", diaper: "diaper change" };
    const body = `${babyName} may be due for a ${overdueTypes.map((t) => labels[t] || t).join(" and ")}`;

    const subs = await db.execute({
      sql: "SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE household_id = ?",
      args: [hhId],
    });

    await sendToAllSubscriptions(db, hhId, subs.rows, body);

    await db.execute({
      sql: "INSERT INTO notification_log (id, household_id, kind, sent_at) VALUES (?, ?, 'overdue', ?)",
      args: [generateId(), hhId, Date.now()],
    });
    sent.push(hhId);
  }

  // Independent of overdue: its continues and 30-minute throttle must never
  // suppress a household's daily night plan.
  let nightplanSent = 0;
  const now = Date.now();
  const sickSchemaReady = await isSickModeSchemaReady(db);
  for (const hh of households.rows) {
    const hhId = String(hh.id);
    const subs = await db.execute({
      sql: "SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE household_id = ?", args: [hhId],
    });
    if (!subs.rows.length) continue;
    const recent = await db.execute({
      sql: "SELECT sent_at FROM notification_log WHERE household_id = ? AND kind = 'nightplan' AND sent_at > ? LIMIT 1",
      args: [hhId, now - 20 * 3600_000],
    });
    if (recent.rows.length) continue;
    // Without sick-mode schema readiness we cannot safely rule out a pause.
    if (!sickSchemaReady) continue;
    const babies = await db.execute({
      sql: "SELECT id, name FROM babies WHERE household_id = ? ORDER BY created_at ASC LIMIT 1", args: [hhId],
    });
    const baby = babies.rows[0];
    if (!baby) continue;
    const [activities, weights, sick] = await db.batch([
      {
        sql: "SELECT type, started_at, ended_at, details FROM activities WHERE baby_id = ? AND type IN ('sleep', 'bottlefeed', 'breastfeed') AND started_at >= ? ORDER BY started_at ASC",
        args: [baby.id, now - 15 * 86400_000],
      },
      {
        sql: "SELECT measured_at, weight_g FROM measurements WHERE baby_id = ? AND weight_g IS NOT NULL ORDER BY measured_at DESC, created_at DESC LIMIT 6",
        args: [baby.id],
      },
      { sql: "SELECT id FROM sick_mode_episodes WHERE baby_id = ? AND ended_at IS NULL LIMIT 1", args: [baby.id] },
    ], "read");
    const plan = computeNightPlan({
      sleeps: activities.rows.filter((r) => r.type === "sleep").map((r) => ({
        startedAt: Number(r.started_at), endedAt: r.ended_at == null ? null : Number(r.ended_at),
      })),
      feeds: activities.rows.filter((r) => r.type !== "sleep").map((r) => {
        const ml = bottleVolumes(parseActivityDetails(r.details));
        return { startedAt: Number(r.started_at), amountMl: r.type === "breastfeed" ? 0 : ml.breastmilkMl + ml.formulaMl };
      }),
      weights: weights.rows.map((r) => ({ measuredAt: Number(r.measured_at), weightG: Number(r.weight_g) })),
      isSick: sick.rows.length > 0, now,
    });
    const body = nightPlanSummaryText(plan, String(baby.name));
    if (!body) continue;
    const delivered = await sendToAllSubscriptions(db, hhId, subs.rows, body);
    if (!delivered) continue;
    await db.execute({
      sql: "INSERT INTO notification_log (id, household_id, kind, sent_at) VALUES (?, ?, 'nightplan', ?)",
      args: [generateId(), hhId, now],
    });
    nightplanSent++;
  }

  return NextResponse.json({ sent: sent.length, nightplanSent, caretakerImportPurge: purge });
}

export async function GET(request: NextRequest) {
  return handleNotify(request);
}

export async function POST(request: NextRequest) {
  return handleNotify(request);
}
