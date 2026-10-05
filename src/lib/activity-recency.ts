/**
 * Pure elapsed-time formatting for the Add Activity menu rows.
 *
 * Kept separate from React so it can be unit tested with an injected `now`.
 * Elapsed time is floored to whole minutes and clamped at zero so slightly
 * future timestamps never render a negative age.
 */

const MS_PER_MINUTE = 60 * 1000;

/**
 * Formats the elapsed time between `startedAt` and `now` as an exact,
 * uncapped label such as `2h 05mins ago`.
 *
 * Returns `null` when `startedAt` is not a finite number so callers can omit
 * the elapsed line rather than render garbage.
 */
export function formatElapsedSince(startedAt: number, now: number): string | null {
  if (!Number.isFinite(startedAt)) return null;

  const totalMinutes = Math.max(0, Math.floor((now - startedAt) / MS_PER_MINUTE));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}h ${String(minutes).padStart(2, "0")}mins ago`;
}
