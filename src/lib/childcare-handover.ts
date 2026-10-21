import { activityNoteText } from "@/lib/activity-note";

/** The slice of a dashboard activity the childcare summary reads. */
export interface HandoverActivity {
  type: string;
  started_at: number;
  details: string | Record<string, unknown> | null | undefined;
}

export interface HandoverBottle {
  at: number;
  /** "Breast milk", "Formula" or "Breast milk + formula". */
  milk: string;
  /** "120 ml", or "60 ml breast milk · 40 ml formula" for a mixed bottle. */
  volume: string;
  note: string;
}

export interface HandoverDiaper {
  at: number;
  /** "Pee 3 units", "No pee". */
  pee: string;
  /** "Poo M", "Poo", "No poo". */
  poo: string;
  note: string;
}

export interface ChildcareHandover {
  bottle: HandoverBottle | null;
  diaper: HandoverDiaper | null;
}

function parseDetails(details: HandoverActivity["details"]): Record<string, unknown> {
  if (!details) return {};
  if (typeof details === "object") return details;
  try {
    const parsed: unknown = JSON.parse(details);
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function positiveMl(value: unknown): number {
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0 ? amount : 0;
}

/** Same reading as the activity list: per-feed lines first, then the stored split, then the single amount. */
function bottleAmounts(details: Record<string, unknown>): { breastmilkMl: number; formulaMl: number } {
  let breastmilkMl = 0;
  let formulaMl = 0;
  if (Array.isArray(details.feeds)) {
    for (const item of details.feeds) {
      if (!item || typeof item !== "object") continue;
      const feed = item as Record<string, unknown>;
      const amount = positiveMl(feed.amount);
      if (feed.milkType === "formula") formulaMl += amount;
      else if (feed.milkType === "breastmilk") breastmilkMl += amount;
    }
    return { breastmilkMl, formulaMl };
  }
  breastmilkMl = positiveMl(details.breastmilkAmount);
  formulaMl = positiveMl(details.formulaAmount);
  if (breastmilkMl === 0 && formulaMl === 0) {
    const amount = positiveMl(details.amount);
    if (details.milkType === "formula") formulaMl = amount;
    else breastmilkMl = amount;
  }
  return { breastmilkMl, formulaMl };
}

function bottleSummary(activity: HandoverActivity): HandoverBottle {
  const details = parseDetails(activity.details);
  const { breastmilkMl, formulaMl } = bottleAmounts(details);
  const fallbackMilk = details.milkType === "formula" ? "Formula" : details.milkType === "breastmilk" ? "Breast milk" : "";
  const milk = breastmilkMl > 0 && formulaMl > 0
    ? "Breast milk + formula"
    : breastmilkMl > 0 ? "Breast milk" : formulaMl > 0 ? "Formula" : fallbackMilk;
  const volume = breastmilkMl > 0 && formulaMl > 0
    ? `${breastmilkMl} ml breast milk · ${formulaMl} ml formula`
    : breastmilkMl + formulaMl > 0 ? `${breastmilkMl + formulaMl} ml` : "";
  return { at: activity.started_at, milk, volume, note: activityNoteText(details) };
}

/** Pee units as the diaper form records them: 1-5, or the older M/L sizes. */
function peeLabel(value: unknown): string {
  const raw = typeof value === "number" ? String(value) : typeof value === "string" ? value : "";
  if (/^[1-5]$/.test(raw)) return `Pee ${raw} unit${raw === "1" ? "" : "s"}`;
  if (raw === "M") return "Pee 3 units";
  if (raw === "L") return "Pee 5 units";
  return "No pee";
}

/** Poo as recorded: M/L from the diaper form, "yes" from a caretaker screenshot. */
function pooLabel(value: unknown): string {
  if (value === "M" || value === "L") return `Poo ${value}`;
  if (value === "yes") return "Poo";
  return "No poo";
}

function diaperSummary(activity: HandoverActivity): HandoverDiaper {
  const details = parseDetails(activity.details);
  return {
    at: activity.started_at,
    pee: peeLabel(details.peeUnits ?? details.peeSize),
    poo: pooLabel(details.poop),
    note: activityNoteText(details),
  };
}

/**
 * The latest bottle feed and diaper change among the dashboard's recent
 * activities, for the summary shown while the baby is at childcare.
 */
export function childcareHandover(activities: readonly HandoverActivity[], now = Date.now()): ChildcareHandover {
  let bottle: HandoverActivity | null = null;
  let diaper: HandoverActivity | null = null;
  for (const activity of activities) {
    if (!Number.isFinite(activity.started_at) || activity.started_at > now + 2 * 60 * 1000) continue;
    if (activity.type === "bottlefeed" && (!bottle || activity.started_at > bottle.started_at)) bottle = activity;
    if (activity.type === "diaper" && (!diaper || activity.started_at > diaper.started_at)) diaper = activity;
  }
  return {
    bottle: bottle ? bottleSummary(bottle) : null,
    diaper: diaper ? diaperSummary(diaper) : null,
  };
}
