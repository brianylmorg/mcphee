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

export type DailySleepWindows = {
  /** Singapore calendar date, YYYY-MM-DD. */
  date: string;
  wakeWindowCount: number;
  wakeWindowTotalMs: number;
  napCount: number;
  napTotalMs: number;
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

function windowsForDay(intervals: readonly Interval[], dayStart: number): Omit<DailySleepWindows, "date"> {
  const empty = { wakeWindowCount: 0, wakeWindowTotalMs: 0, napCount: 0, napTotalMs: 0 };
  const dayEnd = dayStart + DAY_MS;
  const morningBoundary = dayStart + 5 * HOUR_MS;
  const bedtimeBoundary = dayStart + 18 * HOUR_MS;

  const wakeIndex = intervals.findIndex((interval) => (
    interval.end != null && interval.end >= morningBoundary && interval.end < dayEnd
  ));
  if (wakeIndex === -1) return empty;
  const morningWake = intervals[wakeIndex].end as number;

  const result = { ...empty };
  let awakeSince: number | null = morningWake;
  for (const sleep of intervals.slice(wakeIndex + 1)) {
    if (sleep.start >= dayEnd) break;
    if (awakeSince != null) {
      result.wakeWindowCount += 1;
      result.wakeWindowTotalMs += sleep.start - awakeSince;
    }
    // The first sleep from 6pm is bedtime: it closes the last wake window and
    // is not a nap. So is an earlier sleep that runs past midnight.
    if (sleep.start >= bedtimeBoundary) break;
    if (sleep.end == null || sleep.end >= dayEnd) break;
    result.napCount += 1;
    result.napTotalMs += sleep.end - sleep.start;
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
