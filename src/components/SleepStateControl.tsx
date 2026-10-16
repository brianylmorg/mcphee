"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

import { StorybookDay, StorybookNight } from "@/components/StorybookArt";

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

/** Decorative day scene inside the sliding thumb. */
function DayScene() {
  return (
    <span aria-hidden="true" className="sleep-scene sleep-scene-day">
      <StorybookDay />
    </span>
  );
}

/** Decorative night scene inside the sliding thumb. */
function NightScene() {
  return (
    <span aria-hidden="true" className="sleep-scene sleep-scene-night">
      <StorybookNight />
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
  const current = options.find((option) => option.state === state)!;
  const other = options.find((option) => option.state !== state)!;
  const CurrentIcon = current.Icon;
  const OtherIcon = other.Icon;
  const untimed = since == null && elapsedLabel == null;

  // The whole toggle is the current state's scene. Both scenes stay mounted
  // and crossfade; the sun sinks as the moon rises (and back) on a switch.
  return (
    <div
      data-compact={compact}
      data-state={state}
      role="group"
      aria-label="Sleep state"
      className="sleep-toggle relative isolate min-w-0 overflow-hidden rounded-xl border border-border shadow-inner"
    >
      <span aria-hidden="true" className="sleep-scene sleep-scene-day"><StorybookDay /></span>
      <span aria-hidden="true" className="sleep-scene sleep-scene-night"><StorybookNight /></span>

      <div className={"sleep-toggle-content relative z-10 flex items-center justify-between gap-3 " + (compact ? "min-h-16 px-3 py-2" : "min-h-[6rem] px-4 py-3")}>
        <div className="min-w-0" aria-live="polite">
          <p className="sleep-state-label flex items-center gap-1.5 text-sm font-semibold">
            <CurrentIcon aria-hidden="true" className="h-4 w-4 shrink-0" />
            <span>{current.label}</span>
          </p>
          <p className={"sleep-elapsed font-display font-semibold tabular-nums " + (untimed ? "mt-0.5 text-sm" : compact ? "text-2xl leading-8" : "text-[2rem] leading-10")}>
            {displayedElapsed}
          </p>
        </div>
        <button
          type="button"
          aria-label={"Set state to " + other.label}
          disabled={disabled}
          onClick={() => onSelect(other.state)}
          className="sleep-switch inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border px-4 text-sm font-semibold shadow-sm backdrop-blur-sm transition-[color,background-color,border-color,transform] duration-700 active:scale-95 disabled:opacity-50 motion-reduce:transition-none"
        >
          <OtherIcon aria-hidden="true" className="h-4 w-4" />
          {other.state === "sleeping" ? "Sleep" : "Wake up"}
        </button>
      </div>
    </div>
  );
}
