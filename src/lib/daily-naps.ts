const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const SGT_OFFSET_MS = 8 * HOUR_MS;

export type DailyNapSession = {
  id?: string;
  startedAt: number;
  endedAt?: number | null;
};

export type DailyNapTotal = {
  totalMs: number;
  dayStartAt: number | null;
  bedtimeAt: number | null;
  waitingForMorningWake: boolean;
};

type SleepInterval = {
  start: number;
  end: number;
};

type NormalizedSleepSession = {
  start: number;
  end: number | null;
};

function sgtDayStart(timestamp: number): number {
  return Math.floor((timestamp + SGT_OFFSET_MS) / DAY_MS) * DAY_MS - SGT_OFFSET_MS;
}

/**
 * Totals daytime sleep for the current Singapore calendar day.
 *
 * The day begins at the first recorded wake at or after 05:00 SGT. The first
 * sleep starting at or after 18:00 SGT is treated as bedtime, so that sleep and
 * later overnight activity are excluded. Overlapping intervals are merged to
 * avoid double-counting duplicated legacy rows.
 */
export function calculateDailyNaps(sessions: readonly DailyNapSession[], now: number): DailyNapTotal {
  if (!Number.isFinite(now)) {
    return { totalMs: 0, dayStartAt: null, bedtimeAt: null, waitingForMorningWake: true };
  }

  const calendarDayStart = sgtDayStart(now);
  const calendarDayEnd = calendarDayStart + DAY_MS;
  const morningBoundary = calendarDayStart + 5 * HOUR_MS;
  const bedtimeBoundary = calendarDayStart + 18 * HOUR_MS;

  const validSessions = sessions.flatMap<NormalizedSleepSession>((session): NormalizedSleepSession[] => {
    const start = Number(session.startedAt);
    if (!Number.isFinite(start) || start < 0 || start > now) return [];

    if (session.endedAt == null) return [{ start, end: null }];

    const end = Number(session.endedAt);
    if (!Number.isFinite(end) || end < start || end > now) return [];
    return [{ start, end }];
  });

  const dayStartAt = validSessions.reduce<number | null>((earliest, session) => {
    if (
      session.end == null ||
      session.end < morningBoundary ||
      session.end >= calendarDayEnd
    ) {
      return earliest;
    }
    return earliest == null || session.end < earliest ? session.end : earliest;
  }, null);

  if (dayStartAt == null) {
    return { totalMs: 0, dayStartAt: null, bedtimeAt: null, waitingForMorningWake: true };
  }

  const bedtimeAt = validSessions.reduce<number | null>((earliest, session) => {
    if (
      session.start < bedtimeBoundary ||
      session.start < dayStartAt ||
      session.start >= calendarDayEnd
    ) {
      return earliest;
    }
    return earliest == null || session.start < earliest ? session.start : earliest;
  }, null);
  const trackingEnd = Math.min(now, calendarDayEnd, bedtimeAt ?? Number.POSITIVE_INFINITY);

  const intervals = validSessions
    .map<SleepInterval | null>((session) => {
      const start = Math.max(session.start, dayStartAt);
      const end = Math.min(session.end ?? now, trackingEnd);
      return end > start ? { start, end } : null;
    })
    .filter((interval): interval is SleepInterval => interval != null)
    .sort((a, b) => a.start - b.start || a.end - b.end);

  let totalMs = 0;
  let merged: SleepInterval | null = null;
  for (const interval of intervals) {
    if (merged == null) {
      merged = { ...interval };
      continue;
    }
    if (interval.start <= merged.end) {
      merged.end = Math.max(merged.end, interval.end);
      continue;
    }
    totalMs += merged.end - merged.start;
    merged = { ...interval };
  }
  if (merged != null) totalMs += merged.end - merged.start;

  return {
    totalMs,
    dayStartAt,
    bedtimeAt,
    waitingForMorningWake: false,
  };
}
