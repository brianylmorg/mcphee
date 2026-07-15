"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
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
      const history = (measurementData.measurements || []) as Measurement[];
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
    const width = Math.max(360, leftPad + rightPad + Math.max(1, measurements.length - 1) * pointGap);

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
      path: points.map((point) => `${point.x},${point.y}`).join(" "),
      top,
      bottom,
    };
  }, [baby?.birth_date, measurements]);

  const selectedPoint = chart.points.find((point) => point.id === selectedId) ?? chart.points[chart.points.length - 1] ?? null;
  const latestWeight = measurements[measurements.length - 1]?.weight_g ?? null;

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

  if (isLoading) {
    return (
      <main className="min-h-screen bg-cream flex items-center justify-center">
        <p className="text-warm-brown-light">Loading weight history...</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-cream pb-24">
      <header className="bg-white border-b border-warm-brown-light/10 px-6 py-4">
        <div className="max-w-lg mx-auto flex items-center justify-between gap-4">
          <div>
            <Link href="/dashboard" className="text-xs text-terracotta">← Dashboard</Link>
            <h1 className="font-display text-2xl text-terracotta mt-1">Weight details</h1>
            <p className="text-sm text-warm-brown-light">
              {baby?.name || "Baby"}{latestWeight ? ` · ${formatWeight(Number(latestWeight))}` : ""}
            </p>
          </div>
        </div>
      </header>

      <div className="max-w-lg mx-auto px-6 py-6 space-y-4">
        <form onSubmit={saveWeight} className="bg-white rounded-2xl border border-terracotta/20 p-5 shadow-sm space-y-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-warm-brown-light/50">Update weight</p>
            <h2 className="font-display text-lg text-terracotta mt-1">Add dated measurement</h2>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="space-y-1">
              <span className="text-xs text-warm-brown-light">Weight, kg</span>
              <input
                type="number"
                step="0.001"
                min="0"
                value={weightKg}
                onChange={(event) => setWeightKg(event.target.value)}
                placeholder="6.300"
                className="w-full rounded-xl border border-warm-brown-light/20 bg-cream px-3 py-2 text-warm-brown outline-none focus:border-terracotta"
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs text-warm-brown-light">As of date</span>
              <input
                type="date"
                value={measuredDate}
                onChange={(event) => setMeasuredDate(event.target.value)}
                className="w-full rounded-xl border border-warm-brown-light/20 bg-cream px-3 py-2 text-warm-brown outline-none focus:border-terracotta"
              />
            </label>
          </div>
          <button
            type="submit"
            disabled={isSaving || !baby?.id}
            className="w-full rounded-xl bg-terracotta px-4 py-3 text-sm font-semibold text-white disabled:opacity-50"
          >
            {isSaving ? "Saving..." : "Save weight"}
          </button>
        </form>

        <section className="bg-white rounded-2xl border border-terracotta/20 p-5 shadow-sm">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-warm-brown-light/50">WHO boys standard</p>
              <h2 className="font-display text-lg text-terracotta mt-1">Weight history</h2>
            </div>
            <span className="text-xs bg-cream text-warm-brown-light px-2 py-1 rounded-full">
              Scroll →
            </span>
          </div>

          {chart.points.length === 0 ? (
            <p className="mt-4 text-sm text-warm-brown-light">No weights logged yet.</p>
          ) : (
            <>
              <div className="mt-4 overflow-x-auto rounded-xl bg-cream p-3">
                <svg width={chart.width} height={chart.height} role="img" aria-label="Baby weight history line chart">
                  <line x1="0" y1="196" x2={chart.width} y2="196" stroke="rgba(96, 70, 54, 0.18)" />
                  <polyline fill="none" stroke="#C4785A" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" points={chart.path} />
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
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") setSelectedId(point.id);
                        }}
                        aria-label={`${formatWeight(Number(point.weight_g))} on ${formatDate(Number(point.measured_at))}`}
                      />
                      <circle cx={point.x} cy={point.y} r={point.id === selectedPoint?.id ? "6" : "4"} fill={point.id === selectedPoint?.id ? "#8B4A34" : "#C4785A"} />
                      <text x={point.x} y="214" textAnchor="middle" fontSize="10" fill="rgba(96, 70, 54, 0.58)">
                        {sgtDateInput(Number(point.measured_at)).slice(5)}
                      </text>
                    </g>
                  ))}
                </svg>
              </div>

              {selectedPoint && (
                <div className="mt-4 rounded-xl border border-warm-brown-light/10 bg-cream px-4 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs text-warm-brown-light/60">Selected</p>
                      <p className="font-display text-2xl text-warm-brown tabular-nums">
                        {formatWeight(Number(selectedPoint.weight_g))}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-warm-brown-light/60">{formatDate(Number(selectedPoint.measured_at))}</p>
                      <p className="font-medium text-terracotta">{percentileLabel(selectedPoint.percentile)}</p>
                    </div>
                  </div>
                  <p className="mt-2 text-xs text-warm-brown-light/60">
                    Percentile uses WHO boys weight-for-age LMS standards, not an ethnicity-specific Asian standard.
                    {!baby?.birth_date ? " Add birth date to calculate percentile." : ""}
                  </p>
                </div>
              )}
            </>
          )}
        </section>
      </div>
    </main>
  );
}
