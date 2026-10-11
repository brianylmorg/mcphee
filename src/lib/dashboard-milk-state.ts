import { bottleVolumes, parseActivityDetails, sgtDateKey } from "@/lib/milk-volumes";
import { medianMilk, shiftSgtDate, type SickBaselineDay, type SickFeedSummary } from "@/lib/sick-mode";

export type MilkActivitySnapshot = {
  id: string;
  type: string;
  startedAt: number;
  details: unknown;
};

export type DailyMilkTotals = {
  totalMl: number;
  breastmilkMl: number;
  formulaMl: number;
};

export type SameTimeMilkHistoryDay = {
  date: string;
  totalMl: number;
  asOfNowMl: number;
  isSickDay?: boolean;
};

export type SameTimeMilkMedianEpisode = {
  startedAt: number;
  baselineSourceDays?: readonly SickBaselineDay[] | null;
};

export type SameTimeMilkMedianReference<T extends SameTimeMilkHistoryDay = SameTimeMilkHistoryDay> = {
  anchorDate: string;
  kind: "rolling" | "pre-sickness";
  days: T[];
  medianMl: number | null;
};

const SGT_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function isCanonicalSgtDate(date: unknown): date is string {
  if (typeof date !== "string" || !SGT_DATE_PATTERN.test(date)) return false;
  const timestamp = Date.parse(`${date}T00:00:00+08:00`);
  return Number.isFinite(timestamp) && sgtDateKey(timestamp) === date;
}

function isEligibleSameTimeDay(day: SameTimeMilkHistoryDay): boolean {
  return Number.isFinite(day.totalMl)
    && day.totalMl > 0
    && Number.isFinite(day.asOfNowMl)
    && day.asOfNowMl >= 0
    && day.isSickDay !== true;
}

/**
 * Selects the history used by the dashboard's same-time median.
 *
 * During an active sick episode, the saved baseline source dates are the only
 * allowed reference dates. Their saved full-day totals are deliberately not
 * used here: the current history supplies both eligibility and its same-time
 * amount. Without an active episode, the reference remains the seven completed
 * SGT days before today.
 */
export function sameTimeMilkMedianReference<T extends SameTimeMilkHistoryDay>(
  history: readonly T[],
  todayDate: string,
  activeEpisode: SameTimeMilkMedianEpisode | null = null,
): SameTimeMilkMedianReference<T> {
  if (activeEpisode) {
    const startedAt = Number(activeEpisode.startedAt);
    const anchorDate = Number.isFinite(startedAt) && Number.isFinite(new Date(startedAt).getTime())
      ? sgtDateKey(startedAt)
      : "";
    if (!isCanonicalSgtDate(anchorDate)) {
      return { anchorDate, kind: "pre-sickness", days: [], medianMl: null };
    }

    const windowStart = shiftSgtDate(anchorDate, -7);
    const windowEnd = shiftSgtDate(anchorDate, -1);
    const sourceDates = new Set<string>();
    for (const sourceDay of activeEpisode.baselineSourceDays ?? []) {
      const date = sourceDay?.date;
      if (isCanonicalSgtDate(date) && date >= windowStart && date <= windowEnd) {
        sourceDates.add(date);
      }
    }

    const days = history.filter((day) => sourceDates.has(day.date) && isEligibleSameTimeDay(day));
    return {
      anchorDate,
      kind: "pre-sickness",
      days,
      medianMl: medianMilk(days.map((day) => day.asOfNowMl)),
    };
  }

  const anchorDate = isCanonicalSgtDate(todayDate) ? todayDate : "";
  if (!anchorDate) return { anchorDate, kind: "rolling", days: [], medianMl: null };
  const windowStart = shiftSgtDate(anchorDate, -7);
  const windowEnd = shiftSgtDate(anchorDate, -1);
  const days = history.filter((day) =>
    day.date >= windowStart && day.date <= windowEnd && isEligibleSameTimeDay(day)
  );
  return {
    anchorDate,
    kind: "rolling",
    days,
    medianMl: medianMilk(days.map((day) => day.asOfNowMl)),
  };
}

function milkContribution(activity: MilkActivitySnapshot | null, date: string): DailyMilkTotals {
  if (!activity || activity.type !== "bottlefeed" || sgtDateKey(activity.startedAt) !== date) {
    return { totalMl: 0, breastmilkMl: 0, formulaMl: 0 };
  }
  const { breastmilkMl, formulaMl } = bottleVolumes(parseActivityDetails(activity.details));
  return { totalMl: breastmilkMl + formulaMl, breastmilkMl, formulaMl };
}

export function applyMilkActivityChangeToTotals(
  current: DailyMilkTotals,
  previous: MilkActivitySnapshot | null,
  next: MilkActivitySnapshot,
  date: string,
): DailyMilkTotals {
  const before = milkContribution(previous, date);
  const after = milkContribution(next, date);
  const clamp = (value: number) => Math.round(Math.max(0, value) * 100) / 100;
  const breastmilkMl = clamp(current.breastmilkMl - before.breastmilkMl + after.breastmilkMl);
  const formulaMl = clamp(current.formulaMl - before.formulaMl + after.formulaMl);
  return { totalMl: clamp(breastmilkMl + formulaMl), breastmilkMl, formulaMl };
}

export function updateRecentMilkFeedList<T extends { id: string; startedAt: number; amountMl: number }>(
  current: T[],
  previousId: string | null,
  next: MilkActivitySnapshot,
  now = Date.now(),
  limit = 3,
): T[] {
  const remaining = current.filter((feed) => feed.id !== previousId && feed.id !== next.id);
  if (next.type === "bottlefeed" && next.startedAt <= now) {
    const volumes = bottleVolumes(parseActivityDetails(next.details));
    const amountMl = Math.round((volumes.breastmilkMl + volumes.formulaMl) * 100) / 100;
    if (amountMl > 0) remaining.push({ id: next.id, startedAt: next.startedAt, amountMl } as T);
  }
  return remaining.sort((left, right) => right.startedAt - left.startedAt).slice(0, limit);
}

export function updateSickLatestMilkFeeds(
  current: SickFeedSummary[],
  previousId: string | null,
  next: MilkActivitySnapshot,
  now = Date.now(),
  limit = 3,
): SickFeedSummary[] {
  const remaining = current.filter((feed) => feed.id !== previousId && feed.id !== next.id);
  if (next.type === "bottlefeed" && next.startedAt <= now) {
    const { breastmilkMl, formulaMl } = bottleVolumes(parseActivityDetails(next.details));
    const totalMl = Math.round((breastmilkMl + formulaMl) * 100) / 100;
    if (totalMl > 0) remaining.push({ id: next.id, startedAt: next.startedAt, totalMl, breastmilkMl, formulaMl });
  }
  return remaining.sort((left, right) => right.startedAt - left.startedAt).slice(0, limit);
}

export function shouldHoldDashboardForSickMode(
  isLoading: boolean,
  babyId: string | null,
  sickModeLoadedBabyId: string | null,
): boolean {
  return isLoading || Boolean(babyId && babyId !== sickModeLoadedBabyId);
}
