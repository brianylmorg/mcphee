import { NIGHT_ENDS_HOUR } from "./daily-naps";

/**
 * Sleep blips: stretches inside a sleep when he cries or screams without
 * fully waking. Stored as `activities` rows of type "sleepblip" (ended_at
 * NULL while it lasts). A blip belongs to the sleep whose window contains its
 * start; there is no foreign key, so editing a sleep never orphans a row in
 * the database, and blips outside every sleep are simply not counted.
 */
export const SLEEP_BLIP_TYPE = "sleepblip";

/**
 * The dashboard Blip button is hidden (B, 14 Nov 2026): the start/stop timer
 * was forgotten at night and night feeds alone drive the night plan. Flip to
 * true to bring the button back; the API, diary rows and charts are untouched.
 */
export const SLEEP_BLIP_CONTROL_VISIBLE: boolean = false;

export type BlipSettledBy = "self" | "us";
/** How a blip ended: he settled on his own, a parent settled him, or he woke up. */
export type BlipEnding = BlipSettledBy | "woke";

export type SleepBlip = {
  id?: string;
  startedAt: number;
  endedAt: number | null;
  ending?: BlipEnding | null;
};

export type BlipSleep = {
  startedAt: number;
  endedAt?: number | null;
};

export type NightFeed = { startedAt: number; amountMl: number };

export type SleepBlipUndoToken = {
  kind: "started-blip" | "ended-blip";
  activityId: string;
  changedAt: number;
  issuedAt: number;
};

export const BLIP_UNDO_WINDOW_MS = 30_000;

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const SGT_OFFSET_MS = 8 * HOUR_MS;
const BEDTIME_HOUR = 18;
// Same rule as the wake-window charts: sleeps this close together are one sleep.
const MERGE_GAP_MS = 5 * MINUTE_MS;
const BEDTIME_FEED_MS = 30 * MINUTE_MS;
const FEED_DEDUPE_MS = 15 * MINUTE_MS;

export function isBlipSettledBy(value: unknown): value is BlipSettledBy {
  return value === "self" || value === "us";
}

export function blipEndingFromDetails(details: unknown): BlipEnding | null {
  let parsed = details;
  if (typeof details === "string") {
    try { parsed = JSON.parse(details); } catch { return null; }
  }
  if (!parsed || typeof parsed !== "object") return null;
  const ending = (parsed as Record<string, unknown>).ending;
  return ending === "self" || ending === "us" || ending === "woke" ? ending : null;
}

export function isSleepBlipUndoToken(value: unknown): value is SleepBlipUndoToken {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const token = value as Record<string, unknown>;
  return (token.kind === "started-blip" || token.kind === "ended-blip")
    && typeof token.activityId === "string" && token.activityId.length > 0
    && typeof token.changedAt === "number" && Number.isFinite(token.changedAt) && token.changedAt > 0
    && typeof token.issuedAt === "number" && Number.isFinite(token.issuedAt) && token.issuedAt > 0;
}

/** True while the token is fresh and its row still looks exactly as the action left it. */
export function canUndoBlip(
  token: SleepBlipUndoToken,
  row: { startedAt: number; endedAt: number | null } | null,
  now = Date.now(),
): boolean {
  if (token.issuedAt < token.changedAt || token.issuedAt > now + 2 * MINUTE_MS) return false;
  if (now - token.issuedAt > BLIP_UNDO_WINDOW_MS) return false;
  if (!row) return false;
  return token.kind === "started-blip"
    ? row.startedAt === token.changedAt && row.endedAt == null
    : row.endedAt === token.changedAt;
}

function blipEnd(blip: SleepBlip, now: number): number {
  return blip.endedAt == null ? now : Math.max(blip.startedAt, blip.endedAt);
}

function sleepEnd(sleep: BlipSleep, now: number): number {
  return sleep.endedAt == null ? now : sleep.endedAt;
}

