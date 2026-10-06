"use client";

import { useEffect, useState } from "react";
import { formatDate, formatTime } from "@/lib/utils";
import { formatElapsedSince } from "@/lib/elapsed-time";
import { sgtDateKey } from "@/lib/milk-volumes";

export interface RecentBottleFeedItem {
  id: string;
  startedAt: number;
  amountMl: number;
}

const ELAPSED_TICK_MS = 30 * 1000;

/**
 * Recent bottle feeds with a self-updating elapsed label. Kept as its own
 * component so the 30s tick (plus visibility/focus refresh) never re-renders
 * the rest of the dashboard.
 */
export default function RecentBottleFeeds({ feeds }: { feeds: RecentBottleFeedItem[] }) {
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

  const todayDateKey = sgtDateKey(now);

  return (
    <div className="mt-3 border-t border-border/70 pt-3" aria-label="Recent bottle feeds">
      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">Latest feeds</p>
      {feeds.length > 0 ? (
        <div className="mt-1.5 divide-y divide-border/60">
          {feeds.map((feed) => {
            const when = sgtDateKey(feed.startedAt) === todayDateKey
              ? formatTime(feed.startedAt)
              : `${formatDate(feed.startedAt)} · ${formatTime(feed.startedAt)}`;
            const elapsed = formatElapsedSince(feed.startedAt, now);

            return (
              <div key={feed.id} className="flex items-baseline justify-between gap-3 py-1.5 first:pt-0 last:pb-0">
                <span className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 gap-y-0.5 text-xs">
                  <span className="font-semibold tabular-nums text-warm-brown">{when}</span>
                  <span className="font-semibold tabular-nums text-muted">{elapsed}</span>
                </span>
                <span className="shrink-0 whitespace-nowrap text-sm tabular-nums text-warm-brown">{feed.amountMl} ml consumed</span>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="mt-1 text-xs text-muted">No bottle feeds logged yet.</p>
      )}
    </div>
  );
}
