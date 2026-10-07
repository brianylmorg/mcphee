"use client";

import { useEffect, useState } from "react";
import { formatDate, formatTime } from "@/lib/utils";
import { formatElapsedSince } from "@/lib/elapsed-time";
import { sgtDateKey } from "@/lib/milk-volumes";
import LatestEntriesDisclosure from "./LatestEntriesDisclosure";

export interface RecentBottleFeedItem {
  id: string;
  startedAt: number;
  amountMl: number;
}

const ELAPSED_TICK_MS = 30 * 1000;
// The expansion shows the three most recent feeds. The fetched array is never
// mutated or re-fetched with a different limit; the bound is applied here.
const LATEST_FEED_COUNT = 3;

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
  const latestFeeds = feeds.slice(0, LATEST_FEED_COUNT);
  const newest = latestFeeds[0];

  const feedWhen = (feed: RecentBottleFeedItem) =>
    sgtDateKey(feed.startedAt) === todayDateKey
      ? formatTime(feed.startedAt)
      : `${formatDate(feed.startedAt)} · ${formatTime(feed.startedAt)}`;

  return (
    <div className="latest-feeds mt-2 border-t border-border/70 pt-2" aria-label="Recent bottle feeds">
      {newest ? (
        <LatestEntriesDisclosure
          className="latest-feeds-disclosure"
          title="Latest feeds"
          titleClassName="latest-feeds-title text-muted"
          summaryWrapperClassName="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5"
          summary={
            <>
              <span className="latest-entries-when font-semibold tabular-nums text-warm-brown">{feedWhen(newest)}</span>
              <span className="latest-entries-elapsed whitespace-nowrap font-semibold tabular-nums text-muted"><span aria-hidden="true">· </span>{formatElapsedSince(newest.startedAt, now)}</span>
              <span aria-label={`${newest.amountMl} ml consumed`} className="latest-entries-amount ml-auto shrink-0 whitespace-nowrap tabular-nums text-warm-brown">{newest.amountMl} ml</span>
            </>
          }
          entries={
            <div className="latest-feeds-list mt-1">
              {latestFeeds.map((feed) => {
                const elapsed = formatElapsedSince(feed.startedAt, now);
                return (
                  <div
                    key={feed.id}
                    data-feed-row={feed.id}
                    className="latest-feed-row flex items-baseline justify-between gap-3"
                  >
                    <span className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
                      <span className="latest-entries-when font-semibold tabular-nums text-warm-brown">{feedWhen(feed)}</span>
                      <span className="latest-entries-elapsed whitespace-nowrap font-semibold tabular-nums text-muted"><span aria-hidden="true">· </span>{elapsed}</span>
                    </span>
                    <span aria-label={`${feed.amountMl} ml consumed`} className="latest-entries-amount shrink-0 whitespace-nowrap tabular-nums text-warm-brown">{feed.amountMl} ml</span>
                  </div>
                );
              })}
            </div>
          }
        />
      ) : (
        <div className="latest-feeds-empty">
          <p className="latest-entries-title latest-feeds-title text-muted">Latest feeds</p>
          <p className="mt-1 text-xs text-muted">No bottle feeds logged yet.</p>
        </div>
      )}
    </div>
  );
}