/** Blips that started inside this sleep, oldest first. */
export function blipsInSleep<T extends SleepBlip>(blips: readonly T[], sleep: BlipSleep, now = Date.now()): T[] {
  const end = sleepEnd(sleep, now);
  return blips
    .filter((blip) => blip.startedAt >= sleep.startedAt && blip.startedAt <= end)
    .sort((a, b) => a.startedAt - b.startedAt);
}

export function totalBlipMs(blips: readonly SleepBlip[], now = Date.now()): number {
  return blips.reduce((total, blip) => total + Math.max(0, blipEnd(blip, now) - blip.startedAt), 0);
}

export function openBlip<T extends SleepBlip>(blips: readonly T[]): T | null {
  return blips.filter((blip) => blip.endedAt == null).sort((a, b) => b.startedAt - a.startedAt)[0] ?? null;
}

export type NightBlipSummary = {
  /** SGT date of the evening the night began, YYYY-MM-DD. */
  date: string;
  /** First sleep of the night (bedtime). */
  startedAt: number;
  /** Morning wake, or null while the night is still going. */
  endedAt: number | null;
  blipCount: number;
  blipMs: number;
  /** All qualifying night feeds, including feeds matched to blips or wakes. */
  feedCount: number;
  feedMl: number;
  /** Feeds not already represented by a logged blip or wake gap. */
  feedBlips: number;
  selfSettled: number;
  settledByUs: number;
  /** Blips that turned into a full wake. */
  becameWake: number;
  /** Times he was awake between night sleeps (gaps over five minutes). */
  wakeCount: number;
  /** Longest stretch asleep with no blip, feed or wake. */
  longestStretchMs: number;
  blips: SleepBlip[];
};

function sgtDateKey(timestamp: number): string {
  return new Date(timestamp + SGT_OFFSET_MS).toISOString().slice(0, 10);
}

/** The SGT evening a sleep starting at this time belongs to, or null for a daytime nap. */
function nightDateFor(startedAt: number): string | null {
  const sgt = startedAt + SGT_OFFSET_MS;
  const hour = Math.floor((sgt % DAY_MS) / HOUR_MS);
  if (hour >= BEDTIME_HOUR) return sgtDateKey(startedAt);
  if (hour < NIGHT_ENDS_HOUR) return sgtDateKey(startedAt - DAY_MS);
  return null;
}

export type NightSleepWindow = {
  date: string;
  startedAt: number;
  endedAt: number | null;
  intervals: Array<{ start: number; end: number; open: boolean }>;
};

/** Shared night grouping and five-minute sleep merging for charts and plans. */
export function nightSleepWindows(sleeps: readonly BlipSleep[], now: number): NightSleepWindow[] {
  const groups = new Map<string, Array<{ start: number; end: number; open: boolean }>>();
  for (const sleep of sleeps) {
    const start = Number(sleep.startedAt);
    if (!Number.isFinite(start) || start > now) continue;
    const date = nightDateFor(start);
    if (!date) continue;
    const open = sleep.endedAt == null;
    const end = open ? now : Number(sleep.endedAt);
    if (!Number.isFinite(end) || end < start) continue;
    const list = groups.get(date) ?? [];
    list.push({ start, end, open });
    groups.set(date, list);
  }

  return [...groups].map(([date, raw]) => {
    const intervals = raw.sort((a, b) => a.start - b.start).reduce<NightSleepWindow["intervals"]>((merged, item) => {
      const last = merged[merged.length - 1];
      if (last && item.start <= last.end + MERGE_GAP_MS) {
        last.end = Math.max(last.end, item.end);
        last.open = last.open || item.open;
      } else merged.push({ ...item });
      return merged;
    }, []);
    const last = intervals[intervals.length - 1];
    return { date, startedAt: intervals[0].start, endedAt: last.open ? null : last.end, intervals };
  }).sort((a, b) => b.startedAt - a.startedAt);
}

export function feedsInNight<T extends NightFeed>(feeds: readonly T[], night: Pick<NightSleepWindow, "startedAt" | "endedAt">, now: number): T[] {
  return feeds.filter((feed) => feed.startedAt > night.startedAt + BEDTIME_FEED_MS
    && feed.startedAt < (night.endedAt ?? now)
    && !(feed.amountMl > 0 && feed.amountMl <= 5));
}

