const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const SGT_OFFSET_MS = 8 * HOUR_MS;
// Back-to-back sleep records this close together are one sleep, so a quick
// resettle or a split caretaker entry does not count as a tiny wake window.
const MERGE_GAP_MS = 5 * MINUTE_MS;

export type SleepWindowSession = {
  startedAt: number;
  endedAt?: number | null;
};

/** One completed wake window: from waking until the next sleep began. */
export type WakeWindow = {
  /** 1 for the stretch after morning wake, 2 after the first nap, and so on. */
  index: number;
  startedAt: number;
  durationMs: number;
  /** What ended it: a daytime nap, or bedtime. */
  endsIn: "nap" | "bedtime";
};

export type DailySleepWindows = {
  /** Singapore calendar date, YYYY-MM-DD. */
  date: string;
  wakeWindowCount: number;
  wakeWindowTotalMs: number;
  napCount: number;
  napTotalMs: number;
  wakeWindows: WakeWindow[];
  napDurationsMs: number[];
};

type Interval = { start: number; end: number | null };

function sgtDayStart(timestamp: number): number {
  return Math.floor((timestamp + SGT_OFFSET_MS) / DAY_MS) * DAY_MS - SGT_OFFSET_MS;
}

function sgtDateKey(dayStart: number): string {
  return new Date(dayStart + SGT_OFFSET_MS).toISOString().slice(0, 10);
}

function mergeSessions(sessions: readonly SleepWindowSession[], now: number): Interval[] {
  const valid = sessions.flatMap<Interval>((session) => {
    const start = Number(session.startedAt);
    if (!Number.isFinite(start) || start < 0 || start > now) return [];
    if (session.endedAt == null) return [{ start, end: null }];
    const end = Number(session.endedAt);
    if (!Number.isFinite(end) || end < start || end > now) return [];
    return [{ start, end }];
  }).sort((a, b) => a.start - b.start);

  const merged: Interval[] = [];
  for (const interval of valid) {
    const last = merged[merged.length - 1];
    if (last && (last.end == null || interval.start <= last.end + MERGE_GAP_MS)) {
      last.end = last.end == null || interval.end == null ? null : Math.max(last.end, interval.end);
      continue;
    }
    merged.push({ ...interval });
  }
  return merged;
}

/** Index of the interval whose end is the day's morning wake, or -1. */
function morningWakeIndex(intervals: readonly Interval[], dayStart: number): number {
  const morningBoundary = dayStart + 5 * HOUR_MS;
  const dayEnd = dayStart + DAY_MS;
  return intervals.findIndex((interval) => (
    interval.end != null && interval.end >= morningBoundary && interval.end < dayEnd
  ));
}

function windowsForDay(intervals: readonly Interval[], dayStart: number): Omit<DailySleepWindows, "date"> {
  const result: Omit<DailySleepWindows, "date"> = {
    wakeWindowCount: 0, wakeWindowTotalMs: 0, napCount: 0, napTotalMs: 0, wakeWindows: [], napDurationsMs: [],
  };
  const dayEnd = dayStart + DAY_MS;
  const bedtimeBoundary = dayStart + 18 * HOUR_MS;

  const wakeIndex = morningWakeIndex(intervals, dayStart);
  if (wakeIndex === -1) return result;

  let awakeSince: number | null = intervals[wakeIndex].end as number;
  for (const sleep of intervals.slice(wakeIndex + 1)) {
    if (sleep.start >= dayEnd) break;
    // The first sleep from 6pm is bedtime: it closes the last wake window and
    // is not a nap. So is an earlier sleep that runs past midnight.
    const isBedtime = sleep.start >= bedtimeBoundary || (sleep.end != null && sleep.end >= dayEnd);
    if (awakeSince != null) {
      const durationMs = sleep.start - awakeSince;
      result.wakeWindowCount += 1;
      result.wakeWindowTotalMs += durationMs;
      result.wakeWindows.push({ index: result.wakeWindowCount, startedAt: awakeSince, durationMs, endsIn: isBedtime ? "bedtime" : "nap" });
    }
    if (isBedtime || sleep.end == null) break;
    result.napCount += 1;
    result.napTotalMs += sleep.end - sleep.start;
    result.napDurationsMs.push(sleep.end - sleep.start);
    awakeSince = sleep.end;
  }
  return result;
}

