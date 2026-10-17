const SGT_OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Milliseconds from `now` until the next midnight in Singapore (UTC+8, no DST). */
export function msUntilNextSgtMidnight(now: number): number {
  const sgtMs = now + SGT_OFFSET_MS;
  return DAY_MS - (((sgtMs % DAY_MS) + DAY_MS) % DAY_MS);
}
