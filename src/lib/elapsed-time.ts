const MS_PER_MINUTE = 60 * 1000;
const MINUTES_PER_HOUR = 60;
const HOURS_PER_DAY = 24;

/**
 * Formats a non-negative duration using McPhee's compact text convention.
 * Durations under 24 hours keep the unpadded "Yh Xm" shape. From 24 hours on,
 * days are shown with comma separators, remaining hours unpadded, and minutes
 * padded to two digits, e.g. "1d, 1h, 00m".
 */
export function formatElapsedDuration(totalMs: number): string | null {
  if (!Number.isFinite(totalMs)) return null;

  const totalMinutes = Math.max(0, Math.floor(totalMs / MS_PER_MINUTE));
  const hours = Math.floor(totalMinutes / MINUTES_PER_HOUR);
  const minutes = totalMinutes % MINUTES_PER_HOUR;

  if (hours < HOURS_PER_DAY) {
    return `${hours}h ${minutes}m`;
  }

  const days = Math.floor(hours / HOURS_PER_DAY);
  const remainingHours = hours % HOURS_PER_DAY;
  const paddedMinutes = String(minutes).padStart(2, "0");
  return `${days}d, ${remainingHours}h, ${paddedMinutes}m`;
}

/**
 * Formats a timestamp relative to an injectable clock. Future timestamps are
 * clamped to zero so small device-clock differences do not show negative ages.
 */
export function formatElapsedSince(startedAt: number, now = Date.now()): string | null {
  if (!Number.isFinite(startedAt) || !Number.isFinite(now)) return null;
  const duration = formatElapsedDuration(now - startedAt);
  return duration == null ? null : `${duration} ago`;
}
