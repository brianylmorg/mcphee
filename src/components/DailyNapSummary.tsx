"use client";

import { useEffect, useId, useState, type ReactNode } from "react";
import { Info } from "lucide-react";
import {
  calculateDailyNaps,
  type ConfirmedSleepCoverage,
  type DailyNapSession,
} from "@/lib/daily-naps";
import { formatElapsedDuration } from "@/lib/elapsed-time";
import { napTotalStatus } from "@/lib/sleep-windows";

const TICK_MS = 30 * 1000;

export function DailyNapSummary({
  sessions,
  confirmedCoverage = [],
  trailingAction,
  maxDaytimeMs = null,
  initialNow,
}: {
  sessions: readonly DailyNapSession[];
  confirmedCoverage?: readonly ConfirmedSleepCoverage[];
  trailingAction?: ReactNode;
  /** Usual maximum daytime nap total for his age; the total glows as it nears this. Null for no glow (e.g. while sick). */
  maxDaytimeMs?: number | null;
  /** Starting clock, for tests; the summary then ticks on the real clock. */
  initialNow?: number;
}) {
  const [now, setNow] = useState(() => initialNow ?? Date.now());
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

  const summary = calculateDailyNaps(sessions, now, confirmedCoverage);
  const totalStatus = summary.waitingForMorningWake ? null : napTotalStatus(summary.totalMs, maxDaytimeMs);

  return (
    <div className="daily-nap-summary mt-1 border-t border-border/70 pt-1">
      <div className="flex min-h-8 items-center justify-between gap-3" aria-live="polite">
        <div className="flex min-w-0 items-center">
          <div className="min-w-0">
            <p className="text-xs font-semibold text-warm-brown">Naps today</p>
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
            className="ml-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted transition-colors hover:bg-surface/60 hover:text-warm-brown focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-strong/60"
          >
            <Info aria-hidden="true" className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {/* Glows as the total nears his usual daytime maximum and pulses once past it (see .daily-nap-total). */}
          <p data-nap-total-status={totalStatus ?? undefined} className="daily-nap-total text-xs font-semibold tabular-nums text-warm-brown">
            {formatElapsedDuration(summary.totalMs) ?? "0h 0m"}
            {totalStatus && maxDaytimeMs != null ? (
              <span className="sr-only">{totalStatus === "past" ? `. Past the usual ${formatElapsedDuration(maxDaytimeMs)} of daytime sleep for his age` : `. Nearing the usual ${formatElapsedDuration(maxDaytimeMs)} of daytime sleep for his age`}</span>
            ) : null}
          </p>
          {trailingAction}
        </div>
      </div>
      <p
        id={infoId}
        hidden={!showInfo}
        className="rounded-lg bg-surface/55 px-3 py-2 text-xs leading-relaxed text-muted"
      >
          Singapore time: counting starts at the first recorded wake at or after 5am, or an earlier confirmed infant-care period, and stops at the first sleep at or after 6pm. Overnight sleep is excluded and ongoing daytime naps are included. A late nap starting at or after 6pm counts as bedtime. Resets at midnight. The total glows when it nears the usual daytime maximum for his age and pulses once past it (not on sick days).
      </p>
    </div>
  );
}
