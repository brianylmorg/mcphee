"use client";

import { useLayoutEffect, useRef } from "react";
import type { DailySleepWindows } from "@/lib/sleep-windows";
import { LAST_NAP_INDEX, medianNapMs, percentile } from "@/lib/sleep-windows";
import { formatElapsedDuration } from "@/lib/elapsed-time";

const HOUR_MS = 60 * 60 * 1000;
/** Compact axis label: "0", "30m", "1h", "1.5h". */
const axisLabel = (ms: number) => ms === 0 ? "0" : ms < HOUR_MS ? `${Math.round(ms / 60000)}m` : `${+(ms / HOUR_MS).toFixed(1)}h`;
const AXIS_WIDTH = 34;

const COLORS = ["var(--color-info)", "var(--color-terracotta)", "var(--color-warning)", "var(--color-warm-brown)"];
const ordinal = (index: number) => index === 1 ? "1st" : index === 2 ? "2nd" : index === 3 ? "3rd" : "4th+";

export function SleepWindowsChart({ days, metric, sickDates, ageGuide }: {
  days: DailySleepWindows[];
  metric: "wake" | "nap";
  sickDates: ReadonlySet<string>;
  ageGuide: { fromMs: number; toMs: number } | null;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const latestDate = days[days.length - 1]?.date;
  useLayoutEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    const alignToLatest = () => { container.scrollLeft = Math.max(0, container.scrollWidth - container.clientWidth); };
    alignToLatest();
    let secondFrame: number | null = null;
    const frame = window.requestAnimationFrame(() => { alignToLatest(); secondFrame = window.requestAnimationFrame(alignToLatest); });
    const timeout = window.setTimeout(alignToLatest, 120);
    const observer = new ResizeObserver(alignToLatest);
    observer.observe(container);
    if (container.firstElementChild) observer.observe(container.firstElementChild);
    return () => { window.cancelAnimationFrame(frame); if (secondFrame !== null) window.cancelAnimationFrame(secondFrame); window.clearTimeout(timeout); observer.disconnect(); };
  }, [days.length, latestDate]);

  const wake = metric === "wake";
  const daysWithValues = days.filter((day) => wake ? day.wakeWindows.length > 0 : medianNapMs(day) != null);
  if (daysWithValues.length === 0) return <p className="py-10 text-center text-sm text-muted">{wake ? "No completed wake windows yet." : "No completed naps yet."}</p>;

  const height = 220, baseline = 174, topPadding = 24, step = 52;
  const width = Math.max(300, days.length * step + 28);
  const allValues = wake ? days.flatMap((day) => day.wakeWindows.map((window) => window.durationMs)) : days.map(medianNapMs).filter((value): value is number => value != null);
  if (ageGuide) allValues.push(ageGuide.toMs);
  // Y axis: ticks every 30 minutes (hourly for longer ranges), scale rounded up to a whole tick.
  const tickStep = Math.max(...allValues, 1) > 3 * HOUR_MS ? HOUR_MS : HOUR_MS / 2;
  const maxScale = Math.max(tickStep, Math.ceil(Math.max(...allValues, 1) / tickStep) * tickStep);
  const ticks = Array.from({ length: Math.round(maxScale / tickStep) + 1 }, (_, i) => i * tickStep);
  const availableHeight = baseline - topPadding;
  const yFor = (value: number) => baseline - value / maxScale * availableHeight;
  // Sick days are left out of the typical figure, as they are from the zones.
  const recentWellDays = days.slice(-7).filter((day) => !sickDates.has(day.date));
  const typical = percentile(wake ? recentWellDays.flatMap((day) => day.wakeWindows.filter((window) => window.endsIn === "nap").map((window) => window.durationMs)) : recentWellDays.flatMap((day) => day.napDurationsMs), 0.5);
  const typicalLabel = typical == null ? "—" : formatElapsedDuration(typical);
  const legend = wake ? <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
    {COLORS.map((color, index) => <span key={index} className="inline-flex items-center gap-1"><i className="h-2 w-2 rounded-full" style={{ background: color }} />{ordinal(index + 1)}</span>)}
    <span className="inline-flex items-center gap-1"><i className="h-2 w-2 rounded-full border border-warm-brown bg-surface" />Before bed</span>
    {ageGuide ? <span className="inline-flex items-center gap-1"><i className="h-2 w-3 rounded-sm bg-success/20" />Age guide</span> : null}
  </span> : null;

  return <figure className="mt-5">
    <div className="mb-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2"><span className="text-sm font-semibold text-warm-brown">Last 7 days: typical {typicalLabel}</span>{legend}</div>
    <div className="flex border-y border-border py-3">
    {/* The axis stays put while the days scroll sideways. */}
    <svg aria-hidden="true" className="block shrink-0" width={AXIS_WIDTH} height={height} viewBox={`0 0 ${AXIS_WIDTH} ${height}`}>
      {ticks.map((tick) => <text key={tick} x={AXIS_WIDTH - 6} y={yFor(tick) + 3.5} textAnchor="end" fontSize="10" fill="var(--color-text-muted)">{axisLabel(tick)}</text>)}
    </svg>
    <div ref={scrollRef} className="min-w-0 flex-1 overflow-x-auto overscroll-x-contain touch-pan-x">
      <svg role="img" aria-label={wake ? "Wake windows per day" : "Median nap length per day"} className="block min-w-full" width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
        {ticks.filter((tick) => tick > 0).map((tick) => <line key={tick} x1="0" y1={yFor(tick)} x2={width} y2={yFor(tick)} stroke="var(--color-border)" strokeDasharray="2 4" />)}
        {wake && ageGuide ? <rect x="0" y={yFor(ageGuide.toMs)} width={width} height={Math.max(0, yFor(ageGuide.fromMs) - yFor(ageGuide.toMs))} fill="var(--color-success)" opacity="0.14" /> : null}
        <line x1="0" y1={baseline} x2={width} y2={baseline} stroke="var(--color-border)" />
        {days.map((day, index) => {
          const x = 20 + index * step;
          const centre = x + 14;
          const napValue = medianNapMs(day);
          const barHeight = napValue == null ? 0 : napValue / maxScale * availableHeight;
          return <g key={day.date}>
            {sickDates.has(day.date) ? <><rect x={x - 10} y={topPadding} width={step - 4} height={baseline - topPadding} fill="var(--color-frozen)" opacity="0.12" rx="4" /><text x={centre} y={baseline + 8} textAnchor="middle" fontSize="9" fill="var(--color-frozen-strong)">sick</text></> : null}
            {wake ? day.wakeWindows.map((window, windowIndex) => {
              const bedtime = window.endsIn === "bedtime";
              const label = bedtime ? "before bed" : `${ordinal(Math.min(window.index, LAST_NAP_INDEX))} wake window`;
              return <circle key={`${window.index}-${windowIndex}`} cx={centre + (window.index - 2.5) * 4} cy={yFor(window.durationMs)} r="4.5" fill={bedtime ? "var(--color-surface)" : COLORS[Math.min(window.index, LAST_NAP_INDEX) - 1]} stroke={bedtime ? "var(--color-warm-brown)" : "none"} strokeWidth={bedtime ? "1.5" : undefined}><title>{`${day.date}: ${label}, ${formatElapsedDuration(window.durationMs)}`}</title></circle>;
            }) : napValue != null ? <><rect x={x} y={baseline - barHeight} width="28" height={barHeight} rx="3" fill="var(--color-info)" /><text x={centre} y={Math.max(14, baseline - barHeight - 7)} textAnchor="middle" fontSize="10" fill="var(--color-warm-brown)" stroke="var(--color-surface)" strokeWidth="3" paintOrder="stroke">{formatElapsedDuration(napValue)}</text></> : null}
            <text x={centre} y={baseline + 22} textAnchor="middle" fontSize="11" fill="var(--color-text-muted)">{day.date.slice(5).replace("-", "/")}</text>
          </g>;
        })}
      </svg>
    </div>
    </div>
  </figure>;
}
