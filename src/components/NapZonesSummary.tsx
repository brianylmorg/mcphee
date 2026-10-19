import type { NapZone, NapZones } from "@/lib/sleep-windows";
import { LAST_NAP_INDEX } from "@/lib/sleep-windows";
import { formatElapsedDuration } from "@/lib/elapsed-time";

type Props = { normal: NapZones; sick: NapZones; ageGuide: { fromMs: number; toMs: number } | null; ageLabel: string | null };

function ordinal(index: number): string {
  return index === 1 ? "1st" : index === 2 ? "2nd" : index === 3 ? "3rd" : `${index}th`;
}

function WindowRows({ zones, ageGuide, ageLabel }: { zones: NapZones; ageGuide?: Props["ageGuide"]; ageLabel?: string | null }) {
  const rows: { key: string; label: string; zone: NapZone }[] = [];
  for (let index = 1; index <= LAST_NAP_INDEX; index += 1) {
    const zone = zones.nap[index];
    if (zone) rows.push({ key: `nap-${index}`, label: `${ordinal(index)} wake window${index === LAST_NAP_INDEX ? "s" : ""}`, zone });
  }
  if (zones.bedtime) rows.push({ key: "bedtime", label: "Before bed", zone: zones.bedtime });
  return <>
    {rows.map(({ key, label, zone }) => <div key={key} className="grid grid-cols-[1fr_auto] items-start gap-3 border-b border-border/60 py-1.5 last:border-b-0">
      <dt className="text-warm-brown">{label}</dt>
      <dd className="text-right tabular-nums">{formatElapsedDuration(zone.fromMs)} – {formatElapsedDuration(zone.toMs)}<div className="text-xs text-muted">typical {formatElapsedDuration(zone.medianMs)} · from {zone.count}</div></dd>
    </div>)}
    {ageGuide ? <div className="grid grid-cols-[1fr_auto] items-start gap-3 border-b border-border/60 py-1.5 last:border-b-0">
      <dt className="text-warm-brown">Age guide{ageLabel ? ` (${ageLabel})` : ""}</dt>
      <dd className="text-right tabular-nums">{formatElapsedDuration(ageGuide.fromMs)} – {formatElapsedDuration(ageGuide.toMs)}<div className="text-xs text-muted">from common wake-window charts</div></dd>
    </div> : null}
  </>;
}

export function NapZonesSummary({ normal, sick, ageGuide, ageLabel }: Props) {
  const hasNormal = Object.values(normal.nap).some(Boolean) || normal.bedtime != null;
  const hasSick = Object.values(sick.nap).some(Boolean) || sick.bedtime != null;
  return <div className="text-sm">
    {hasNormal ? <dl><WindowRows zones={normal} ageGuide={ageGuide} ageLabel={ageLabel} /></dl> : <><p className="text-sm text-muted">Not enough recent wake windows yet. A zone needs at least 3 from the last 14 days.</p>{ageGuide ? <dl><WindowRows zones={normal} ageGuide={ageGuide} ageLabel={ageLabel} /></dl> : null}</>}
    {hasSick ? <><h3 className="mt-3 text-xs font-semibold text-muted">On sick days</h3><dl><WindowRows zones={sick} /></dl></> : null}
    <p className="mt-2 text-xs text-muted">Zones are the middle half of his last 14 days of wake windows, with sick days left out. The age guide is a rough comparison only: sources differ by up to half an hour.</p>
  </div>;
}
