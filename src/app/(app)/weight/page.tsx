"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ChevronRight, Plus, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useHousehold } from "@/lib/context/household-context";
import { sg2000MaxAgeMonths } from "@/lib/growth/percentile";
import { buildWeightChart, weighInRows, type WeighInRow } from "@/lib/growth/weight-chart";
import { formatAge, formatDate, formatWeight } from "@/lib/utils";

type Baby = { id: string; name: string; birth_date: number | null };
type Measurement = {
  id: string;
  baby_id: string;
  measured_at: number;
  weight_g: number | null;
};

/** The add / edit sheet: a new weigh-in, or an existing one being corrected. */
type Editor = { mode: "add" } | { mode: "edit"; row: WeighInRow };

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

function ordinal(value: number) {
  const n = Math.round(value);
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th"}`;
}

function percentileLabel(value: number | null) {
  if (value == null) return null;
  if (value < 1) return "below 1st percentile";
  if (value > 99) return "above 99th percentile";
  return `${ordinal(value)} percentile`;
}

function deltaLabel(row: WeighInRow) {
  if (row.deltaG == null || row.deltaDays == null) return null;
  const sign = row.deltaG > 0 ? "+" : row.deltaG < 0 ? "−" : "±";
  const days = row.deltaDays === 1 ? "1 day" : `${row.deltaDays} days`;
  return `${sign}${Math.abs(row.deltaG)} g in ${days}`;
}

function axisKg(weightG: number) {
  const kg = weightG / 1000;
  return Number.isInteger(kg) ? String(kg) : kg.toFixed(1);
}

const fieldClass = "min-h-11 w-full rounded-lg border border-border bg-cream px-3 py-2 text-warm-brown outline-none focus:border-accent-strong focus-visible:ring-2 focus-visible:ring-terracotta/40";

