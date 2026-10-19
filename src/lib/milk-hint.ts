// Feeds are roughly every 3 hours.
export const MILK_DUE_FROM_MS = 2 * 60 * 60 * 1000 + 45 * 60 * 1000;
export const MILK_PAST_FROM_MS = 3 * 60 * 60 * 1000 + 30 * 60 * 1000;
// Beyond this the log is probably just behind (e.g. a day at infant care), so
// no nudge rather than a stale "Past milk time".
export const MILK_STALE_FROM_MS = 8 * 60 * 60 * 1000;

export type MilkHint = { status: "due" | "past"; text: string };

export function milkHint(lastFeedAt: number | null | undefined, now: number, asleep = false): MilkHint | null {
  if (lastFeedAt == null || !Number.isFinite(lastFeedAt)) return null;
  const elapsed = now - lastFeedAt;
  if (elapsed < MILK_DUE_FROM_MS || elapsed >= MILK_STALE_FROM_MS) return null;

  const status = elapsed >= MILK_PAST_FROM_MS ? "past" : "due";
  return {
    status,
    text: asleep ? "Milk when he wakes" : status === "due" ? "Milk time" : "Past milk time",
  };
}