/**
 * Per-day wake windows and nap lengths, oldest first, ending with today.
 *
 * Uses the same day as "Naps today": it starts at the first recorded wake at or
 * after 05:00 SGT and ends at bedtime, the first sleep starting at or after
 * 18:00 SGT. Overnight wakings are excluded. Only completed windows and naps
 * count, so an ongoing nap or the current awake stretch is left out. Days
 * without a recorded morning wake have zero counts.
 */
export function calculateSleepWindowHistory(
  sessions: readonly SleepWindowSession[],
  now: number,
  maxDays = 60,
): DailySleepWindows[] {
  if (!Number.isFinite(now)) return [];
  const intervals = mergeSessions(sessions, now);
  if (intervals.length === 0) return [];

  const today = sgtDayStart(now);
  const firstDay = Math.max(sgtDayStart(intervals[0].start), today - (maxDays - 1) * DAY_MS);
  const days: DailySleepWindows[] = [];
  for (let dayStart = firstDay; dayStart <= today; dayStart += DAY_MS) {
    days.push({ date: sgtDateKey(dayStart), ...windowsForDay(intervals, dayStart) });
  }
  return days;
}

/** Average across the given days, weighted by how many windows each had. */
export function averageSleepWindows(days: readonly DailySleepWindows[]): { wakeWindowMs: number | null; napMs: number | null } {
  const totals = days.reduce((sum, day) => ({
    wakeCount: sum.wakeCount + day.wakeWindowCount,
    wakeMs: sum.wakeMs + day.wakeWindowTotalMs,
    napCount: sum.napCount + day.napCount,
    napMs: sum.napMs + day.napTotalMs,
  }), { wakeCount: 0, wakeMs: 0, napCount: 0, napMs: 0 });
  return {
    wakeWindowMs: totals.wakeCount > 0 ? totals.wakeMs / totals.wakeCount : null,
    napMs: totals.napCount > 0 ? totals.napMs / totals.napCount : null,
  };
}

/** Linear-interpolated percentile (0-1) of an unsorted list; null when empty. */
export function percentile(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = (sorted.length - 1) * Math.min(1, Math.max(0, p));
  const low = Math.floor(rank);
  const high = Math.ceil(rank);
  return sorted[low] + (sorted[high] - sorted[low]) * (rank - low);
}

/** A typical wake window: the median, and the middle half (25th-75th percentile) as the zone. */
export type NapZone = {
  count: number;
  medianMs: number;
  fromMs: number;
  toMs: number;
  /** How many days back it looked to find enough wake windows. */
  lookbackDays: number;
};

/** Look back 14 days, or further when that has too few wake windows (after a sick spell, say). */
export const NAP_ZONE_LOOKBACKS = [14, 28, 60];

/** Wake windows from the 4th on are pooled: few days have that many. */
export const LAST_NAP_INDEX = 4;
/** Fewer samples than this and a zone is too noisy to show. */
export const MIN_ZONE_SAMPLES = 3;

export type NapZones = {
  /** Keyed by window index (1 = after morning wake); LAST_NAP_INDEX pools the rest. */
  nap: Partial<Record<number, NapZone>>;
  /** The stretch from the last nap to bedtime. */
  bedtime: NapZone | null;
  /** Typical time of day (minutes after Singapore midnight) that stretch starts. */
  bedtimeWindowStartMinute: number | null;
  /** Days that contributed. */
  dayCount: number;
};

function sgtMinuteOfDay(timestamp: number): number {
  return Math.floor(((timestamp + SGT_OFFSET_MS) % DAY_MS) / MINUTE_MS);
}

function zoneOf(durations: readonly number[], lookbackDays: number): NapZone | null {
  if (durations.length < MIN_ZONE_SAMPLES) return null;
  return {
    count: durations.length,
    medianMs: percentile(durations, 0.5) as number,
    fromMs: percentile(durations, 0.25) as number,
    toMs: percentile(durations, 0.75) as number,
    lookbackDays,
  };
}

type WindowSamples = { byIndex: Map<number, number[]>; bedtime: number[]; bedtimeStarts: number[]; dayCount: number };

