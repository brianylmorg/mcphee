import { createHash, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createDB } from "@/db";
import { activeChildcareSession } from "@/lib/childcare-mode-server";
import { CHILDCARE_CONFIRMATION_REQUIRED } from "@/lib/childcare-mode-contract";

// Garmin watch companion helpers (see src/app/api/watch/route.ts).

export const NO_STORE = { "Cache-Control": "private, no-store, max-age=0" };
const MIN_TOKEN_LENGTH = 32;
export const MIN_FEED_ML = 5;
export const MAX_FEED_ML = 400;

export type WatchConfig = { householdId: string; userId: string | null };

function digest(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

export function watchConfig(request: NextRequest): WatchConfig | NextResponse {
  const token = process.env.MCPHEE_WATCH_TOKEN ?? "";
  const householdId = process.env.MCPHEE_WATCH_HOUSEHOLD_ID ?? "";
  if (token.length < MIN_TOKEN_LENGTH || !householdId) {
    return NextResponse.json({ error: "Watch access is not configured" }, { status: 404, headers: NO_STORE });
  }
  const header = request.headers.get("authorization") ?? "";
  const presented = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!presented || !timingSafeEqual(digest(presented), digest(token))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: NO_STORE });
  }
  return { householdId, userId: process.env.MCPHEE_WATCH_USER_ID || null };
}

type DB = ReturnType<typeof createDB>;

export async function firstBaby(db: DB, householdId: string) {
  const result = await db.execute({
    sql: "SELECT id, name FROM babies WHERE household_id = ? ORDER BY created_at ASC, id ASC LIMIT 1",
    args: [householdId],
  });
  const row = result.rows[0];
  return row ? { id: String(row.id), name: String(row.name ?? "") } : null;
}

function parseDetails(raw: unknown): Record<string, unknown> {
  if (typeof raw !== "string") return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function positiveNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export async function watchStatus(db: DB, householdId: string) {
  const baby = await firstBaby(db, householdId);
  if (!baby) return null;

  const [openSleep, lastSleepEnd, lastFeed, lastDiaper, childcare] = await Promise.all([
    db.execute({
      sql: `SELECT started_at FROM activities
            WHERE baby_id = ? AND type = 'sleep' AND ended_at IS NULL
            ORDER BY started_at DESC LIMIT 1`,
      args: [baby.id],
    }),
    db.execute({
      sql: `SELECT ended_at FROM activities
            WHERE baby_id = ? AND type = 'sleep' AND ended_at IS NOT NULL
            ORDER BY ended_at DESC LIMIT 1`,
      args: [baby.id],
    }),
    db.execute({
      sql: `SELECT started_at, details FROM activities
            WHERE baby_id = ? AND type = 'bottlefeed'
            ORDER BY started_at DESC, created_at DESC, rowid DESC LIMIT 2`,
      args: [baby.id],
    }),
    db.execute({
      sql: `SELECT started_at FROM activities
            WHERE baby_id = ? AND type = 'diaper'
            ORDER BY started_at DESC, created_at DESC, rowid DESC LIMIT 1`,
      args: [baby.id],
    }),
    activeChildcareSession(db, householdId, baby.id),
  ]);

  const sleeping = openSleep.rows.length > 0;
  const since = sleeping
    ? Number(openSleep.rows[0].started_at)
    : lastSleepEnd.rows[0] ? Number(lastSleepEnd.rows[0].ended_at) : null;

  const feeds = lastFeed.rows.map((row) => {
    const d = parseDetails(row.details);
    const breastmilk = positiveNumber(d.breastmilkAmount);
    const formula = positiveNumber(d.formulaAmount);
    const total = positiveNumber(d.amount) || breastmilk + formula;
    return {
      at: Number(row.started_at),
      milkType: formula > breastmilk || (d.milkType === "formula" && breastmilk === 0) ? "formula" as const : "breastmilk" as const,
      amount: Math.round(total),
    };
  });
  const feed = feeds[0] ?? null;

  // Garmin Monkey C numbers are 32-bit, so the watch reads these
  // "seconds ago" values instead of epoch milliseconds.
  const now = Date.now();
  const agoSec = (at: number | null | undefined) => at == null ? null : Math.max(0, Math.floor((now - at) / 1000));
  const lastDiaperAt = lastDiaper.rows[0] ? Number(lastDiaper.rows[0].started_at) : null;

  return {
    babyName: baby.name,
    babyId: baby.id,
    state: sleeping ? "sleeping" as const : "awake" as const,
    since,
    lastFeed: feed,
    lastDiaperAt,
    atChildcare: childcare != null,
    serverTime: now,
    sinceAgoSec: agoSec(since),
    lastFeedAgoSec: agoSec(feed?.at),
    // Newest first, at most two. lastFeed / lastFeedAgoSec stay for watch builds up to 1.0.0.
    recentFeeds: feeds.map((item) => ({ milkType: item.milkType, amount: item.amount, agoSec: agoSec(item.at) })),
    lastDiaperAgoSec: agoSec(lastDiaperAt),
  };
}

export function innerRequest(request: NextRequest, path: string, config: WatchConfig, body: unknown) {
  const cookie = [
    `mcphee_hh=${encodeURIComponent(config.householdId)}`,
    ...(config.userId ? [`mcphee_user=${encodeURIComponent(config.userId)}`] : []),
  ].join("; ");
  return new NextRequest(new URL(path, request.url), {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function feedDetails(milkType: "breastmilk" | "formula", amount: number) {
  const isBreastmilk = milkType === "breastmilk";
  return {
    feeds: [{
      milkType,
      amount,
      ...(isBreastmilk ? { libraryDeductionAmount: amount } : {}),
    }],
    amount,
    milkType,
    breastmilkAmount: isBreastmilk ? amount : 0,
    formulaAmount: isBreastmilk ? 0 : amount,
    notes: null,
  };
}

export const DIAPER_DETAILS = {
  pee: { poop: "no", peeUnits: "3", notes: null },
  poo: { poop: "M", peeUnits: "no", notes: null },
  both: { poop: "M", peeUnits: "3", notes: null },
} as const;

export async function relay(response: Response) {
  const data = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (response.ok) return { ok: true as const, data };
  if (data.code === CHILDCARE_CONFIRMATION_REQUIRED) {
    return { ok: false as const, status: 409, error: "At childcare. Log it on the phone.", code: "AT_CHILDCARE" };
  }
  return {
    ok: false as const,
    status: response.status,
    error: typeof data.error === "string" ? data.error : "Could not save",
    code: typeof data.code === "string" ? data.code : undefined,
  };
}

