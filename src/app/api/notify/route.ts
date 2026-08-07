import { NextRequest, NextResponse } from "next/server";
import { createDB } from "@/db";
import { generateId } from "@/lib/utils";

export const runtime = "nodejs";

function median(arr: number[]): number {
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// Detector only: finds overdue households and enqueues notification jobs.
// Actual web-push sending happens in the VPS worker (worker/), which claims
// jobs from notification_queue, enforces rate limits, and handles retries.
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
  const households = await db.execute({ sql: "SELECT id FROM households", args: [] });
  const queued: string[] = [];

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

    // Skip if an overdue job is already waiting in the queue for this household.
    const pendingJob = await db.execute({
      sql: "SELECT id FROM notification_queue WHERE household_id = ? AND kind = 'overdue' AND status IN ('pending', 'claimed') LIMIT 1",
      args: [hhId],
    });
    if (pendingJob.rows.length > 0) continue;

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

    await db.execute({
      sql: "INSERT INTO notification_queue (id, household_id, kind, payload, status, attempts, scheduled_at, created_at) VALUES (?, ?, 'overdue', ?, 'pending', 0, ?, ?)",
      args: [
        generateId(),
        hhId,
        JSON.stringify({ title: "mcphee", body, url: "/dashboard" }),
        Date.now(),
        Date.now(),
      ],
    });
    queued.push(hhId);
  }

  return NextResponse.json({ queued: queued.length });
}

export async function GET(request: NextRequest) {
  return handleNotify(request);
}

export async function POST(request: NextRequest) {
  return handleNotify(request);
}