export default function WeightPage() {
  const { householdId } = useHousehold();
  const router = useRouter();
  const [baby, setBaby] = useState<Baby | null>(null);
  const [measurements, setMeasurements] = useState<Measurement[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [weightKg, setWeightKg] = useState("");
  const [measuredDate, setMeasuredDate] = useState(() => sgtDateInput(Date.now()));
  const [isSaving, setIsSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<WeighInRow | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const chartScrollRef = useRef<HTMLDivElement>(null);
  const [plotWidth, setPlotWidth] = useState(0);

  const fetchData = useCallback(async () => {
    if (!householdId) return;
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
      const measurementRes = await fetch(`/api/measurements?babyId=${encodeURIComponent(firstBaby.id)}&history=1`, { cache: "no-store" });
      if (!measurementRes.ok) throw new Error("Failed to load weights");
      const measurementData = await measurementRes.json();
      setMeasurements(((measurementData.measurements || []) as Measurement[]).filter((item) => item.weight_g != null));
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
    void fetchData();
  }, [fetchData, householdId, router]);

  const birthDate = baby?.birth_date ? Number(baby.birth_date) : null;
  const rows = useMemo(() => weighInRows(
    measurements.map((item) => ({ id: item.id, measuredAt: Number(item.measured_at), weightG: Number(item.weight_g) })),
    birthDate,
  ), [measurements, birthDate]);
  const latest = rows[rows.length - 1] ?? null;
  const hasRows = rows.length > 0;

  useLayoutEffect(() => {
    const container = chartScrollRef.current;
    if (!container) return;
    const update = () => setPlotWidth(container.clientWidth);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(container);
    return () => observer.disconnect();
  }, [hasRows]);

  const chart = useMemo(() => buildWeightChart(rows, birthDate, plotWidth || 300), [rows, birthDate, plotWidth]);

  // Open on the latest weigh-in, at the right; older history scrolls left.
  useLayoutEffect(() => {
    const container = chartScrollRef.current;
    if (!container) return;
    const align = () => { container.scrollLeft = container.scrollWidth; };
    align();
    const frame = window.requestAnimationFrame(align);
    return () => window.cancelAnimationFrame(frame);
  }, [chart.width]);

  const openAdd = () => {
    setEditor({ mode: "add" });
    setWeightKg("");
    setMeasuredDate(sgtDateInput(Date.now()));
    setFormError(null);
  };
  const openEdit = (row: WeighInRow) => {
    setEditor({ mode: "edit", row });
    setWeightKg((row.weightG / 1000).toFixed(3).replace(/0+$/, "").replace(/\.$/, ""));
    setMeasuredDate(sgtDateInput(row.measuredAt));
    setFormError(null);
  };

  async function saveWeight(event: React.FormEvent) {
    event.preventDefault();
    if (!baby?.id || !editor) return;
    const kg = Number(weightKg);
    const measuredAt = parseSgtDate(measuredDate);
    if (!Number.isFinite(kg) || kg <= 0 || kg > 40 || !Number.isFinite(measuredAt)) {
      setFormError("Enter a weight in kg and a date.");
      return;
    }
    setIsSaving(true);
    setFormError(null);
    try {
      const weightG = Math.round(kg * 1000);
      const res = editor.mode === "add"
        ? await fetch("/api/measurements", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ babyId: baby.id, measuredAt, weightG }),
        })
        : await fetch("/api/measurements", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: editor.row.id, measuredAt, weightG }),
        });
      if (!res.ok) throw new Error("save failed");
      setEditor(null);
      await fetchData();
    } catch {
      setFormError("Could not save this weight. Try again.");
    } finally {
      setIsSaving(false);
    }
  }

  async function deleteWeighIn() {
    if (!confirmDelete) return;
    setIsDeleting(true);
    try {
      const res = await fetch(`/api/measurements?id=${encodeURIComponent(confirmDelete.id)}`, { method: "DELETE" });
      if (!res.ok) throw new Error("delete failed");
      setMeasurements((current) => current.filter((item) => item.id !== confirmDelete.id));
      setConfirmDelete(null);
      setEditor(null);
    } catch {
      setFormError("Could not delete this weight. Try again.");
      setConfirmDelete(null);
    } finally {
      setIsDeleting(false);
    }
  }

  if (isLoading) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-cream">
        <p className="text-warm-brown-light">Loading weight history…</p>
      </main>
    );
  }

  const latestPercentile = latest ? percentileLabel(latest.percentile) : null;
  const latestDelta = latest ? deltaLabel(latest) : null;
  const beyondReference = latest?.ageMonths != null && latest.ageMonths > sg2000MaxAgeMonths();

  return (
    <main className="min-h-dvh bg-cream pb-[calc(6rem+env(safe-area-inset-bottom))]">
      <header className="border-b border-border bg-surface px-4 py-2">
        <div className="mx-auto flex max-w-lg items-center gap-2">
          <Link href="/dashboard" aria-label="Back to dashboard" className="-ml-2 flex h-11 w-11 items-center justify-center rounded-full text-accent-strong hover:bg-surface-muted">
            <ArrowLeft aria-hidden="true" className="h-5 w-5" />
          </Link>
          <h1 className="font-display text-xl font-semibold text-accent-strong">{baby?.name ? `${baby.name}’s weight` : "Weight"}</h1>
        </div>
      </header>

      <div className="mx-auto max-w-lg space-y-3 px-3 py-3 sm:px-5">
        {/* Summary: the answer first */}
        <section aria-label="Latest weight" className="rounded-xl border border-border bg-surface p-4 shadow-sm">
          {latest ? (
            <>
              <p className="text-xs text-muted">Latest · {formatDate(latest.measuredAt)}{birthDate ? ` · ${formatAge(birthDate)}` : ""}</p>
              <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <p className="font-display text-4xl font-semibold tabular-nums text-warm-brown">{formatWeight(latest.weightG)}</p>
                {latestPercentile && (
                  <span className="rounded-full bg-terracotta/10 px-2.5 py-0.5 text-sm font-semibold text-accent-strong">{latestPercentile}</span>
                )}
              </div>
              {latestDelta && <p className="mt-1 text-sm tabular-nums text-warm-brown-light">{latestDelta} since the last weigh-in</p>}
            </>
          ) : (
            <p className="text-sm text-warm-brown-light">No weights yet. Add the first weigh-in to start the growth chart.</p>
          )}
          <button
            type="button"
            onClick={openAdd}
            disabled={!baby?.id}
            className="mt-3 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-terracotta-dark px-4 text-sm font-semibold text-on-accent transition-colors hover:bg-warm-brown disabled:opacity-50"
          >
            <Plus aria-hidden="true" className="h-4 w-4" />
            Add weight
          </button>
        </section>

        {/* Growth chart on a true time axis with SG 2000 bands */}
        {hasRows && (
          <section aria-labelledby="growth-title" className="rounded-xl border border-border bg-surface p-4 shadow-sm">
            <div className="flex items-baseline justify-between gap-3">
              <h2 id="growth-title" className="glance-card-title text-accent-strong">Growth</h2>
              {chart.bands.length > 0 && (
                <span className="flex items-center gap-3 text-[11px] text-muted">
                  <span className="inline-flex items-center gap-1"><span className="h-2.5 w-3 rounded-sm bg-success/20" />3rd–97th</span>
                  <span className="inline-flex items-center gap-1"><span className="h-px w-3 border-t border-dashed border-muted" />50th</span>
                </span>
              )}
            </div>
            <div className="mt-3 flex">
              <div className="relative w-8 shrink-0" style={{ height: chart.height }} aria-hidden="true">
                {chart.gridLines.map((line) => (
                  <span key={line.weightG} className="absolute right-1 -translate-y-1/2 text-[10px] leading-none tabular-nums text-muted" style={{ top: line.y }}>
                    {axisKg(line.weightG)}
                  </span>
                ))}
              </div>
              <div ref={chartScrollRef} className="min-w-0 flex-1 overflow-x-auto overscroll-x-contain touch-pan-x">
                <svg
                  className="block max-w-none"
                  width={chart.width}
                  height={chart.height}
                  viewBox={`0 0 ${chart.width} ${chart.height}`}
                  role="img"
                  aria-label={`Weight over time${chart.bands.length ? " against Singapore 2000 percentile bands" : ""}`}
                >
                  {chart.gridLines.map((line) => (
                    <line key={line.weightG} x1="0" y1={line.y} x2={chart.width} y2={line.y} stroke="rgb(var(--rgb-text))" strokeOpacity="0.07" />
                  ))}
                  {chart.bands.map((band, index) => (
                    <path key={`${band.lower}-${band.upper}`} d={band.d} fill="rgb(var(--rgb-success))" fillOpacity={0.07 + index * 0.05} />
                  ))}
                  {chart.median && (
                    <polyline points={chart.median} fill="none" stroke="rgb(var(--rgb-text-muted))" strokeOpacity="0.55" strokeWidth="1.2" strokeDasharray="4 4" />
                  )}
                  {chart.monthTicks.map((tick) => (
                    <g key={tick.x}>
                      <line x1={tick.x} y1={chart.plotTop} x2={tick.x} y2={chart.plotBottom} stroke="rgb(var(--rgb-text))" strokeOpacity="0.06" />
                      <text x={tick.x + 3} y={chart.height - 8} fontSize="11" fill="rgb(var(--rgb-text-muted))">{tick.label}</text>
                    </g>
                  ))}
                  <line x1="0" y1={chart.plotBottom} x2={chart.width} y2={chart.plotBottom} stroke="rgb(var(--rgb-text))" strokeOpacity="0.15" />
                  <polyline points={chart.line} fill="none" stroke="rgb(var(--rgb-accent))" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                  {chart.points.map((point, index) => (
                    <g key={point.id}>
                      <circle
                        cx={point.x}
                        cy={point.y}
                        r="14"
                        fill="transparent"
                        role="button"
                        tabIndex={0}
                        className="cursor-pointer outline-none"
                        aria-label={`Edit ${formatWeight(point.weightG)} on ${formatDate(point.measuredAt)}`}
                        onClick={() => openEdit(point)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            openEdit(point);
                          }
                        }}
                      />
                      <circle
                        cx={point.x}
                        cy={point.y}
                        r={index === chart.points.length - 1 ? 5.5 : 4}
                        fill={index === chart.points.length - 1 ? "rgb(var(--rgb-accent-strong))" : "rgb(var(--rgb-accent))"}
                        stroke="rgb(var(--rgb-surface))"
                        strokeWidth="1.5"
                        pointerEvents="none"
                      />
                    </g>
                  ))}
                </svg>
              </div>
            </div>
            <p className="mt-2 text-xs text-muted">
              {birthDate
                ? beyondReference
                  ? "Percentile bands cover birth to 24 months (Singapore 2000 reference)."
                  : "Bands use the Singapore 2000 reference (NHG Polyclinics), the same charts as the Child Health Booklet."
                : "Add a birth date in baby settings to see percentiles and bands."}
            </p>
          </section>
        )}

        {/* Every weigh-in; tap to correct or delete */}
        {hasRows && (
          <section aria-labelledby="weighins-title" className="rounded-xl border border-border bg-surface px-4 pb-1 pt-4 shadow-sm">
            <h2 id="weighins-title" className="glance-card-title text-accent-strong">Weigh-ins</h2>
            <ul className="mt-1">
              {[...rows].reverse().map((row) => {
                const percentile = percentileLabel(row.percentile);
                const delta = deltaLabel(row);
                return (
                  <li key={row.id} className="border-b border-border/70 last:border-b-0">
                    <button type="button" onClick={() => openEdit(row)} aria-label={`Edit ${formatWeight(row.weightG)} on ${formatDate(row.measuredAt)}`} className="flex w-full items-center gap-3 rounded-md px-1 py-2.5 text-left transition-colors hover:bg-surface-muted/60">
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium text-warm-brown">{formatDate(row.measuredAt)}</span>
                        <span className="block text-xs text-muted">
                          {[delta, percentile].filter(Boolean).join(" · ") || "First weigh-in"}
                        </span>
                      </span>
                      <span className="font-display text-lg font-semibold tabular-nums text-warm-brown">{formatWeight(row.weightG)}</span>
                      <ChevronRight aria-hidden="true" className="h-4 w-4 shrink-0 text-muted" />
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        )}
      </div>

      {/* Add / edit sheet */}
      {editor && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-warm-brown/55 px-4 pb-4 sm:items-center sm:pb-0"
          role="dialog"
          aria-modal="true"
          aria-labelledby="weight-editor-title"
          onClick={(event) => { if (event.target === event.currentTarget && !isSaving) setEditor(null); }}
          onKeyDown={(event) => { if (event.key === "Escape" && !isSaving) setEditor(null); }}
        >
          <form onSubmit={saveWeight} className="w-full max-w-sm rounded-xl bg-surface p-5 shadow-xl">
            <div className="flex items-center justify-between gap-3">
              <h2 id="weight-editor-title" className="font-display text-xl text-warm-brown">{editor.mode === "add" ? "Add weight" : "Edit weigh-in"}</h2>
              <button type="button" aria-label="Close" onClick={() => setEditor(null)} disabled={isSaving} className="-mr-2 flex h-11 w-11 items-center justify-center rounded-full text-muted hover:bg-surface-muted">
                <X aria-hidden="true" className="h-5 w-5" />
              </button>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <label className="space-y-1">
                <span className="text-xs text-warm-brown-light">Weight (kg)</span>
                <input
                  autoFocus
                  type="number"
                  inputMode="decimal"
                  step="0.001"
                  min="0"
                  value={weightKg}
                  onChange={(event) => setWeightKg(event.target.value)}
                  placeholder={latest ? (latest.weightG / 1000).toFixed(2) : "6.30"}
                  className={`${fieldClass} text-lg tabular-nums`}
                />
              </label>
              <label className="space-y-1">
                <span className="text-xs text-warm-brown-light">Date</span>
                <input type="date" value={measuredDate} max={sgtDateInput(Date.now())} onChange={(event) => setMeasuredDate(event.target.value)} className={fieldClass} />
              </label>
            </div>
            {formError && <p role="alert" className="mt-2 text-sm text-danger">{formError}</p>}
            <button type="submit" disabled={isSaving} className="mt-4 min-h-11 w-full rounded-lg bg-terracotta-dark px-4 text-sm font-semibold text-on-accent transition-colors hover:bg-warm-brown disabled:opacity-50">
              {isSaving ? "Saving…" : editor.mode === "add" ? "Save weight" : "Save changes"}
            </button>
            {editor.mode === "edit" && (
              <button type="button" onClick={() => setConfirmDelete(editor.row)} disabled={isSaving} className="mt-2 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg text-sm font-semibold text-danger transition-colors hover:bg-danger/10 disabled:opacity-50">
                <Trash2 aria-hidden="true" className="h-4 w-4" />
                Delete weigh-in
              </button>
            )}
          </form>
        </div>
      )}

      {confirmDelete && (
        <div className="fixed inset-0 z-[60] flex items-end justify-center bg-warm-brown/55 px-4 pb-4 sm:items-center sm:pb-0" role="dialog" aria-modal="true" aria-labelledby="delete-weight-title">
          <div className="w-full max-w-sm rounded-xl bg-surface p-5 shadow-xl">
            <h2 id="delete-weight-title" className="font-display text-xl text-warm-brown">Delete this weigh-in?</h2>
            <p className="mt-2 text-sm leading-relaxed text-warm-brown-light">
              {formatWeight(confirmDelete.weightG)} from {formatDate(confirmDelete.measuredAt)} will be permanently removed.
            </p>
            <div className="mt-5 grid grid-cols-2 gap-2">
              <button type="button" onClick={() => setConfirmDelete(null)} autoFocus disabled={isDeleting} className="min-h-11 rounded-lg border border-border bg-surface px-4 text-sm font-semibold text-warm-brown disabled:opacity-50">Cancel</button>
              <button type="button" onClick={() => { void deleteWeighIn(); }} disabled={isDeleting} className="min-h-11 rounded-lg bg-danger px-4 text-sm font-semibold text-on-accent disabled:opacity-50">{isDeleting ? "Deleting…" : "Delete"}</button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
