"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

type SleepStateControlProps = {
  state: "awake" | "sleeping";
  elapsedLabel?: string;
  since?: number | null;
  disabled: boolean;
  compact?: boolean;
  onSelect: (state: "awake" | "sleeping") => void;
};

const options = [
  { state: "awake" as const, label: "Awake", Icon: Sun },
  { state: "sleeping" as const, label: "Sleeping", Icon: Moon },
];

function formatElapsed(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const hours = Math.floor(totalSec / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
    : `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/** Decorative day scene: a glowing sun with clouds drifting behind the label. */
function DayScene() {
  return (
    <span aria-hidden="true" className="sleep-scene sleep-scene-day">
      <span className="sleep-sun" />
      <span className="sleep-cloud sleep-cloud-1" />
      <span className="sleep-cloud sleep-cloud-2" />
      <span className="sleep-cloud sleep-cloud-3" />
    </span>
  );
}

/** Decorative night scene: a crescent moon with twinkling stars. */
function NightScene() {
  return (
    <span aria-hidden="true" className="sleep-scene sleep-scene-night">
      <span className="sleep-moon" />
      {[1, 2, 3, 4, 5, 6].map((star) => (
        <span key={star} className={`sleep-star sleep-star-${star}`} />
      ))}
    </span>
  );
}

export function SleepStateControl({ state, since = null, elapsedLabel, disabled, compact = false, onSelect }: SleepStateControlProps) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, []);
  const displayedElapsed = elapsedLabel ?? (since == null ? "Not timed yet" : formatElapsed(Math.max(0, now - since)));
  return (
    <div
      data-compact={compact}
      data-state={state}
      className="sleep-toggle relative min-w-0 overflow-hidden rounded-xl border border-border bg-surface/60 p-1 shadow-inner"
      aria-label="Sleep state"
    >
      <div className="relative grid grid-cols-2 gap-1">
        <span
          aria-hidden="true"
          data-state={state}
          className="sleep-thumb pointer-events-none absolute inset-y-0 left-0 w-[calc(50%_-_0.125rem)] overflow-hidden rounded-lg shadow-sm transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none"
          style={{ transform: state === "sleeping" ? "translateX(calc(100% + 0.25rem))" : "translateX(0)" }}
        >
          <DayScene />
          <NightScene />
        </span>
        {options.map(({ state: optionState, label, Icon }) => {
          const active = state === optionState;
          return (
            <button
              key={optionState}
              type="button"
              aria-label={"Set state to " + label}
              aria-pressed={active}
              disabled={disabled}
              onClick={() => {
                if (!active) onSelect(optionState);
              }}
              className={"sleep-option relative z-10 flex min-w-0 items-center justify-center rounded-lg font-semibold transition-[color,opacity] duration-500 motion-reduce:transition-none disabled:opacity-50 "
                + (compact ? "min-h-9 gap-1.5 px-2 py-1 text-xs " : "min-h-14 flex-col gap-0 px-3 py-1.5 text-sm ")
                + (active ? "sleep-option-active" : "text-muted hover:text-warm-brown")}
            >
              <span className="flex items-center gap-1.5">
                <Icon
                  aria-hidden="true"
                  className={"h-4 w-4 shrink-0 transition-transform duration-500 ease-out motion-reduce:transition-none " + (active ? "scale-110" : "scale-90 opacity-60")}
                />
                <span>{label}</span>
              </span>
              {active && (
                <span className={"sleep-elapsed font-display font-semibold tabular-nums " + (compact || since == null && elapsedLabel == null ? "text-xs" : "text-lg leading-6")}>
                  {displayedElapsed}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
