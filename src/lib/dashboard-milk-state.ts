import { bottleVolumes, parseActivityDetails, sgtDateKey } from "@/lib/milk-volumes";
import type { SickFeedSummary } from "@/lib/sick-mode";

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
