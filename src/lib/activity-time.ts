export const FUTURE_CLOCK_SKEW_MS = 2 * 60 * 1000;

/**
 * A time a moment ahead of now (a rounded picker minute, a phone clock running
 * fast) is meant as "now". Saved as-is it would stay out of totals and "latest"
 * readouts until the clock caught up, so it is pulled back to now. Times further
 * ahead are left for validation to judge.
 */
export function clampNearFutureToNow(at: number, now = Date.now()): number {
  return at > now && at <= now + FUTURE_CLOCK_SKEW_MS ? now : at;
}

const MINUTE_STEPS = Array.from({ length: 12 }, (_, index) => index * 5);

/** The picker's 5-minute steps, plus the exact minute it opened on so that minute can be kept. */
export function minuteOptionsIncluding(minute: number): number[] {
  return MINUTE_STEPS.includes(minute) ? MINUTE_STEPS : [...MINUTE_STEPS, minute].sort((a, b) => a - b);
}

/** Applies `clampNearFutureToNow` to a validated activity request's start and end. */
export function clampNearFutureActivityTimes(body: { startedAt?: unknown; endedAt?: unknown }, now = Date.now()): void {
  if (typeof body.startedAt === "number") body.startedAt = clampNearFutureToNow(body.startedAt, now);
  if (typeof body.endedAt === "number") body.endedAt = clampNearFutureToNow(body.endedAt, now);
}
