import { NextRequest, NextResponse } from "next/server";
import { createDB } from "@/db";
import { generateId } from "@/lib/utils";
import webpush from "web-push";

export const runtime = "nodejs";

function median(arr: number[]): number {
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export async function POST(request: NextRequest) {
  const key = new URL(request.url).searchParams.get("key");
  if (key !== process.env.MIGRATION_KEY) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } = process.env;
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY || !VAPID_SUBJECT) {
    return NextResponse.json({ error: "VAPID not configured" }, { status: 503 });
  }
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

  const db = createDB();
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

    for (const sub of subs.rows) {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint as string,
            keys: { p256dh: sub.p256dh as string, auth: sub.auth as string },
          },
          JSON.stringify({ title: "mcphee", body, url: "/dashboard" })
        );
      } catch (err: unknown) {
        if ((err as { statusCode?: number }).statusCode === 410) {
          await db.execute({ sql: "DELETE FROM push_subscriptions WHERE endpoint = ?", args: [sub.endpoint] });
        }
      }
    }

    await db.execute({
      sql: "INSERT INTO notification_log (id, household_id, kind, sent_at) VALUES (?, ?, 'overdue', ?)",
      args: [generateId(), hhId, Date.now()],
    });
    sent.push(hhId);
  }

  return NextResponse.json({ sent: sent.length });
}
