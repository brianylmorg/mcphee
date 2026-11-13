import { NIGHT_SLOT_LABELS, nightPlanTonightText, type NightPlan } from "@/lib/night-plan";

export function NightPlanSummary({ plan }: { plan: NightPlan }) {
  let headline: string;
  const active = plan.activeSlot && plan.slots[plan.activeSlot];
  const label = plan.activeSlot === "evening" ? "evening" : plan.activeSlot ? NIGHT_SLOT_LABELS[plan.activeSlot] : "";
  if (plan.status === "paused") headline = `Paused: ${plan.reason}. Feed on demand.`;
  else if (plan.status === "not-enough-data") headline = "Needs 4 logged nights.";
  else if (!plan.activeSlot) headline = "All night feeds gone";
  else if (active?.mode === "unknown") headline = `Log bottle amounts to size the ${label} feed`;
  else if (active?.mode === "locked") headline = "Weigh him to start on the 01:00 feed";
  else if (active?.mode === "settle-first") headline = `${NIGHT_SLOT_LABELS[plan.activeSlot]} feed: settle first, feed if he will not settle`;
  else headline = `Shrinking the ${label} feed`;
  const tonight = plan.status === "ready" ? nightPlanTonightText(plan) : "";
  return <div className="mb-4 text-xs text-muted tabular-nums">
    <h3 className="text-sm font-semibold text-warm-brown">Night plan</h3>
    <p className="mt-1">{headline}</p>
    {tonight ? <p className="mt-1">Tonight: {tonight}</p> : null}
    {plan.status === "ready" ? <p className="mt-1">Always feed him if he will not settle. A size drops 20 ml after two nights at or under it.</p> : null}
  </div>;
}