function collectWindows(days: readonly DailySleepWindows[]): WindowSamples {
  const samples: WindowSamples = { byIndex: new Map(), bedtime: [], bedtimeStarts: [], dayCount: 0 };
  for (const day of days) {
    if (day.wakeWindows.length > 0) samples.dayCount += 1;
    for (const window of day.wakeWindows) {
      if (window.endsIn === "bedtime") {
        samples.bedtime.push(window.durationMs);
        samples.bedtimeStarts.push(sgtMinuteOfDay(window.startedAt));
        continue;
      }
      const index = Math.min(window.index, LAST_NAP_INDEX);
      samples.byIndex.set(index, [...(samples.byIndex.get(index) ?? []), window.durationMs]);
    }
  }
  return samples;
}

/**
 * Typical wake windows by position in the day, from the most recent days
 * (today included) that pass `includeDate`, so sick days can be left out of
 * the normal benchmark or used on their own. Each position uses the shortest
 * lookback in `lookbackDays` that has enough wake windows, so a recent sick
 * spell or a gap in logging reaches further back instead of showing nothing.
 */
export function calculateNapZones(
  days: readonly DailySleepWindows[],
  options: { lookbackDays?: number | readonly number[]; includeDate?: (date: string) => boolean } = {},
): NapZones {
  const { lookbackDays = NAP_ZONE_LOOKBACKS, includeDate = () => true } = options;
  const ladder = typeof lookbackDays === "number" ? [lookbackDays] : lookbackDays;
  const samplesByLookback = ladder.map((lookback) => ({
    lookback,
    samples: collectWindows(days.slice(-lookback).filter((day) => includeDate(day.date))),
  }));
  const firstZone = (pick: (samples: WindowSamples) => number[]): NapZone | null => {
    for (const { lookback, samples } of samplesByLookback) {
      const zone = zoneOf(pick(samples), lookback);
      if (zone) return zone;
    }
    return null;
  };
  const nap: Partial<Record<number, NapZone>> = {};
  for (let index = 1; index <= LAST_NAP_INDEX; index += 1) {
    const zone = firstZone((samples) => samples.byIndex.get(index) ?? []);
    if (zone) nap[index] = zone;
  }
  const bedtime = firstZone((samples) => samples.bedtime);
  const bedtimeStarts = bedtime ? samplesByLookback.find(({ lookback }) => lookback === bedtime.lookbackDays)?.samples.bedtimeStarts ?? [] : [];
  return {
    nap,
    bedtime,
    bedtimeWindowStartMinute: bedtime ? percentile(bedtimeStarts, 0.5) : null,
    dayCount: samplesByLookback[0]?.samples.dayCount ?? 0,
  };
}

/** Median completed nap length per day (null on days without a completed nap). */
export function medianNapMs(day: DailySleepWindows): number | null {
  return percentile(day.napDurationsMs, 0.5);
}

export type CurrentWakeWindow = { index: number; awakeSince: number };

/**
 * The awake stretch in progress, numbered like the history: 1 after morning
 * wake, 2 after the first nap of the day, and so on. Null while asleep or with
 * no sleep recorded. Waking before 05:00 counts as the day's first window.
 */
export function currentWakeWindow(sessions: readonly SleepWindowSession[], now: number): CurrentWakeWindow | null {
  if (!Number.isFinite(now)) return null;
  const intervals = mergeSessions(sessions, now);
  const last = intervals[intervals.length - 1];
  if (!last || last.end == null) return null;
  const awakeSince = last.end;
  const today = sgtDayStart(now);
  const wakeIndex = morningWakeIndex(intervals, today);
  if (wakeIndex === -1) return { index: 1, awakeSince };
  const napsSinceWake = intervals.length - 1 - wakeIndex;
  return { index: napsSinceWake + 1, awakeSince };
}

/**
 * Commonly published wake-window ranges by age. These come from sleep
 * consultants and parenting sites, not formal paediatric guidance, and
 * sources differ by up to half an hour; treat as a rough comparison only.
 */
const AGE_GUIDE: { untilMonths: number; fromMs: number; toMs: number }[] = [
  { untilMonths: 1, fromMs: 35 * MINUTE_MS, toMs: 60 * MINUTE_MS },
  { untilMonths: 3, fromMs: 60 * MINUTE_MS, toMs: 90 * MINUTE_MS },
  { untilMonths: 4, fromMs: 75 * MINUTE_MS, toMs: 120 * MINUTE_MS },
  { untilMonths: 5, fromMs: 90 * MINUTE_MS, toMs: 150 * MINUTE_MS },
  { untilMonths: 7, fromMs: 120 * MINUTE_MS, toMs: 180 * MINUTE_MS },
  { untilMonths: 10, fromMs: 150 * MINUTE_MS, toMs: 210 * MINUTE_MS },
  { untilMonths: 13, fromMs: 180 * MINUTE_MS, toMs: 240 * MINUTE_MS },
  { untilMonths: 18, fromMs: 240 * MINUTE_MS, toMs: 360 * MINUTE_MS },
  { untilMonths: 36, fromMs: 300 * MINUTE_MS, toMs: 360 * MINUTE_MS },
];

