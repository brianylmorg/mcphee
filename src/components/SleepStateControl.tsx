"use client";

import { useEffect, useRef, useState } from "react";
import { Moon, Sun } from "lucide-react";

import { StorybookDay, StorybookNight } from "@/components/StorybookArt";
import { napHint } from "@/lib/sleep-windows";
import type { NapHint } from "@/lib/sleep-windows";
import { formatElapsedDuration } from "@/lib/elapsed-time";

type SleepState = "awake" | "sleeping";

type SleepStateControlProps = {
  state: SleepState;
  elapsedLabel?: string;
  since?: number | null;
  disabled: boolean;
  compact?: boolean;
  onSelect: (state: SleepState) => void;
  /** Inputs for the live nap-zone hint while awake; the control supplies "now" each tick. */
  napHintInput?: Omit<Parameters<typeof napHint>[0], "now"> | null;
};

const SCENES = {
  awake: { label: "Awake", cta: "Wake up", Icon: Sun, Art: StorybookDay },
  sleeping: { label: "Sleeping", cta: "Sleep", Icon: Moon, Art: StorybookNight },
} as const;

/** Where a scene panel sits in the carousel track. */
type Role = "current" | "peek" | "entering" | "leaving" | "parked";

/** How long the sweep takes; the parked scene then glides back in as the peek. */
const SLIDE_MS = 1000;

function formatElapsed(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const hours = Math.floor(totalSec / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
    : `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function clockDuration(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`;
}

function hintCopy(hint: NapHint): { text: string; detail: string } {
  const ordinal = hint.index === 1 ? "1st" : hint.index === 2 ? "2nd" : hint.index === 3 ? "3rd" : `${hint.index}th`;
  const from = formatElapsedDuration(hint.fromMs) ?? "";
  const to = formatElapsedDuration(hint.toMs) ?? "";
  const median = hint.medianMs == null ? "" : formatElapsedDuration(hint.medianMs) ?? "";
  const nap = hint.leadsTo === "nap";
  let text = hint.status === "before" ? `${nap ? "Nap" : "Bed"} ${clockDuration(hint.fromMs)}–${clockDuration(hint.toMs)}`
    : hint.status === "in" ? (nap ? "Nap time" : "Bedtime")
      : (nap ? "Past nap time" : "Past bedtime");
  if (hint.source === "sick" && hint.status === "before") text = `Sick · ${text}`;
  const detail = hint.source === "own"
    ? `${ordinal} wake window. Usually ${nap ? "naps" : "goes to bed"} after ${from}–${to}, typically ${median}. From the last 14 days, sick days left out.`
    : hint.source === "sick"
      ? `${ordinal} wake window. On sick days he usually naps after ${from}–${to}, typically ${median}.`
      : `Age guide: ${from}–${to} awake before a nap. Not enough of his own data yet.`;
  return { text, detail };
}

function rolesFor(current: SleepState, otherRole: Role, currentRole: Role = "current"): Record<SleepState, Role> {
  return current === "awake"
    ? { awake: currentRole, sleeping: otherRole }
    : { sleeping: currentRole, awake: otherRole };
}

/**
 * Sleep / awake control as an endless carousel. The current state's painted
 * scene fills the control; the other scene peeks in on the right through a
 * soft gradient with its call to action. Choosing it slides everything left:
 * the chosen scene takes the stage and the scene just left comes back round
 * from the right as the new peek, so the carousel always moves leftwards.
 */
export function SleepStateControl({ state, since = null, elapsedLabel, disabled, compact = false, onSelect, napHintInput = null }: SleepStateControlProps) {
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
    // 1. sweep: the chosen scene glides in over the old one with a feathered
    //    watercolour edge while the old one fades away beneath it.
    setRoles(rolesFor(state, "leaving", "entering"));
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
  const hint = napHintInput ? napHint({ ...napHintInput, now }) : null;

  return (
    <div
      data-compact={compact}
      data-state={state}
      role="group"
      aria-label="Sleep state"
      className={"sleep-toggle relative isolate min-w-0 overflow-hidden rounded-xl border border-border shadow-inner " + (compact ? "h-20" : "h-[6.25rem]")}
    >
      {(["awake", "sleeping"] as const).map((scene) => {
        const { label, Icon, Art } = SCENES[scene];
        const role = roles[scene];
        return (
          <div key={scene} data-scene={scene} data-role={role} className="sleep-panel absolute inset-0">
            <span aria-hidden="true" className="sleep-scene"><Art /></span>
            {scene === state ? (
              <div className="sleep-status relative z-10 flex h-full items-center px-3" aria-live="polite">
                <div className="sleep-status-backing rounded-2xl px-3 py-1.5">
                  <p className="flex items-center gap-1.5 text-base font-semibold">
                    <Icon aria-hidden="true" className="h-4 w-4 shrink-0" />
                    <span>{label}</span>
                    {scene === "awake" && hint ? (() => {
                      const { text, detail } = hintCopy(hint);
                      return <span data-nap-status={hint.status} title={detail} className="sleep-nap-hint ml-1 whitespace-nowrap rounded-full px-1.5 py-0.5 text-[10px] font-semibold leading-none tabular-nums">{text}<span className="sr-only">{". " + detail}</span></span>;
                    })() : null}
                  </p>
                  <p className={"sleep-elapsed font-display font-semibold tabular-nums " + (untimed ? "mt-0.5 text-sm" : compact ? "text-[1.75rem] leading-8" : "text-[2.4rem] leading-[2.75rem]")}>
                    {elapsed}
                  </p>
                </div>
              </div>
            ) : null}
          </div>
        );
      })}
      {/* The next state's call to action: plain text on the art, centred on the
          seam so it straddles both scenes. Its strip is the tap target. */}
      {(() => {
        const next: SleepState = state === "awake" ? "sleeping" : "awake";
        const { label, cta, Icon } = SCENES[next];
        const settled = roles[next] === "peek";
        return (
          <button
            type="button"
            data-target={next}
            aria-label={"Set state to " + label}
            disabled={disabled || !settled}
            onClick={() => onSelect(next)}
            className={"sleep-next-cta absolute inset-y-0 right-0 z-20 flex w-[26%] flex-col items-center justify-center gap-0.5 text-sm font-bold disabled:cursor-default " + (settled ? "opacity-100" : "opacity-0")}
          >
            <Icon aria-hidden="true" className="h-5 w-5" />
            <span className="whitespace-nowrap">{cta}</span>
          </button>
        );
      })()}
    </div>
  );
}
