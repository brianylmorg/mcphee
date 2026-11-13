import { feedsInNight, nightSleepWindows, type BlipSleep, type NightFeed } from "./sleep-blips";

const HOUR = 3600_000;
const DAY = 24 * HOUR;
export const NIGHT_SLOT_LABELS = { evening: "Evening", midnight: "01:00", early: "05:00" } as const;
export type NightSlot = keyof typeof NIGHT_SLOT_LABELS;
const CLOCK_ORDER: NightSlot[] = ["evening", "midnight", "early"];
const WEAN_ORDER: NightSlot[] = ["evening", "early", "midnight"];
export type NightPlanInputs = {
  sleeps: readonly BlipSleep[];
  /** Zero represents a breastfeed; missing/invalid bottle amounts are unknown too. */
  feeds: readonly NightFeed[];
  weights: readonly { measuredAt: number; weightG: number }[];
  isSick: boolean;
  now: number;
};
export type SlotPlan = {
  mode: "active" | "usual" | "gone" | "settle-first" | "locked" | "unknown";
  usualMl?: number;
  tonightMl?: number;
};
export type NightPlan = {
  status: "ready" | "paused" | "not-enough-data";
  reason?: "sick mode" | "milk below 700 ml on both previous days" | "weight has fallen";
  note?: "weigh";
  activeSlot: NightSlot | null;
  slots: Partial<Record<NightSlot, SlotPlan>>;
  dayMilkMl: number;
  dayTargetMl: 650;
};

export function slotForTime(ms: number): NightSlot | null {
  const hour = new Date(ms + 8 * HOUR).getUTCHours();
  return hour >= 18 ? "evening" : hour < 4 ? "midnight" : hour < 7 ? "early" : null;
}

/** An open night, including a closed sleep within its five-minute merge window. */
export function currentNightSlot({ sleeps, now }: Pick<NightPlanInputs, "sleeps" | "now">): NightSlot | null {
  const slot = slotForTime(now);
  if (!slot) return null;
  const night = nightSleepWindows(sleeps, now)[0];
  return night && now > night.startedAt + 30 * 60_000
    && (night.endedAt == null || (night.endedAt <= now && now - night.endedAt <= 5 * 60_000))
    ? slot : null;
}

const round10 = (ml: number) => Math.round(ml / 10) * 10;
const knownMl = (feed: NightFeed) => Number.isFinite(feed.amountMl) && feed.amountMl > 0 ? feed.amountMl : 0;

export function computeNightPlan({ sleeps, feeds, weights, isSick, now }: NightPlanInputs): NightPlan {
  const dayStart = Math.floor((now + HOUR) / DAY) * DAY - HOUR; // 07:00 SGT = 23:00 UTC
  const milkBetween = (start: number, end: number) => feeds.filter((f) => f.startedAt >= start && f.startedAt < end);
  const total = (rows: readonly NightFeed[]) => rows.reduce((sum, f) => sum + knownMl(f), 0);
  const plan: NightPlan = {
    status: "ready", activeSlot: null, slots: {},
    dayMilkMl: total(milkBetween(dayStart, now + 1)), dayTargetMl: 650,
  };
  const sortedWeights = weights.filter((w) => w.measuredAt <= now && Number.isFinite(w.weightG) && w.weightG > 0)
    .slice().sort((a, b) => b.measuredAt - a.measuredAt);
  const previousDays = [1, 2].map((days) => milkBetween(dayStart - days * DAY, dayStart - (days - 1) * DAY));
  if (isSick) plan.reason = "sick mode";
  else if (previousDays.every((rows) => rows.length > 0 && total(rows) < 700)) plan.reason = "milk below 700 ml on both previous days";
  else if (sortedWeights.length >= 2 && sortedWeights[0].weightG < sortedWeights[1].weightG) plan.reason = "weight has fallen";
  if (plan.reason) return { ...plan, status: "paused" };

  const history = nightSleepWindows(sleeps, now)
    .filter((night) => night.endedAt != null && night.endedAt <= now && night.startedAt >= now - 10 * DAY).slice(0, 7);
  if (history.length < 4) return { ...plan, status: "not-enough-data" };
  const totalsBySlot = {} as Record<NightSlot, number[]>;
  for (const slot of CLOCK_ORDER) {
    const usableTotals = history.flatMap((night) => {
      const rows = feedsInNight(feeds, night, now).filter((feed) => slotForTime(feed.startedAt) === slot);
      return rows.some((feed) => !Number.isFinite(feed.amountMl) || feed.amountMl <= 0) ? [] : [total(rows)];
    });
    totalsBySlot[slot] = usableTotals;
    if (usableTotals.length >= 2 && usableTotals[0] === 0 && usableTotals[1] === 0) {
      plan.slots[slot] = { mode: "gone" };
      continue;
    }
    const nonzero = usableTotals.filter((ml) => ml > 0).sort((a, b) => a - b);
    if (usableTotals.length < 2 || nonzero.length === 0) {
      plan.slots[slot] = { mode: "unknown" };
      continue;
    }
    const middle = Math.floor(nonzero.length / 2);
    const usualMl = round10(nonzero.length % 2 ? nonzero[middle] : (nonzero[middle - 1] + nonzero[middle]) / 2);
    plan.slots[slot] = { mode: "usual", usualMl, tonightMl: usualMl };
  }
  plan.activeSlot = WEAN_ORDER.find((slot) => plan.slots[slot]?.mode !== "gone") ?? null;
  if (!plan.activeSlot) return plan;
  const active = plan.slots[plan.activeSlot]!;
  if (active.mode === "unknown") return plan;
  if (plan.activeSlot === "midnight") {
    const latest = sortedWeights[0];
    const earlier = latest && sortedWeights.find((w) => latest.measuredAt - w.measuredAt >= 7 * DAY);
    const gaining = latest && earlier && now - latest.measuredAt <= 14 * DAY
      && (latest.weightG - earlier.weightG) / ((latest.measuredAt - earlier.measuredAt) / (7 * DAY)) >= 70;
    if (!gaining) {
      active.mode = "locked";
      plan.note = "weigh";
      return plan;
    }
  }
  const m = Math.max(...totalsBySlot[plan.activeSlot].slice(0, 2));
  active.mode = m <= 60 ? "settle-first" : "active";
  active.tonightMl = m <= 60 ? 0 : Math.max(0, Math.min(round10(m - 20), active.usualMl! + 20, Math.max(active.usualMl!, m)));
  return plan;
}

/** Shared Tonight line, ordered by clock rather than weaning order. */
export function nightPlanTonightText(plan: NightPlan): string {
  return CLOCK_ORDER.flatMap((slot) => {
    const size = plan.slots[slot];
    if (!size || size.mode === "gone" || size.mode === "unknown") return [];
    const label = NIGHT_SLOT_LABELS[slot];
    return [size.mode === "settle-first" ? `${label}: settle first` : `${label} ${size.tonightMl} ml`];
  }).join(" · ");
}

export function nightPlanSummaryText(plan: NightPlan, _babyName?: string): string | null {
  if (plan.status !== "ready") return null;
  const tonight = nightPlanTonightText(plan);
  return `Milk since 7am: ${plan.dayMilkMl} of ${plan.dayTargetMl} ml.${tonight ? ` Tonight: ${tonight}.` : ""}`;
}
