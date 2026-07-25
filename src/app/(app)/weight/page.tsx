"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useHousehold } from "@/lib/context/household-context";
import { ageMonthsAt, whoBoysWeightForAgePercentile } from "@/lib/who/percentile";
import { formatDate, formatWeight } from "@/lib/utils";

type Baby = { id: string; name: string; birth_date: number | null };
type Measurement = {
  id: string;
  baby_id: string;
  measured_at: number;
  weight_g: number | null;
};

type ChartPoint = Measurement & {
  x: number;
  y: number;
  percentile: number | null;
  ageMonths: number | null;
};

function sgtDateInput(timestamp: number) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Singapore",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(timestamp));
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "00";
  return [part("year"), part("month"), part("day")].join("-");
}

function parseSgtDate(date: string) {
  return Date.parse(date + "T12:00:00+08:00");
}

function percentileLabel(value: number | null) {
  if (value == null) return "Percentile unavailable";
  if (value < 1) return "<1st percentile";
  if (value > 99) return ">99th percentile";
  return `${Math.round(value)}th percentile`;
}

export default function WeightPage() {
  const { householdId } = useHousehold();
  const router = useRouter();
  const [baby, setBaby] = useState<Baby | null>(null);
  const [measurements, setMeasurements] = useState<Measurement[]>([]);
  const [weightKg, setWeightKg] = useState("");
  const [measuredDate, setMeasuredDate] = useState(() => sgtDateInput(Date.now()));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [deleteMeasurement, setDeleteMeasurement] = useState<Measurement | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const chartScrollRef = useRef<HTMLDivElement>(null);

  const fetchData = useCallback(async () => {
    if (!householdId) return;
    setIsLoading(true);
    try {
      const babyRes = await fetch("/api/babies", { cache: "no-store" });
      if (!babyRes.ok) throw new Error("Failed to load baby");
      const babyData = await babyRes.json();
      const firstBaby = babyData.babies?.[0] ?? null;
      setBaby(firstBaby);
      if (!firstBaby?.id) {
        setMeasurements([]);
        return;
      }

      const measurementRes = await fetch(`/api/measurements?babyId=${encodeURIComponent(firstBaby.id)}&history=1`, {
        cache: "no-store",
      });
      if (!measurementRes.ok) throw new Error("Failed to load weights");
      const measurementData = await measurementRes.json();
      const history = ((measurementData.measurements || []) as Measurement[])
        .filter((item) => item.weight_g != null);
      setMeasurements(history);
      setSelectedId((current) => current ?? history[history.length - 1]?.id ?? null);
    } catch (error) {
      console.error("Weight page fetch error:", error);
    } finally {
      setIsLoading(false);
    }
  }, [householdId]);

  useEffect(() => {
    if (!householdId) {
      router.push("/");
      return;
    }
    fetchData();
  }, [fetchData, householdId, router]);

  const chart = useMemo(() => {
    const values = measurements
      .filter((item) => item.weight_g != null)
      .map((item) => Number(item.weight_g));
    const minWeight = Math.min(...values);
    const maxWeight = Math.max(...values);
    const range = Math.max(400, maxWeight - minWeight || 400);
    const top = maxWeight + range * 0.18;
    const bottom = Math.max(0, minWeight - range * 0.18);
    const height = 220;
    const leftPad = 28;
    const rightPad = 28;
    const pointGap = 72;
    const visiblePointCount = 6;
    const viewportWidth = leftPad + rightPad + (visiblePointCount - 1) * pointGap;
    const width = Math.max(viewportWidth, leftPad + rightPad + Math.max(1, measurements.length - 1) * pointGap);

    const points: ChartPoint[] = measurements.map((item, index) => {
      const weight = Number(item.weight_g ?? 0);
      const ageMonths = baby?.birth_date ? ageMonthsAt(Number(item.measured_at), Number(baby.birth_date)) : null;
      const percentile = ageMonths == null ? null : whoBoysWeightForAgePercentile(weight, ageMonths);
      return {
        ...item,
        x: leftPad + index * pointGap,
        y: 24 + ((top - weight) / Math.max(1, top - bottom)) * (height - 48),
        percentile,
        ageMonths,
      };
    });

    return {
      points,
      width,
      height,
      viewportWidth,
      path: points.map((point) => `${point.x},${point.y}`).join(" "),
      top,
      bottom,
    };
  }, [baby?.birth_date, measurements]);

  const selectedPoint = chart.points.find((point) => point.id === selectedId) ?? chart.points[chart.points.length - 1] ?? null;
  const latestWeight = measurements[measurements.length - 1]?.weight_g ?? null;

  // Start scrolled to the latest measurement: apply before first paint, then
  // re-apply after paint in case the scrollable layout settles late (iOS
  // Safari can ignore scrollLeft set in a post-paint effect).
  useLayoutEffect(() => {
    const container = chartScrollRef.current;
    if (!container || measurements.length <= 6) return;
    container.scrollLeft = container.scrollWidth;
    const frame = window.requestAnimationFrame(() => {
      container.scrollLeft = container.scrollWidth;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [measurements.length]);

  async function saveWeight(event: React.FormEvent) {
    event.preventDefault();
    if (!baby?.id) return;
    const parsedWeightKg = Number(weightKg);
    const measuredAt = parseSgtDate(measuredDate);
    if (!Number.isFinite(parsedWeightKg) || parsedWeightKg <= 0 || !Number.isFinite(measuredAt)) {
      alert("Enter a valid weight and date.");
      return;
    }

    setIsSaving(true);
    try {
      const res = await fetch("/api/measurements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          babyId: baby.id,
          measuredAt,
          weightG: Math.round(parsedWeightKg * 1000),
        }),
      });
      if (!res.ok) throw new Error("Failed to save weight");
      setWeightKg("");
      await fetchData();
    } catch (error) {
      console.error("Save weight error:", error);
      alert("Could not save weight. Try again.");
    } finally {
      setIsSaving(false);
    }
  }

  async function confirmDeleteMeasurement() {
    if (!deleteMeasurement) return;

    setIsDeleting(true);
    try {
      const res = await fetch(`/api/measurements?id=${encodeURIComponent(deleteMeasurement.id)}`, {
        method: "DELETE",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to delete weight");

      const remaining = measurements.filter((item) => item.id !== deleteMeasurement.id);
      setMeasurements(remaining);
      setSelectedId(remaining[remaining.length - 1]?.id ?? null);
      setDeleteMeasurement(null);
    } catch (error) {
      console.error("Delete weight error:", error);
      alert(error instanceof Error ? error.message : "Could not delete weight. Try again.");
    } finally {
      setIsDeleting(false);
    }
  }

  if (isLoading) {
    return (
      <main className="min-h-dvh bg-cream flex items-center justify-center">
        <p className="text-warm-brown-light">Loading weight history…</p>
      </main>
    );
  }

  return (
    <main className="min-h-dvh bg-cream pb-24">
      <header className="bg-surface border-b border-border px-6 py-4">
        <div className="max-w-lg mx-auto flex items-center justify-between gap-4">
          <div>
            <Link href="/dashboard" className="inline-flex min-h-11 items-center gap-1.5 whitespace-nowrap text-xs font-semibold text-accent-strong"><ArrowLeft aria-hidden="true" className="h-4 w-4" />Dashboard</Link>
            <h1 className="font-display text-2xl text-accent-strong mt-1">Weight details</h1>
            <p className="text-sm text-warm-brown-light">
              {baby?.name || "Baby"}{latestWeight ? ` · ${formatWeight(Number(latestWeight))}` : ""}
            </p>
          </div>
        </div>
      </header>

      <div className="max-w-lg mx-auto px-6 py-6 space-y-4">
        <form onSubmit={saveWeight} className="bg-surface rounded-lg border border-terracotta/20 p-5 shadow-sm space-y-4">
          <div>
            <h2 className="font-display text-lg text-accent-strong mt-1">Add dated measurement</h2>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="space-y-1">
              <span className="text-xs text-warm-brown-light">Weight, kg</span>
              <input
                type="number"
                step="0.001"
                min="0"
                value={weightKg}
                onChange={(event) => setWeightKg(event.target.value)}
                placeholder="6.300"
                className="min-h-11 w-full rounded-lg border border-border bg-cream px-3 py-2 text-warm-brown outline-none focus:border-accent-strong focus-visible:ring-2 focus-visible:ring-terracotta/40 focus-visible:ring-offset-2"
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs text-warm-brown-light">As of date</span>
              <input
                type="date"
                value={measuredDate}
                onChange={(event) => setMeasuredDate(event.target.value)}
                className="min-h-11 w-full rounded-lg border border-border bg-cream px-3 py-2 text-warm-brown outline-none focus:border-accent-strong focus-visible:ring-2 focus-visible:ring-terracotta/40 focus-visible:ring-offset-2"
              />
            </label>
          </div>
          <button
            type="submit"
            disabled={isSaving || !baby?.id}
            className="min-h-11 w-full rounded-lg bg-terracotta-dark px-4 py-3 text-sm font-semibold text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-terracotta/40 focus-visible:ring-offset-2 disabled:opacity-50"
          >
            {isSaving ? "Saving…" : "Save weight"}
          </button>
        </form>

        <section className="bg-surface rounded-lg border border-terracotta/20 p-5 shadow-sm">
          <div>
            <h2 className="font-display text-lg text-accent-strong">Weight history</h2>
            <p className="mt-1 text-xs text-muted">WHO boys standard</p>
          </div>

          {chart.points.length === 0 ? (
            <p className="mt-4 text-sm text-warm-brown-light">No weights logged yet.</p>
          ) : (
            <>
              <div ref={chartScrollRef} className="mt-4 overflow-x-auto overscroll-x-contain border-y border-border py-3 touch-pan-x">
                <svg
                  className="block max-w-none"
                  style={{ width: `${Math.max(100, chart.width / chart.viewportWidth * 100)}%` }}
                  height={chart.height}
                  viewBox={`0 0 ${chart.width} ${chart.height}`}
                  role="img"
                  aria-label="Baby weight history line chart"
                >
                  <line x1="0" y1="196" x2={chart.width} y2="196" stroke="var(--color-warm-brown)" strokeOpacity="0.18" />
                  <polyline fill="none" stroke="var(--color-terracotta)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" points={chart.path} />
                  {chart.points.map((point) => (
                    <g key={point.id}>
                      <circle
                        cx={point.x}
                        cy={point.y}
                        r="16"
                        fill="transparent"
                        role="button"
                        tabIndex={0}
                        className="cursor-pointer"
                        onClick={() => setSelectedId(point.id)}
                        onFocus={() => setSelectedId(point.id)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            setSelectedId(point.id);
                          }
                        }}
                        aria-label={`${formatWeight(Number(point.weight_g))} on ${formatDate(Number(point.measured_at))}`}
                      />
                      <circle
                        cx={point.x}
                        cy={point.y}
                        r={point.id === selectedPoint?.id ? "6" : "4"}
                        fill={point.id === selectedPoint?.id ? "var(--color-warm-brown)" : "var(--color-terracotta)"}
                        pointerEvents="none"
                      />
                      <text x={point.x} y="214" textAnchor="middle" fontSize="12" fill="var(--color-text-muted)">
                        {sgtDateInput(Number(point.measured_at)).slice(5)}
                      </text>
                    </g>
                  ))}
                </svg>
              </div>

              {selectedPoint && (
                <div className="mt-4 border-t border-border pt-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs text-muted">Selected</p>
                      <p className="font-display text-2xl text-warm-brown tabular-nums">
                        {formatWeight(Number(selectedPoint.weight_g))}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-muted">{formatDate(Number(selectedPoint.measured_at))}</p>
                      <p className="font-medium text-accent-strong">{percentileLabel(selectedPoint.percentile)}</p>
                    </div>
                  </div>
                  <p className="mt-2 text-xs text-muted">
                    Percentile uses WHO boys weight-for-age LMS standards, not an ethnicity-specific Asian standard.
                    {!baby?.birth_date ? " Add birth date to calculate percentile." : ""}
                  </p>
                  <div className="mt-3 flex justify-end border-t border-border pt-3">
                    <button
                      type="button"
                      onClick={() => setDeleteMeasurement(selectedPoint)}
                      className="inline-flex min-h-11 items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold text-danger transition-colors hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-red-200"
                    >
                      <Trash2 aria-hidden="true" className="h-4 w-4" />
                      Delete measurement
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </section>
      </div>

      {deleteMeasurement && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-warm-brown/55 px-4 pb-4 sm:items-center sm:pb-0"
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-weight-title"
        >
          <div className="w-full max-w-sm rounded-lg bg-surface p-5 shadow-xl">
            <h2 id="delete-weight-title" className="font-display text-xl text-warm-brown">
              Delete this weight?
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-warm-brown-light">
              {formatWeight(Number(deleteMeasurement.weight_g))} from {formatDate(Number(deleteMeasurement.measured_at))} will be permanently removed.
            </p>
            <div className="mt-5 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setDeleteMeasurement(null)}
                autoFocus
                disabled={isDeleting}
                className="min-h-11 rounded-lg border border-border bg-surface px-4 py-3 text-sm font-semibold text-warm-brown disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmDeleteMeasurement}
                disabled={isDeleting}
                className="min-h-11 rounded-lg bg-danger px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-warm-brown disabled:opacity-50"
              >
                {isDeleting ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
