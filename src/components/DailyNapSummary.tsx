"use client";

import { useEffect, useId, useState } from "react";
import { Info } from "lucide-react";
import { calculateDailyNaps, type DailyNapSession } from "@/lib/daily-naps";

const TICK_MS = 30 * 1000;

function formatNapDuration(totalMs: number): string {
  const totalMinutes = Math.max(0, Math.floor(totalMs / (60 * 1000)));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}h ${String(minutes).padStart(2, "0")}mins`;
}

export function DailyNapSummary({ sessions }: { sessions: readonly DailyNapSession[] }) {
  const [now, setNow] = useState(() => Date.now());
  const [showInfo, setShowInfo] = useState(false);
  const infoId = useId();

  useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();
    const interval = window.setInterval(tick, TICK_MS);
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

  const summary = calculateDailyNaps(sessions, now);

  return (
    <div className="mt-3 border-t border-current/10 pt-2">
      <div className="flex min-h-11 items-center justify-between gap-3" aria-live="polite">
        <div className="flex min-w-0 items-center">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-warm-brown">Naps today</p>
            {summary.waitingForMorningWake && (
              <p className="truncate text-[11px] text-muted">Waiting for morning wake</p>
            )}
          </div>
          <button
            type="button"
            aria-label="How naps today is calculated"
            aria-expanded={showInfo}
            aria-controls={infoId}
            onClick={() => setShowInfo((current) => !current)}
            className="ml-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted transition-colors hover:bg-white/60 hover:text-warm-brown focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-strong/60"
          >
            <Info aria-hidden="true" className="h-3.5 w-3.5" />
          </button>
        </div>
        <p className="shrink-0 text-sm font-semibold tabular-nums text-warm-brown">
          {formatNapDuration(summary.totalMs)}
        </p>
      </div>
      <p
        id={infoId}
        hidden={!showInfo}
        className="rounded-lg bg-white/55 px-3 py-2 text-xs leading-relaxed text-muted"
      >
          Singapore time: counting starts at the first recorded wake at or after 5am and stops at the first sleep at or after 6pm. Overnight sleep is excluded and ongoing daytime naps are included. A late nap starting at or after 6pm counts as bedtime. Resets at midnight.
      </p>
    </div>
  );
}
