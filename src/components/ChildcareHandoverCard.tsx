"use client";

import { useEffect, useState } from "react";
import { Baby, Eye, EyeOff, Milk } from "lucide-react";
import type { ChildcareHandover } from "@/lib/childcare-handover";
import { formatElapsedSince } from "@/lib/elapsed-time";

export interface ChildcareHandoverCardProps {
  babyName: string;
  checkedInAt: number;
  handover: ChildcareHandover;
  dimmed: boolean;
  onToggleBrowse: () => void;
  now?: number;
}

const SG_TIME_ZONE = "Asia/Singapore";
const sgTimeFormatter = new Intl.DateTimeFormat("en-SG", {
  timeZone: SG_TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
const sgDateFormatter = new Intl.DateTimeFormat("en-SG", {
  timeZone: SG_TIME_ZONE,
  day: "numeric",
  month: "short",
});
const sgCalendarDayFormatter = new Intl.DateTimeFormat("en-SG", {
  timeZone: SG_TIME_ZONE,
  year: "numeric",
  month: "numeric",
  day: "numeric",
});

function formatSgTime(at: number): string {
  return sgTimeFormatter.format(new Date(at));
}

function formatHandoverTime(at: number, now: number): string {
  const datePrefix = sgCalendarDayFormatter.format(new Date(at)) === sgCalendarDayFormatter.format(new Date(now))
    ? ""
    : sgDateFormatter.format(new Date(at)) + ", ";
  return datePrefix + formatSgTime(at);
}

export default function ChildcareHandoverCard({
  babyName,
  checkedInAt,
  handover,
  dimmed,
  onToggleBrowse,
  now: suppliedNow,
}: ChildcareHandoverCardProps) {
  const [clockNow, setClockNow] = useState(() => Date.now());
  useEffect(() => {
    if (suppliedNow !== undefined) return;
    const interval = setInterval(() => setClockNow(Date.now()), 30_000);
    return () => clearInterval(interval);
  }, [suppliedNow]);

  const now = suppliedNow ?? clockNow;
  const bottle = handover.bottle;
  const diaper = handover.diaper;

  return (
    <section aria-label="Childcare summary" className="childcare-dim-banner rounded-lg border border-terracotta/25 bg-terracotta/10 px-3 py-2">
      <div className="flex min-w-0 items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="min-w-0 text-sm font-medium text-warm-brown">{babyName} is at childcare</p>
          <p className="text-xs tabular-nums text-warm-brown-light">since {formatSgTime(checkedInAt)}</p>
        </div>
        <button
          type="button"
          onClick={onToggleBrowse}
          aria-pressed={!dimmed}
          className="inline-flex min-h-8 shrink-0 items-center gap-1.5 rounded-lg border border-terracotta/30 bg-surface px-3 text-xs font-semibold text-accent-strong transition-colors hover:bg-surface-muted"
        >
          {dimmed ? <Eye aria-hidden="true" className="h-3.5 w-3.5" /> : <EyeOff aria-hidden="true" className="h-3.5 w-3.5" />}
          {dimmed ? "Browse anyway" : "Grey out again"}
        </button>
      </div>
      <dl className="mt-2 grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2 border-t border-terracotta/20 pt-2">
        <div className="grid min-w-0 grid-cols-[1rem_minmax(0,1fr)] gap-x-2">
          <Milk aria-hidden="true" className="mt-0.5 h-4 w-4 text-accent-strong" />
          <div className="min-w-0">
            <dt className="text-xs font-semibold uppercase tracking-wide text-muted">Last bottle</dt>
            {bottle ? (
              <>
                <dd className="break-words text-sm font-semibold tabular-nums text-warm-brown">
                  {formatHandoverTime(bottle.at, now)} · {formatElapsedSince(bottle.at, now)}
                </dd>
                <dd className="break-words text-sm text-warm-brown">{[bottle.milk, bottle.volume].filter(Boolean).join(" · ")}</dd>
                {bottle.note !== "" && <dd className="break-words text-xs text-warm-brown-light">{bottle.note}</dd>}
              </>
            ) : <dd className="text-sm text-muted">None logged yet</dd>}
          </div>
        </div>
        <div className="grid min-w-0 grid-cols-[1rem_minmax(0,1fr)] gap-x-2">
          <Baby aria-hidden="true" className="mt-0.5 h-4 w-4 text-accent-strong" />
          <div className="min-w-0">
            <dt className="text-xs font-semibold uppercase tracking-wide text-muted">Last diaper</dt>
            {diaper ? (
              <>
                <dd className="break-words text-sm font-semibold tabular-nums text-warm-brown">
                  {formatHandoverTime(diaper.at, now)} · {formatElapsedSince(diaper.at, now)}
                </dd>
                <dd className="break-words text-sm text-warm-brown">{diaper.pee} · {diaper.poo}</dd>
                {diaper.note !== "" && <dd className="break-words text-xs text-warm-brown-light">{diaper.note}</dd>}
              </>
            ) : <dd className="text-sm text-muted">None logged yet</dd>}
          </div>
        </div>
      </dl>
    </section>
  );
}
