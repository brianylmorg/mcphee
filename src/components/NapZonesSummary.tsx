"use client";

import { useState } from "react";
import type { NapZone, NapZones } from "@/lib/sleep-windows";
import { LAST_NAP_INDEX, zoneConfidence } from "@/lib/sleep-windows";
import { formatElapsedDuration } from "@/lib/elapsed-time";

type View = "usual" | "sick";
type Props = {
  normal: NapZones;
  sick: NapZones;
  normalNaps: Partial<Record<number, NapZone>>;
  sickNaps: Partial<Record<number, NapZone>>;
  initialView: View;
  ageGuide: { fromMs: number; toMs: number } | null;
  ageLabel: string | null;
};

function ordinal(index: number): string {
  return index === 1 ? "1st" : index === 2 ? "2nd" : index === 3 ? "3rd" : `${index}th`;
}

function clock(minute: number): string {
  const rounded = Math.round(minute / 15) * 15;
  const wrapped = ((rounded % 1440) + 1440) % 1440;
  return `${String(Math.floor(wrapped / 60)).padStart(2, "0")}:${String(wrapped % 60).padStart(2, "0")}`;
}

function ZoneRow({ label, zone }: { label: string; zone: NapZone }) {
  return <div className="grid grid-cols-[auto_1fr] items-start gap-3 border-b border-border/60 py-1.5 last:border-b-0">
    <dt className="whitespace-nowrap text-warm-brown">{label}</dt>
    <dd className="text-right tabular-nums">{formatElapsedDuration(zone.fromMs)} – {formatElapsedDuration(zone.toMs)}<div className="text-xs text-muted"><span className="whitespace-nowrap">~{clock(zone.startMinute)}–{clock(zone.endMinute)}</span> · <span className="whitespace-nowrap">typical {formatElapsedDuration(zone.medianMs)}</span> · <span className="whitespace-nowrap">{zoneConfidence(zone)}% confidence</span></div></dd>
  </div>;
}

function Rows({ rows }: { rows: { label: string; zone: NapZone }[] }) {
  return rows.length ? <dl>{rows.map(({ label, zone }) => <ZoneRow key={label} label={label} zone={zone} />)}</dl> : <p className="text-sm text-muted">Not enough yet: a range needs at least 3 at that point in the day.</p>;
}

export function NapZonesSummary({ normal, sick, normalNaps, sickNaps, initialView, ageGuide, ageLabel }: Props) {
  const hasSick = Object.values(sick.nap).some(Boolean) || Boolean(sick.bedtime) || Object.values(sickNaps).some(Boolean);
  const [view, setView] = useState<View>(initialView);
  const selected: View = hasSick ? view : "usual";
  const zones = selected === "sick" ? sick : normal;
  const naps = selected === "sick" ? sickNaps : normalNaps;
  const awakeRows: { label: string; zone: NapZone }[] = [];
  for (let index = 1; index <= LAST_NAP_INDEX; index += 1) {
    const zone = zones.nap[index];
    if (zone) awakeRows.push({ label: `${ordinal(index)}${index === LAST_NAP_INDEX ? "+" : ""} wake window${index === LAST_NAP_INDEX ? "s" : ""}`, zone });
  }
  if (zones.bedtime) awakeRows.push({ label: "Before bed", zone: zones.bedtime });
  const napRows: { label: string; zone: NapZone }[] = [];
  for (let index = 1; index <= LAST_NAP_INDEX; index += 1) {
    const zone = naps[index];
    if (zone) napRows.push({ label: `${ordinal(index)}${index === LAST_NAP_INDEX ? "+" : ""} nap${index === LAST_NAP_INDEX ? "s" : ""}`, zone });
  }
  return <div className="text-sm">
    {hasSick ? <div role="radiogroup" aria-label="Which days" className="inline-flex rounded-lg border border-border bg-surface-muted p-0.5 text-xs font-semibold">
      {(["usual", "sick"] as const).map(option => <button key={option} type="button" role="radio" aria-checked={selected === option} onClick={() => setView(option)} className={`min-h-8 rounded-md px-3 ${selected === option ? "bg-surface text-warm-brown shadow-sm" : "text-muted"}`}>{option === "usual" ? "Usual days" : "Sick days"}</button>)}
    </div> : null}
    <h4 className="mt-3 mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Awake</h4>
    <Rows rows={awakeRows} />
    {selected === "usual" && ageGuide ? <dl><div className="grid grid-cols-[auto_1fr] items-start gap-3 border-b border-border/60 py-1.5 last:border-b-0"><dt className="whitespace-nowrap text-warm-brown">Age guide{ageLabel ? ` (${ageLabel})` : ""}</dt><dd className="text-right tabular-nums">{formatElapsedDuration(ageGuide.fromMs)} – {formatElapsedDuration(ageGuide.toMs)}<div className="text-xs text-muted">from common wake-window charts</div></dd></div></dl> : null}
    <h4 className="mt-3 mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Naps</h4>
    <Rows rows={napRows} />
    <p className="mt-3 text-xs text-muted">Ranges are the middle half of his recent stretches at that point in the day; times are when they usually start and end, rounded to 15 minutes. Confidence rises with how many stretches there are, how recent they are and how steady he&apos;s been. From the last 14 days, or further back when there are too few; sick days are counted separately. The age guide is a rough comparison only.</p>
  </div>;
}
