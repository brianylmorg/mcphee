"use client";

import { useLayoutEffect, useRef } from "react";
import type { DailySleepWindows } from "@/lib/sleep-windows";
import { averageSleepWindows } from "@/lib/sleep-windows";
import { formatElapsedDuration } from "@/lib/elapsed-time";

export function SleepWindowsChart({
  days,
  metric,
}: {
  days: DailySleepWindows[];
  metric: "wake" | "nap";
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const latestDate = days[days.length - 1]?.date;

  useLayoutEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    const alignToLatest = () => {
      container.scrollLeft = Math.max(0, container.scrollWidth - container.clientWidth);
    };
    alignToLatest();
    let secondFrame: number | null = null;
    const frame = window.requestAnimationFrame(() => {
      alignToLatest();
      secondFrame = window.requestAnimationFrame(alignToLatest);
    });
    const timeout = window.setTimeout(alignToLatest, 120);
    const observer = new ResizeObserver(alignToLatest);
    observer.observe(container);
    if (container.firstElementChild) observer.observe(container.firstElementChild);
    return () => {
      window.cancelAnimationFrame(frame);
      if (secondFrame !== null) window.cancelAnimationFrame(secondFrame);
      window.clearTimeout(timeout);
      observer.disconnect();
    };
  }, [days.length, latestDate]);

  const wake = metric === "wake";
  const countFor = (day: DailySleepWindows) => wake ? day.wakeWindowCount : day.napCount;
  const totalFor = (day: DailySleepWindows) => wake ? day.wakeWindowTotalMs : day.napTotalMs;
  const daysWithValues = days.filter((day) => countFor(day) > 0);
  if (daysWithValues.length === 0) {
    return <p className="py-10 text-center text-sm text-muted">{wake ? "No completed wake windows yet." : "No completed naps yet."}</p>;
  }

  const height = 220;
  const baseline = 174;
  const topPadding = 24;
  const barWidth = 28;
  const step = 52;
  const width = Math.max(300, days.length * step + 28);
  const values = days.map((day) => countFor(day) > 0 ? totalFor(day) / countFor(day) : 0);
  const maxScale = Math.max(...values, 1);
  const availableHeight = baseline - topPadding;
  const lastSevenAverage = averageSleepWindows(days.slice(-7));
  const average = wake ? lastSevenAverage.wakeWindowMs : lastSevenAverage.napMs;
  const averageLabel = average == null ? "—" : formatElapsedDuration(average);
  const averageY = average == null ? null : baseline - average / maxScale * availableHeight;

  return (
    <figure className="mt-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <span className="text-sm font-semibold text-warm-brown">Last 7 days: {averageLabel}</span>
        <span className="inline-flex items-center gap-1.5 text-xs text-muted">
          <span className="h-px w-3 border-t border-dashed border-terracotta" />
          7-day average
        </span>
      </div>
      <div ref={scrollRef} className="overflow-x-auto overscroll-x-contain border-y border-border py-3 touch-pan-x">
        <svg
          role="img"
          aria-label={wake ? "Average wake window per day" : "Average nap length per day"}
          className="block min-w-full"
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
        >
          <line x1="0" y1={baseline} x2={width} y2={baseline} stroke="var(--color-border)" />
          {averageY != null && (
            <line x1="0" y1={averageY} x2={width} y2={averageY} stroke="var(--color-terracotta)" strokeDasharray="4 4" />
          )}
          {days.map((day, index) => {
            const count = countFor(day);
            const value = count > 0 ? totalFor(day) / count : null;
            const barHeight = value == null ? 0 : value / maxScale * availableHeight;
            const x = 20 + index * step;
            const formatted = value == null ? null : formatElapsedDuration(value);
            return (
              <g key={day.date}>
                <title>{value == null
                  ? `${day.date}: no completed ${wake ? "wake windows" : "naps"}`
                  : `${day.date}: ${count} ${wake ? "wake windows" : "naps"}, average ${formatted}`}</title>
                {value != null && (
                  <>
                    <rect x={x} y={baseline - barHeight} width={barWidth} height={barHeight} rx="3" fill={wake ? "var(--color-warning)" : "var(--color-info)"} />
                    <text x={x + barWidth / 2} y={Math.max(14, baseline - barHeight - 7)} textAnchor="middle" fontSize="10" fill="var(--color-warm-brown)" stroke="var(--color-surface)" strokeWidth="3" paintOrder="stroke">{formatted}</text>
                  </>
                )}
                <text x={x + barWidth / 2} y={baseline + 22} textAnchor="middle" fontSize="11" fill="var(--color-text-muted)">{day.date.slice(5).replace("-", "/")}</text>
              </g>
            );
          })}
        </svg>
      </div>
    </figure>
  );
}