/** The age-guide wake window for a baby born at `birthDate` (epoch ms), or null. */
export function ageWakeWindowGuide(birthDate: number | null | undefined, now: number): { fromMs: number; toMs: number } | null {
  if (birthDate == null || !Number.isFinite(birthDate) || birthDate > now) return null;
  const months = (now - birthDate) / (DAY_MS * 30.4375);
  const band = AGE_GUIDE.find((entry) => months < entry.untilMonths);
  return band ? { fromMs: band.fromMs, toMs: band.toMs } : null;
}

export type NapHint = {
  /** Where the current stretch sits against the zone. */
  status: "before" | "in" | "past";
  /** Time left until the zone opens (0 once in or past it). */
  untilMs: number;
  fromMs: number;
  toMs: number;
  medianMs: number | null;
  /** Whose numbers: his own (normal or sick days), or the age guide. */
  source: "own" | "sick" | "age";
  /** What the zone leads to. */
  leadsTo: "nap" | "bedtime";
  index: number;
};

/** A stretch starting this close to his usual bedtime-stretch start heads to bed. */
const BEDTIME_LEAD_MINUTES = 45;

/**
 * The live nap hint for the current awake stretch. If it started around the
 * time his last stretch before bed usually does, it's his bedtime zone.
 * Otherwise his zone for this window of the day (from sick days while sick,
 * when there are enough), else the nearest earlier window's zone (an extra
 * nap on a short-nap day), else the age guide. Null when nothing applies.
 */
export function napHint(input: {
  current: CurrentWakeWindow | null;
  now: number;
  normal: NapZones;
  sick?: NapZones | null;
  isSick?: boolean;
  ageGuide?: { fromMs: number; toMs: number } | null;
}): NapHint | null {
  const { current, now, normal, sick, isSick = false, ageGuide } = input;
  if (!current) return null;
  const elapsed = now - current.awakeSince;
  const index = Math.min(current.index, LAST_NAP_INDEX);
  const statusFor = (fromMs: number, toMs: number): NapHint["status"] => elapsed < fromMs ? "before" : elapsed <= toMs ? "in" : "past";
  const untilFor = (fromMs: number) => Math.max(0, fromMs - elapsed);
  const fromZone = (zone: NapZone, source: NapHint["source"], leadsTo: NapHint["leadsTo"]): NapHint => ({
    status: statusFor(zone.fromMs, zone.toMs), untilMs: untilFor(zone.fromMs), fromMs: zone.fromMs, toMs: zone.toMs, medianMs: zone.medianMs, source, leadsTo, index: current.index,
  });

  const startedMinute = sgtMinuteOfDay(current.awakeSince);
  const headsToBed = (zones: NapZones | null | undefined) => (
    zones?.bedtime != null && zones.bedtimeWindowStartMinute != null && startedMinute >= zones.bedtimeWindowStartMinute - BEDTIME_LEAD_MINUTES
  );
  if (current.index > 1) {
    if (isSick && headsToBed(sick)) return fromZone(sick?.bedtime as NapZone, "sick", "bedtime");
    if (headsToBed(normal)) return fromZone(normal.bedtime as NapZone, "own", "bedtime");
  }
  if (isSick && sick?.nap[index]) return fromZone(sick.nap[index] as NapZone, "sick", "nap");
  for (let k = index; k >= 1; k -= 1) {
    if (normal.nap[k]) return fromZone(normal.nap[k] as NapZone, "own", "nap");
  }
  if (ageGuide) return { status: statusFor(ageGuide.fromMs, ageGuide.toMs), untilMs: untilFor(ageGuide.fromMs), fromMs: ageGuide.fromMs, toMs: ageGuide.toMs, medianMs: null, source: "age", leadsTo: "nap", index: current.index };
  return null;
}
