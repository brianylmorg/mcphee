import type { ReactNode } from "react";
import { ArrowRight } from "lucide-react";

type CaretakerReviewOverviewProps = {
  date: string;
  entrySummary: string;
  attentionCount: number;
  breastmilkMl: number;
  onCare: () => void;
  onEntries: () => void;
  onApproval: () => void;
};

export default function CaretakerReviewOverview({
  date,
  entrySummary,
  attentionCount,
  breastmilkMl,
  onCare,
  onEntries,
  onApproval,
}: CaretakerReviewOverviewProps) {
  const steps: { title: string; detail: ReactNode; onSelect: () => void }[] = [
    { title: "1. Care hours", detail: "Confirm the start and end", onSelect: onCare },
    {
      title: "2. Entries",
      detail: (
        <>
          {entrySummary}
          {attentionCount > 0 && (
            <span className="text-amber-600"> · {attentionCount} need checking</span>
          )}
        </>
      ),
      onSelect: onEntries,
    },
    { title: "3. Approve", detail: "Save the review, then import", onSelect: onApproval },
  ];

  return (
    <section className="rounded border border-border bg-surface p-3">
      <h3 className="text-sm font-semibold normal-case text-warm-brown">Check before importing</h3>
      <p className="mt-0.5 text-xs text-muted">{date} · Singapore time</p>
      <div className="mt-2 grid gap-1.5 sm:grid-cols-3">
        {steps.map((step) => (
          <button
            key={step.title}
            type="button"
            onClick={step.onSelect}
            aria-label={step.title}
            className="flex items-center justify-between gap-1.5 rounded border border-border bg-surface-muted px-2.5 py-1.5 text-left text-xs hover:border-accent-strong"
          >
            <span className="min-w-0">
              <span className="block font-medium text-warm-brown">{step.title}</span>
              <span className="block text-muted">{step.detail}</span>
            </span>
            <ArrowRight className="h-3.5 w-3.5 shrink-0 text-terracotta" aria-hidden="true" />
          </button>
        ))}
      </div>
      {breastmilkMl > 0 && (
        <p className="mt-2 text-xs text-accent-strong">
          {breastmilkMl} ml will come from the breastmilk bank.
        </p>
      )}
    </section>
  );
}
