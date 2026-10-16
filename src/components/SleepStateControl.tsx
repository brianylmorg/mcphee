"use client";

import { useEffect, useRef, useState } from "react";
import { Moon, Sun } from "lucide-react";

import { StorybookDay, StorybookNight } from "@/components/StorybookArt";

type SleepState = "awake" | "sleeping";

type SleepStateControlProps = {
  state: SleepState;
  elapsedLabel?: string;
  since?: number | null;
  disabled: boolean;
  compact?: boolean;
  onSelect: (state: SleepState) => void;
};

const SCENES = {
  awake: { label: "Awake", cta: "Wake up", Icon: Sun, Art: StorybookDay },
  sleeping: { label: "Sleeping", cta: "Sleep", Icon: Moon, Art: StorybookNight },
} as const;

/** Where a scene panel sits in the carousel track. */
type Role = "current" | "peek" | "leaving" | "parked";

/** How long the slide takes; the parked scene then glides back in as the peek. */
const SLIDE_MS = 900;

function formatElapsed(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const hours = Math.floor(totalSec / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
    : `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function rolesFor(current: SleepState, otherRole: Role): Record<SleepState, Role> {
  return current === "awake"
    ? { awake: "current", sleeping: otherRole }
    : { sleeping: "current", awake: otherRole };
}

/**
 * Sleep / awake control as an endless carousel. The current state's painted
 * scene fills the control; the other scene peeks in on the right through a
 * soft gradient with its call to action. Choosing it slides everything left:
 * the chosen scene takes the stage and the scene just left comes back round
 * from the right as the new peek, so the carousel always moves leftwards.
 */
export function SleepStateControl({ state, since = null, elapsedLabel, disabled, compact = false, onSelect }: SleepStateControlProps) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, []);

  const [roles, setRoles] = useState<Record<SleepState, Role>>(() => rolesFor(state, "peek"));
  const previous = useRef(state);
  useEffect(() => {
    if (previous.current === state) return;
    previous.current = state;
    // 1. slide: the old scene leaves to the left while the chosen one takes the stage.
    setRoles(rolesFor(state, "leaving"));
    // 2. park the old scene off to the right without animating, 3. glide it in as the peek.
    let frame = 0;
    const timer = window.setTimeout(() => {
      setRoles(rolesFor(state, "parked"));
      frame = window.requestAnimationFrame(() => {
        frame = window.requestAnimationFrame(() => setRoles(rolesFor(state, "peek")));
      });
    }, SLIDE_MS);
    return () => {
      window.clearTimeout(timer);
      window.cancelAnimationFrame(frame);
    };
  }, [state]);

  const elapsed = elapsedLabel ?? (since == null ? "Not timed yet" : formatElapsed(Math.max(0, now - since)));
  const untimed = since == null && elapsedLabel == null;

  return (
    <div
      data-compact={compact}
      data-state={state}
      role="group"
      aria-label="Sleep state"
      className={"sleep-toggle relative isolate min-w-0 overflow-hidden rounded-xl border border-border shadow-inner " + (compact ? "h-20" : "h-[6.25rem]")}
    >
      {(["awake", "sleeping"] as const).map((scene) => {
        const { label, cta, Icon, Art } = SCENES[scene];
        const role = roles[scene];
        return (
          <div key={scene} data-scene={scene} data-role={role} className="sleep-panel absolute inset-0">
            <span aria-hidden="true" className="sleep-scene"><Art /></span>
            {scene === state ? (
              <div className="sleep-status relative z-10 flex h-full items-center px-3" aria-live="polite">
                <div className="sleep-status-backing rounded-2xl px-3 py-1.5">
                  <p className="flex items-center gap-1.5 text-sm font-semibold">
                    <Icon aria-hidden="true" className="h-4 w-4 shrink-0" />
                    <span>{label}</span>
                  </p>
                  <p className={"sleep-elapsed font-display font-semibold tabular-nums " + (untimed ? "mt-0.5 text-sm" : compact ? "text-2xl leading-8" : "text-[2rem] leading-10")}>
                    {elapsed}
                  </p>
                </div>
              </div>
            ) : (
              <button
                type="button"
                aria-label={"Set state to " + label}
                disabled={disabled || role !== "peek"}
                onClick={() => onSelect(scene)}
                className="sleep-peek-cta absolute inset-y-0 z-10 flex w-[34%] items-center justify-center gap-1.5 pl-6 pr-2 text-sm font-semibold disabled:cursor-default"
              >
                <Icon aria-hidden="true" className="h-4 w-4 shrink-0" />
                <span className="whitespace-nowrap">{cta}</span>
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
