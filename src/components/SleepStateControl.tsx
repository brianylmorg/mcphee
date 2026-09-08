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
      <div
        data-state={state}
        className={"relative overflow-hidden rounded-2xl border p-1.5 shadow-inner transition-[background-color,border-color,box-shadow] duration-700 motion-reduce:transition-none " + (state === "awake"
          ? "border-amber-200/90 bg-gradient-to-br from-amber-50 via-orange-50/80 to-rose-50/70 shadow-amber-100/70"
          : "border-sky-300/70 bg-gradient-to-br from-slate-100 via-sky-50 to-indigo-100/70 shadow-sky-200/60")}
        aria-label="Sleep state"
      >
        <div className="relative grid grid-cols-2 gap-1">
          <span
            aria-hidden="true"
            className={"pointer-events-none absolute inset-y-0 left-0 w-[calc(50%_-_0.125rem)] rounded-xl border shadow-sm transition-[transform,background-color,border-color,box-shadow] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none " + (state === "awake"
              ? "border-amber-300/80 bg-white/90 shadow-amber-200/70"
              : "border-sky-300/80 bg-slate-900 shadow-sky-300/30")}
            style={{ transform: state === "sleeping" ? "translateX(calc(100% + 0.25rem))" : "translateX(0)" }}
          />
          {options.map(({ state: optionState, label, Icon }) => {
            const active = state === optionState;
            const awake = optionState === "awake";
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
                className={"relative z-10 flex min-h-12 items-center justify-center gap-2 rounded-xl px-3 py-2.5 font-semibold transition-[color,opacity] duration-500 motion-reduce:transition-none " + (active
                  ? awake ? "text-amber-950" : "text-sky-50"
                  : state === "awake" ? "text-amber-950/55 hover:text-amber-950" : "text-slate-600 hover:text-slate-900") + " disabled:opacity-50"}
              >
                <Icon
                  aria-hidden="true"
                  className={"h-5 w-5 transition-[color,transform,filter] duration-500 ease-out motion-reduce:transition-none " + (active
                    ? awake ? "rotate-12 scale-110 text-amber-500 drop-shadow-sm" : "-rotate-12 scale-110 text-sky-200 drop-shadow-sm"
                    : "scale-90 opacity-60")}
                />
                <span>{label}</span>
              </button>
            );
          })}
        </div>
      </div>
      <div className="mt-3 flex items-baseline justify-between gap-4" aria-live="polite">
        <p className={"font-display text-2xl font-semibold transition-colors duration-500 motion-reduce:transition-none " + (state === "awake" ? "text-amber-800" : "text-sky-900")}>
          {state === "awake" ? "Awake" : "Sleeping"}
        </p>
        <p className={"font-display text-2xl font-semibold tabular-nums transition-colors duration-500 motion-reduce:transition-none " + (state === "awake" ? "text-amber-800" : "text-sky-900")}>
          {displayedElapsed}
        </p>
      </div>
    </div>
  );
}
