"use client";

import { useEffect, useState } from "react";
import { formatTime } from "@/lib/utils";
import { formatElapsedSince } from "@/lib/activity-recency";

const ELAPSED_TICK_MS = 30 * 1000;

/**
 * Compact two-line recency label for Add Activity menu rows: the Singapore
 * timestamp of the last logged entry over the exact elapsed age.
 *
 * Owns its 30s clock (plus visibility/focus refresh) so ticking never
 * re-renders the dashboard. The parent only mounts it while the menu is open,
 * so closing the menu tears the timer down.
 */
export default function ActivityRecency({
  startedAt,
  overdue = false,
}: {
  startedAt: number;
  overdue?: boolean;
}) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();
    const interval = window.setInterval(tick, ELAPSED_TICK_MS);
    const handleVisibility = () => {
      if (document.visibilityState === "visible") tick();
    };
    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("focus", tick);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("focus", tick);
    };
  }, []);

  const timestamp = Number.isFinite(startedAt) ? formatTime(startedAt) : null;
  const elapsed = formatElapsedSince(startedAt, now);

  return (
    <span className="flex max-w-[62%] min-w-0 flex-col items-end text-right leading-tight">
      {timestamp && (
        <time
          dateTime={new Date(startedAt).toISOString()}
          className={"text-[11px] tabular-nums " + (overdue ? "text-white/80" : "text-muted")}
        >
          {timestamp}
        </time>
      )}
      {elapsed && (
        <span className={"text-xs font-medium tabular-nums " + (overdue ? "text-white" : "text-warm-brown-light")}>
          {elapsed}
        </span>
      )}
    </span>
  );
}
