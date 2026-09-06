"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

type SleepStateControlProps = {
  state: "awake" | "sleeping";
  elapsedLabel?: string;
  since?: number | null;
  disabled: boolean;
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

export function SleepStateControl({ state, since = null, elapsedLabel, disabled, onSelect }: SleepStateControlProps) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, []);
  const displayedElapsed = elapsedLabel ?? (since == null ? "Not timed yet" : formatElapsed(Math.max(0, now - since)));
  return (
    <div>
      <div className="grid grid-cols-2 gap-1 rounded-2xl border border-border bg-surface-muted p-1" aria-label="Sleep state">
        {options.map(({ state: optionState, label, Icon }) => {
          const active = state === optionState;
          const awake = optionState === "awake";
          return (
            <button
              key={optionState}
              type="button"
              aria-label={`Set state to ${label}`}
              aria-pressed={active}
              disabled={disabled}
              onClick={() => {
                if (!active) onSelect(optionState);
              }}
              className={`flex min-h-12 items-center justify-center gap-2 rounded-xl px-3 py-2.5 font-semibold transition-all ${
                active
                  ? awake
                    ? "bg-amber-100 text-amber-900 shadow-sm ring-1 ring-amber-300"
                    : "bg-sky-100 text-sky-900 shadow-sm ring-1 ring-sky-300"
                  : "text-muted opacity-65 hover:bg-surface hover:opacity-100"
              } disabled:opacity-50`}
            >
              <Icon aria-hidden="true" className={`h-5 w-5 ${active && awake ? "text-amber-600" : active ? "text-sky-600" : ""}`} />
              <span>{label}</span>
            </button>
          );
        })}
      </div>
      <div className="mt-3 flex items-baseline justify-between gap-4" aria-live="polite">
        <p className={`font-display text-2xl font-semibold ${state === "awake" ? "text-amber-800" : "text-sky-800"}`}>
          {state === "awake" ? "Awake" : "Sleeping"}
        </p>
        <p className={`font-display text-2xl font-semibold tabular-nums ${state === "awake" ? "text-amber-800" : "text-sky-800"}`}>
          {displayedElapsed}
        </p>
      </div>
    </div>
  );
}
