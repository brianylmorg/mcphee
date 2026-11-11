"use client";

import { useEffect, useState } from "react";
import { Volume2 } from "lucide-react";

import { formatBlipDuration, openBlip, totalBlipMs, type BlipSettledBy, type SleepBlip } from "@/lib/sleep-blips";

type Props = {
  /** Blips in the current sleep, any order. */
  blips: SleepBlip[];
  disabled: boolean;
  onStart: () => void;
  onStop: (settledBy: BlipSettledBy) => void;
  /** Fixed clock for tests; the control ticks every second otherwise. */
  initialNow?: number;
};

function clockLabel(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(totalSec / 60)}:${String(totalSec % 60).padStart(2, "0")}`;
}

/**
 * Shown on the sleep card while he sleeps. One tap marks a blip (crying in
 * his sleep); one tap on how he settled ends it.
 */
export function SleepBlipControl({ blips, disabled, onStart, onStop, initialNow }: Props) {
  const [now, setNow] = useState(() => initialNow ?? Date.now());
  const live = openBlip(blips);
  useEffect(() => {
    if (initialNow != null) return;
    setNow(Date.now());
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [initialNow]);

  if (live) {
    return (
      <div className="sleep-blip mt-2 rounded-lg border border-border bg-surface/70 p-2" data-blip="open">
        <p className="flex items-center gap-1.5 text-sm font-semibold text-warm-brown" aria-live="polite">
          <Volume2 aria-hidden="true" className="h-4 w-4 shrink-0 text-accent-strong" />
          <span>Blip</span>
          <span className="sleep-blip-timer font-display tabular-nums" aria-label={`Blip going for ${clockLabel(now - live.startedAt)}`}>{clockLabel(now - live.startedAt)}</span>
        </p>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <button type="button" disabled={disabled} onClick={() => onStop("self")} className="min-h-11 rounded-lg bg-terracotta-dark px-2 py-2 text-sm font-semibold text-on-accent disabled:opacity-60">Settled himself</button>
          <button type="button" disabled={disabled} onClick={() => onStop("us")} className="min-h-11 rounded-lg border border-border px-2 py-2 text-sm font-semibold text-warm-brown disabled:opacity-60">We settled him</button>
        </div>
      </div>
    );
  }

  const count = blips.length;
  return (
    <div className="sleep-blip mt-2 flex items-center justify-between gap-2" data-blip="idle">
      <button
        type="button"
        disabled={disabled}
        onClick={onStart}
        aria-label="Start a blip (crying in his sleep)"
        className="flex min-h-11 items-center gap-1.5 rounded-lg border border-border bg-surface/70 px-3 py-2 text-sm font-semibold text-warm-brown disabled:opacity-60"
      >
        <Volume2 aria-hidden="true" className="h-4 w-4 text-accent-strong" />
        Blip
      </button>
      <p className="text-right text-xs text-muted tabular-nums">
        {count === 0 ? "No blips this sleep" : `${count} ${count === 1 ? "blip" : "blips"} · ${formatBlipDuration(totalBlipMs(blips, now))} this sleep`}
      </p>
    </div>
  );
}