/**
 * One row per night, newest first. A night is every sleep starting between
 * 18:00 and 07:00 SGT (the same bedtime and NIGHT_ENDS_HOUR rules as the nap
 * charts). Blips count when they start inside one of those sleeps. Feeds after
 * the first 30 minutes interrupt the night, deduped against blips and wake gaps.
 * If since is supplied, omit whole nights that began before that cutoff.
 */
export function nightBlipSummaries(
  sleeps: readonly BlipSleep[],
  blips: readonly SleepBlip[],
  now = Date.now(),
  nights = 14,
  since?: number,
  feeds: readonly NightFeed[] = [],
): NightBlipSummary[] {
  const sortedBlips = [...blips].sort((a, b) => a.startedAt - b.startedAt);
  const summaries: NightBlipSummary[] = [];
  for (const night of nightSleepWindows(sleeps, now)) {
    const { date, intervals } = night;
    if (since != null && intervals[0].start < since) continue;
    const nightBlips = sortedBlips
      .filter((blip) => intervals.some((interval) => blip.startedAt >= interval.start && blip.startedAt <= interval.end));

    const last = intervals[intervals.length - 1];
    const nightFeeds = feedsInNight(feeds, night, now);
    const wakeGaps = intervals.slice(1).map((interval, index) => ({
      start: intervals[index].end, end: interval.start,
    }));
    const feedBlips = nightFeeds.filter((feed) =>
      !sortedBlips.some((blip) => feed.startedAt >= blip.startedAt - FEED_DEDUPE_MS
        && feed.startedAt <= blipEnd(blip, now) + FEED_DEDUPE_MS)
      && !wakeGaps.some((gap) => feed.startedAt >= gap.start - FEED_DEDUPE_MS
        && feed.startedAt <= gap.end + FEED_DEDUPE_MS)).length;

    // Zero-length feed cuts share the blip timeline so out-of-order feeds and
    // feeds overlapping a logged blip cannot extend a quiet stretch.
    const interruptions = [
      ...sortedBlips.map((blip) => ({ start: blip.startedAt, end: blipEnd(blip, now) })),
      ...nightFeeds.map((feed) => ({ start: feed.startedAt, end: feed.startedAt })),
    ].sort((a, b) => a.start - b.start);

    let longestStretchMs = 0;
    for (const interval of intervals) {
      let cursor = interval.start;
      for (const interruption of interruptions) {
        const start = Math.max(interval.start, interruption.start);
        const end = Math.min(interval.end, interruption.end);
        if (start > end) continue;
        longestStretchMs = Math.max(longestStretchMs, start - cursor);
        cursor = Math.max(cursor, end);
      }
      longestStretchMs = Math.max(longestStretchMs, interval.end - cursor);
    }

    summaries.push({
      date,
      startedAt: intervals[0].start,
      endedAt: last.open ? null : last.end,
      blipCount: nightBlips.length + feedBlips,
      blipMs: totalBlipMs(nightBlips, now),
      feedCount: nightFeeds.length,
      feedMl: nightFeeds.reduce((total, feed) => total + feed.amountMl, 0),
      feedBlips,
      selfSettled: nightBlips.filter((blip) => blip.ending === "self").length,
      settledByUs: nightBlips.filter((blip) => blip.ending === "us").length,
      becameWake: nightBlips.filter((blip) => blip.ending === "woke").length,
      wakeCount: intervals.length - 1,
      longestStretchMs,
      blips: nightBlips,
    });
  }
  return summaries.sort((a, b) => b.date.localeCompare(a.date)).slice(0, nights);
}

/** "4m", "1h 05m"; under a minute reads "<1m". */
export function formatBlipDuration(ms: number): string {
  const minutes = Math.floor(Math.max(0, ms) / MINUTE_MS);
  if (minutes < 1) return "<1m";
  return minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
}
