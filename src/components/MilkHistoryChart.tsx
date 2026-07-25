"use client";

import { useLayoutEffect, useRef } from "react";

type MilkDaySummary = {
  date: string;
  totalMl: number;
  breastmilkMl: number;
  formulaMl: number;
  expectedMl: number | null;
  asOfNowMl: number;
};

export function MilkHistoryChart({
  days,
  isLoading,
}: {
  days: MilkDaySummary[];
  isLoading: boolean;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const latestDate = days[days.length - 1]?.date;

  // Start scrolled to the latest day: apply before first paint, then re-apply
  // after paint in case the scrollable layout settles late (iOS Safari can
  // ignore scrollLeft set in a post-paint effect).
  useLayoutEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    container.scrollLeft = container.scrollWidth;
    const frame = window.requestAnimationFrame(() => {
      container.scrollLeft = container.scrollWidth;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [days.length, latestDate]);

  if (isLoading) {
    return <p className="py-12 text-center text-sm text-muted">Loading history…</p>;
  }

  if (days.length === 0) {
    return <p className="py-12 text-center text-sm text-muted">No bottlefeeds logged yet.</p>;
  }

  const height = 220;
  const baseline = 174;
  const topPadding = 24;
  const barWidth = 28;
  const step = 52;
  const width = Math.max(300, days.length * step + 28);
  const maxScale = Math.max(...days.map((day) => Math.max(day.totalMl, day.expectedMl ?? 0)), 1);
  const availableHeight = baseline - topPadding;

  return (
    <figure className="mt-5">
      <div className="mb-3 flex flex-wrap gap-x-4 gap-y-2 text-xs text-muted">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-terracotta" />
          Breastmilk
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-info" />
          Formula
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-px w-3 bg-warning" />
          Expected
        </span>
      </div>
      <div ref={scrollRef} className="overflow-x-auto overscroll-x-contain border-y border-border py-3 touch-pan-x">
        <svg
          role="img"
          aria-label="Daily total milk consumption and expected target chart"
          className="block min-w-full"
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
        >
          <line
            x1="0"
            y1={baseline}
            x2={width}
            y2={baseline}
            stroke="var(--color-border)"
          />
          {days.map((day, index) => {
            const x = 20 + index * step;
            const totalHeight = day.totalMl / maxScale * availableHeight;
            const breastmilkHeight = day.breastmilkMl / maxScale * availableHeight;
            const formulaHeight = day.formulaMl / maxScale * availableHeight;
            const expectedY = day.expectedMl == null ? null : baseline - day.expectedMl / maxScale * availableHeight;
            return (
              <g key={day.date}>
                <title>{`${day.date}: ${day.totalMl} ml total, ${day.breastmilkMl} ml breastmilk, ${day.formulaMl} ml formula${day.expectedMl == null ? "" : `, ${day.expectedMl} ml expected`}`}</title>
                {formulaHeight > 0 && (
                  <rect
                    x={x}
                    y={baseline - totalHeight}
                    width={barWidth}
                    height={formulaHeight}
                    rx="3"
                    fill="var(--color-info)"
                  />
                )}
                {breastmilkHeight > 0 && (
                  <rect
                    x={x}
                    y={baseline - breastmilkHeight}
                    width={barWidth}
                    height={breastmilkHeight}
                    rx="3"
                    fill="var(--color-terracotta)"
                  />
                )}
                {expectedY != null && (
                  <line
                    x1={x - 3}
                    y1={expectedY}
                    x2={x + barWidth + 3}
                    y2={expectedY}
                    stroke="var(--color-warning)"
                    strokeWidth="2"
                    strokeLinecap="round"
                  />
                )}
                <text
                  x={x + barWidth / 2}
                  y={Math.max(14, baseline - totalHeight - 7)}
                  textAnchor="middle"
                  fontSize="11"
                  fill="var(--color-warm-brown)"
                >
                  {day.totalMl}
                </text>
                <text
                  x={x + barWidth / 2}
                  y={baseline + 22}
                  textAnchor="middle"
                  fontSize="11"
                  fill="var(--color-text-muted)"
                >
                  {day.date.slice(5).replace("-", "/")}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </figure>
  );
}

export function MilkAsOfHistoryChart({
  days,
  isLoading,
}: {
  days: MilkDaySummary[];
  isLoading: boolean;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const latestDate = days[days.length - 1]?.date;

  // Start scrolled to the latest day: apply before first paint, then re-apply
  // after paint in case the scrollable layout settles late (iOS Safari can
  // ignore scrollLeft set in a post-paint effect).
  useLayoutEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    container.scrollLeft = container.scrollWidth;
    const frame = window.requestAnimationFrame(() => {
      container.scrollLeft = container.scrollWidth;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [days.length, latestDate]);

  if (isLoading) {
    return <p className="py-10 text-center text-sm text-muted">Loading comparison…</p>;
  }

  if (days.length === 0) {
    return <p className="py-10 text-center text-sm text-muted">No milk consumption data yet.</p>;
  }

  const height = 210;
  const baseline = 164;
  const topPadding = 28;
  const step = 58;
  const width = Math.max(300, days.length * step + 40);
  const maxScale = Math.max(...days.map((day) => day.asOfNowMl), 1);
  const availableHeight = baseline - topPadding;
  const points = days.map((day, index) => {
    const x = 28 + index * step;
    const y = baseline - day.asOfNowMl / maxScale * availableHeight;
    return { day, x, y };
  });

  return (
    <figure className="mt-4">
      <div ref={scrollRef} className="overflow-x-auto overscroll-x-contain border-y border-border py-3 touch-pan-x">
        <svg
          role="img"
          aria-label="Milk consumed by the current time each day, including today"
          className="block min-w-full"
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
        >
          <line x1="0" y1={baseline} x2={width} y2={baseline} stroke="var(--color-border)" />
          <line
            x1="0"
            y1={baseline - availableHeight / 2}
            x2={width}
            y2={baseline - availableHeight / 2}
            stroke="var(--color-border)"
            strokeDasharray="3 5"
          />
          <polyline
            points={points.map((point) => `${point.x},${point.y}`).join(" ")}
            fill="none"
            stroke="var(--color-info)"
            strokeWidth="3"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          {points.map(({ day, x, y }) => (
            <g key={day.date}>
              <title>{`${day.date}: ${day.asOfNowMl} ml consumed by this time`}</title>
              <circle cx={x} cy={y} r="5" fill="var(--color-terracotta)" stroke="var(--color-surface)" strokeWidth="2" />
              <text
                x={x}
                y={Math.max(14, y - 10)}
                textAnchor="middle"
                fontSize="11"
                fill="var(--color-warm-brown)"
              >
                {day.asOfNowMl}
              </text>
              <text
                x={x}
                y={baseline + 22}
                textAnchor="middle"
                fontSize="11"
                fill="var(--color-text-muted)"
              >
                {day.date.slice(5).replace("-", "/")}
              </text>
            </g>
          ))}
        </svg>
      </div>
    </figure>
  );
}
