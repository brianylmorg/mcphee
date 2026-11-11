import { formatBlipDuration, type NightBlipSummary } from "@/lib/sleep-blips";

type Props = { nights: NightBlipSummary[] };

function headline(nights: NightBlipSummary[]): string | null {
  const completed = nights.filter((night) => night.endedAt != null);
  if (completed.length === 0) return null;
  const average = (rows: NightBlipSummary[]) => rows.reduce((sum, night) => sum + night.blipCount, 0) / rows.length;
  const format = (value: number) => value.toFixed(1);
  if (completed.length < 6) {
    return completed.length === 1
      ? `Last night: ${completed[0].blipCount} ${completed[0].blipCount === 1 ? "blip" : "blips"}.`
      : `Last ${completed.length} nights: ${format(average(completed))} blips a night.`;
  }
  const recent = average(completed.slice(0, 3));
  const previous = average(completed.slice(3, 6));
  const direction = recent < previous ? "down from" : recent > previous ? "up from" : "same as";
  return `Last 3 nights: ${format(recent)} blips a night, ${direction} ${format(previous)}.`;
}

function nightLabel(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  return new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" })
    .format(new Date(Date.UTC(year, month - 1, day)));
}

function NightRow({ night }: { night: NightBlipSummary }) {
  const details = [
    night.longestStretchMs > 0 ? `longest ${formatBlipDuration(night.longestStretchMs)} asleep` : null,
    night.blipCount > 0 && night.selfSettled > 0 ? `${night.selfSettled} settled himself` : null,
    night.settledByUs > 0 ? `${night.settledByUs} by us` : null,
    night.becameWake > 0 ? `${night.becameWake} woke` : null,
    night.wakeCount > 0 ? `${night.wakeCount} ${night.wakeCount === 1 ? "wake" : "wakes"}` : null,
  ].filter((part): part is string => part !== null);
  const count = `${night.blipCount} ${night.blipCount === 1 ? "blip" : "blips"}`;
  return <div className="grid grid-cols-[auto_1fr] items-start gap-3 border-b border-border/60 py-1.5 last:border-b-0">
    <dt className="whitespace-nowrap text-warm-brown">{nightLabel(night.date)}{night.endedAt == null ? " · tonight" : ""}</dt>
    <dd className="text-right tabular-nums">{count}{night.blipCount > 0 ? ` · ${formatBlipDuration(night.blipMs)}` : ""}{details.length ? <div className="text-xs text-muted">{details.map((part, index) => <span key={part}>{index ? " · " : ""}<span className="whitespace-nowrap">{part}</span></span>)}</div> : null}</dd>
  </div>;
}

export function NightBlipsSummary({ nights }: Props) {
  const summary = headline(nights);
  return <div className="text-sm">
    <h3 className="text-sm font-semibold text-warm-brown">Night blips</h3>
    {nights.length === 0 ? <p className="mt-1 text-xs text-muted">No nights logged yet.</p> : <>
      {summary ? <p className="mt-1 text-xs text-muted">{summary}</p> : null}
      <dl className="mt-2">{nights.map((night) => <NightRow key={night.date} night={night} />)}</dl>
      <ul className="mt-2 list-disc pl-4 text-xs text-muted">
        <li>A night is every sleep from 18:00 to 07:00.</li>
        <li>A blip is crying in his sleep that you marked from the sleep card.</li>
        <li>Longest asleep is the longest stretch with no blip and no wake.</li>
      </ul>
    </>}
  </div>;
}
