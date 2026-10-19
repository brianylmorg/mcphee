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

/** One completed daytime nap. */
export type DayNap = {
  /** 1 for the first nap of the day, and so on. */
  index: number;
  startedAt: number;
  durationMs: number;
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
  naps: DayNap[];
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
    wakeWindowCount: 0, wakeWindowTotalMs: 0, napCount: 0, napTotalMs: 0, wakeWindows: [], napDurationsMs: [], naps: [],
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
    result.naps.push({ index: result.napCount, startedAt: sleep.start, durationMs: sleep.end - sleep.start });
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
  /** How many days back it looked to find enough samples. */
  lookbackDays: number;
  /** Typical time of day it starts and ends (median minutes after Singapore midnight). */
  startMinute: number;
  endMinute: number;
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

type Sample = { startedAt: number; durationMs: number };

function zoneOf(samples: readonly Sample[], lookbackDays: number): NapZone | null {
  if (samples.length < MIN_ZONE_SAMPLES) return null;
  const durations = samples.map((sample) => sample.durationMs);
  return {
    count: samples.length,
    medianMs: percentile(durations, 0.5) as number,
    fromMs: percentile(durations, 0.25) as number,
    toMs: percentile(durations, 0.75) as number,
    lookbackDays,
    startMinute: percentile(samples.map((sample) => sgtMinuteOfDay(sample.startedAt)), 0.5) as number,
    endMinute: percentile(samples.map((sample) => sgtMinuteOfDay(sample.startedAt + sample.durationMs)), 0.5) as number,
  };
}

type DaySamples = { wakeByIndex: Map<number, Sample[]>; bedtime: Sample[]; napByIndex: Map<number, Sample[]>; dayCount: number };

function collectSamples(days: readonly DailySleepWindows[]): DaySamples {
  const samples: DaySamples = { wakeByIndex: new Map(), bedtime: [], napByIndex: new Map(), dayCount: 0 };
  const add = (map: Map<number, Sample[]>, index: number, sample: Sample) => {
    const key = Math.min(index, LAST_NAP_INDEX);
    map.set(key, [...(map.get(key) ?? []), sample]);
  };
  for (const day of days) {
    if (day.wakeWindows.length > 0) samples.dayCount += 1;
    for (const window of day.wakeWindows) {
      if (window.endsIn === "bedtime") samples.bedtime.push(window);
      else add(samples.wakeByIndex, window.index, window);
    }
    for (const nap of day.naps) add(samples.napByIndex, nap.index, nap);
  }
  return samples;
}

/** Shared lookback ladder: each zone uses the shortest lookback with enough samples. */
function zoneFinder(
  days: readonly DailySleepWindows[],
  options: { lookbackDays?: number | readonly number[]; includeDate?: (date: string) => boolean },
) {
  const { lookbackDays = NAP_ZONE_LOOKBACKS, includeDate = () => true } = options;
  const ladder = typeof lookbackDays === "number" ? [lookbackDays] : lookbackDays;
  const byLookback = ladder.map((lookback) => ({
    lookback,
    samples: collectSamples(days.slice(-lookback).filter((day) => includeDate(day.date))),
  }));
  const first = (pick: (samples: DaySamples) => Sample[]): NapZone | null => {
    for (const { lookback, samples } of byLookback) {
      const zone = zoneOf(pick(samples), lookback);
      if (zone) return zone;
    }
    return null;
  };
  return { first, dayCount: byLookback[0]?.samples.dayCount ?? 0 };
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
  const { first, dayCount } = zoneFinder(days, options);
  const nap: Partial<Record<number, NapZone>> = {};
  for (let index = 1; index <= LAST_NAP_INDEX; index += 1) {
    const zone = first((samples) => samples.wakeByIndex.get(index) ?? []);
    if (zone) nap[index] = zone;
  }
  const bedtime = first((samples) => samples.bedtime);
  return { nap, bedtime, bedtimeWindowStartMinute: bedtime?.startMinute ?? null, dayCount };
}

/** Typical nap lengths and times by nap of the day (1st, 2nd, ...; the 4th on pooled), same rules as the wake-window zones. */
export function calculateNapLengthZones(
  days: readonly DailySleepWindows[],
  options: { lookbackDays?: number | readonly number[]; includeDate?: (date: string) => boolean } = {},
): Partial<Record<number, NapZone>> {
  const { first } = zoneFinder(days, options);
  const zones: Partial<Record<number, NapZone>> = {};
  for (let index = 1; index <= LAST_NAP_INDEX; index += 1) {
    const zone = first((samples) => samples.napByIndex.get(index) ?? []);
    if (zone) zones[index] = zone;
  }
  return zones;
}

/**
 * How far to trust a zone, as a rounded percentage. It rises with how many
 * stretches it's based on (3 is shaky, 20+ solid), how recent they are (the
 * last 14 days count fully; 28, 60 or 90 days less) and how steady they are
 * (a tight middle half relative to the typical length scores higher).
 */
export function zoneConfidence(zone: NapZone): number {
  const amount = zone.count / (zone.count + 3);
  const recency = zone.lookbackDays <= 14 ? 1 : zone.lookbackDays <= 28 ? 0.85 : zone.lookbackDays <= 60 ? 0.7 : 0.6;
  const relativeSpread = zone.medianMs > 0 ? (zone.toMs - zone.fromMs) / zone.medianMs : 1;
  const steadiness = Math.min(1, Math.max(0.6, 1.1 - relativeSpread));
  return Math.round((amount * recency * steadiness * 100) / 5) * 5;
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

/**
 * Commonly quoted upper end of total daytime sleep by age (parenting and
 * sleep-consultant charts; they differ by up to an hour). No cap under 3
 * months, when newborns nap a lot.
 */
const DAYTIME_SLEEP_MAX: { fromMonths: number; untilMonths: number; maxMs: number }[] = [
  { fromMonths: 3, untilMonths: 6, maxMs: 4 * HOUR_MS },
  { fromMonths: 6, untilMonths: 9, maxMs: 3.5 * HOUR_MS },
  { fromMonths: 9, untilMonths: 18, maxMs: 3 * HOUR_MS },
  { fromMonths: 18, untilMonths: 36, maxMs: 2.5 * HOUR_MS },
];

/** The usual maximum total daytime nap time for a baby born at `birthDate`, or null (no birth date, under 3 months or over 3 years). */
export function ageMaxDaytimeSleepMs(birthDate: number | null | undefined, now: number): number | null {
  if (birthDate == null || !Number.isFinite(birthDate) || birthDate > now) return null;
  const months = (now - birthDate) / (DAY_MS * 30.4375);
  return DAYTIME_SLEEP_MAX.find((band) => months >= band.fromMonths && months < band.untilMonths)?.maxMs ?? null;
}

/** Within this of the daytime maximum, the nap total starts to glow. */
export const NAP_TOTAL_NEAR_MS = 30 * MINUTE_MS;

/** Where today's nap total sits against the daytime maximum: nearing it, past it, or neither. */
export function napTotalStatus(totalMs: number, maxMs: number | null | undefined): "near" | "past" | null {
  if (maxMs == null || !Number.isFinite(totalMs)) return null;
  if (totalMs >= maxMs) return "past";
  if (totalMs >= maxMs - NAP_TOTAL_NEAR_MS) return "near";
  return null;
}

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
