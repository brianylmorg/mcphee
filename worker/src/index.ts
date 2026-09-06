import { createClient, type Client } from "@libsql/client";
import webpush from "web-push";

const {
  TURSO_DATABASE_URL,
  TURSO_AUTH_TOKEN,
  VAPID_PUBLIC_KEY,
  VAPID_PRIVATE_KEY,
  VAPID_SUBJECT,
} = process.env;

if (!TURSO_DATABASE_URL) throw new Error("TURSO_DATABASE_URL is required");
if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY || !VAPID_SUBJECT) {
  throw new Error("VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and VAPID_SUBJECT are required");
}

const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS ?? 60_000);
const BATCH_SIZE = Number(process.env.BATCH_SIZE ?? 50);
const MAX_ATTEMPTS = Number(process.env.MAX_ATTEMPTS ?? 5);
const RATE_LIMIT_MS = Number(process.env.RATE_LIMIT_MS ?? 30 * 60 * 1000);
const CLAIM_LEASE_MS = 60_000;
const DRY_RUN = process.env.DRY_RUN === "true";

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

const db: Client = createClient({
  url: TURSO_DATABASE_URL,
  authToken: TURSO_AUTH_TOKEN,
});

interface Job {
  id: string;
  household_id: string;
  kind: string;
  payload: string;
  attempts: number;
}

interface PushPayload {
  title?: string;
  body?: string;
  url?: string;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// A crashed worker leaves jobs in 'claimed' past their lease; return them to 'pending'.
async function recoverStaleClaims(now: number) {
  await db.execute({
    sql: "UPDATE notification_queue SET status = 'pending', claim_token = NULL, claim_expires_at = NULL WHERE status = 'claimed' AND claim_expires_at < ?",
    args: [now],
  });
}

async function claimBatch(now: number): Promise<Job[]> {
  const token = crypto.randomUUID();
  const candidates = await db.execute({
    sql: "SELECT id FROM notification_queue WHERE status = 'pending' AND scheduled_at <= ? ORDER BY scheduled_at LIMIT ?",
    args: [now, BATCH_SIZE],
  });
  const ids = candidates.rows.map((r) => r.id as string);
  if (ids.length === 0) return [];

  const placeholders = ids.map(() => "?").join(", ");
  // The status guard makes this safe even if another worker grabbed the same rows.
  await db.execute({
    sql: `UPDATE notification_queue SET status = 'claimed', claim_token = ?, claim_expires_at = ? WHERE status = 'pending' AND id IN (${placeholders})`,
    args: [token, now + CLAIM_LEASE_MS, ...ids],
  });

  const claimed = await db.execute({
    sql: "SELECT id, household_id, kind, payload, attempts FROM notification_queue WHERE claim_token = ?",
    args: [token],
  });
  return claimed.rows as unknown as Job[];
}

async function recentlySent(householdId: string, kind: string, now: number): Promise<boolean> {
  const log = await db.execute({
    sql: "SELECT sent_at FROM notification_log WHERE household_id = ? AND kind = ? ORDER BY sent_at DESC LIMIT 1",
    args: [householdId, kind],
  });
  return log.rows.length > 0 && now - Number(log.rows[0].sent_at) < RATE_LIMIT_MS;
}

async function finishJob(id: string, status: "sent" | "dead", error: string | null, now: number) {
  await db.execute({
    sql: "UPDATE notification_queue SET status = ?, processed_at = ?, error = ?, claim_token = NULL, claim_expires_at = NULL WHERE id = ?",
    args: [status, now, error, id],
  });
}

async function retryJob(job: Job, message: string, now: number) {
  const attempts = job.attempts + 1;
  if (attempts >= MAX_ATTEMPTS) {
    await db.execute({
      sql: "UPDATE notification_queue SET status = 'dead', attempts = ?, processed_at = ?, error = ?, claim_token = NULL, claim_expires_at = NULL WHERE id = ?",
      args: [attempts, now, message, job.id],
    });
    return;
  }
  // Exponential backoff: 1m, 4m, 9m, 16m between attempts.
  const backoffMs = attempts * attempts * 60_000;
  await db.execute({
    sql: "UPDATE notification_queue SET status = 'pending', attempts = ?, scheduled_at = ?, error = ?, claim_token = NULL, claim_expires_at = NULL WHERE id = ?",
    args: [attempts, now + backoffMs, message, job.id],
  });
}

async function processJob(job: Job, now: number) {
  if (await recentlySent(job.household_id, job.kind, now)) {
    await finishJob(job.id, "sent", "skipped: rate limited", now);
    return;
  }

  const subs = await db.execute({
    sql: "SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE household_id = ?",
    args: [job.household_id],
  });
  if (subs.rows.length === 0) {
    await finishJob(job.id, "sent", "skipped: no subscriptions", now);
    return;
  }

  const payload = JSON.parse(job.payload) as PushPayload;
  const message = JSON.stringify({
    title: payload.title ?? "mcphee",
    body: payload.body ?? "",
    url: payload.url ?? "/dashboard",
  });

  if (DRY_RUN) {
    console.log(`[dry-run] would send to ${subs.rows.length} sub(s) for household ${job.household_id}: ${message}`);
    await finishJob(job.id, "sent", "dry run", now);
    return;
  }

  for (const sub of subs.rows) {
    try {
      await webpush.sendNotification(
        {
          endpoint: sub.endpoint as string,
          keys: { p256dh: sub.p256dh as string, auth: sub.auth as string },
        },
        message
      );
    } catch (err) {
      const statusCode = (err as { statusCode?: number }).statusCode;
      if (statusCode === 404 || statusCode === 410) {
        // Subscription is gone for good; stop trying it.
        await db.execute({
          sql: "DELETE FROM push_subscriptions WHERE household_id = ? AND endpoint = ?",
          args: [job.household_id, sub.endpoint],
        });
      } else {
        throw err;
      }
    }
  }

  await db.batch([
    {
      sql: "INSERT INTO notification_log (id, household_id, kind, sent_at) VALUES (?, ?, ?, ?)",
      args: [crypto.randomUUID(), job.household_id, job.kind, now],
    },
    {
      sql: "UPDATE notification_queue SET status = 'sent', processed_at = ?, claim_token = NULL, claim_expires_at = NULL WHERE id = ?",
      args: [now, job.id],
    },
  ]);
}

async function cycle() {
  const now = Date.now();
  await recoverStaleClaims(now);
  const jobs = await claimBatch(now);
  for (const job of jobs) {
    try {
      await processJob(job, Date.now());
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`job ${job.id} failed: ${message}`);
      await retryJob(job, message, Date.now());
    }
  }
  if (jobs.length > 0) console.log(`processed ${jobs.length} job(s)`);
}

let shuttingDown = false;
process.on("SIGINT", () => (shuttingDown = true));
process.on("SIGTERM", () => (shuttingDown = true));

console.log(`mcphee push worker started (dry_run=${DRY_RUN}, poll=${POLL_INTERVAL_MS}ms, batch=${BATCH_SIZE})`);
while (!shuttingDown) {
  try {
    await cycle();
  } catch (err) {
    console.error("worker cycle failed:", err);
  }
  await sleep(POLL_INTERVAL_MS);
}
db.close();
