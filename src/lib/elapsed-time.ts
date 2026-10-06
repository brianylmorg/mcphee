const MS_PER_MINUTE = 60 * 1000;

/**
 * Formats a non-negative duration using McPhee's compact text convention.
 * Minutes are intentionally unpadded and hours are never collapsed into days.
 */
export function formatElapsedDuration(totalMs: number): string | null {
  if (!Number.isFinite(totalMs)) return null;

  const totalMinutes = Math.max(0, Math.floor(totalMs / MS_PER_MINUTE));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}h ${minutes}m`;
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
