type Marker = {
  valueMl: number;
  positionPercent: number;
};

export type SickMilkProgressModel = {
  consumedMl: number;
  consumedPercent: number;
  scaleMaxMl: number;
  threshold: Marker | null;
  baseline: Marker | null;
  expected: Marker | null;
};

function positiveNumber(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function nonNegativeNumber(value: number | null | undefined): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

function position(valueMl: number, scaleMaxMl: number): number {
  return Math.round((valueMl / scaleMaxMl) * 100_000) / 1_000;
}

export function buildSickMilkProgressModel({
  consumedMl,
  baselineMl,
  expectedMl,
}: {
  consumedMl: number;
  baselineMl: number | null | undefined;
  expectedMl: number | null | undefined;
}): SickMilkProgressModel {
  const consumed = nonNegativeNumber(consumedMl);
  const baseline = positiveNumber(baselineMl);
  const expected = positiveNumber(expectedMl);
  const threshold = baseline == null ? null : baseline / 2;
  const scaleMaxMl = Math.max(1, consumed, baseline ?? 0, expected ?? 0);
  return {
    consumedMl: consumed,
    consumedPercent: position(consumed, scaleMaxMl),
    scaleMaxMl,
    threshold: threshold == null ? null : { valueMl: threshold, positionPercent: position(threshold, scaleMaxMl) },
    baseline: baseline == null ? null : { valueMl: baseline, positionPercent: position(baseline, scaleMaxMl) },
    expected: expected == null ? null : { valueMl: expected, positionPercent: position(expected, scaleMaxMl) },
  };
}

function formatMl(value: number | null): string {
  if (value == null) return "Pending";
  return `${Number.isInteger(value) ? value : value.toFixed(1)} ml`;
}

export default function SickMilkProgress({
  consumedMl,
  baselineMl,
  expectedMl,
  baselineKind,
}: {
  consumedMl: number;
  baselineMl: number | null | undefined;
  expectedMl: number | null | undefined;
  baselineKind: "calculated" | "manual";
}) {
  const model = buildSickMilkProgressModel({ consumedMl, baselineMl, expectedMl });
  const baselineLabel = baselineKind === "manual" ? "Approved manual baseline" : "Pre-sick median";

  return (
    <>
      <div
        className="milk-progress relative mt-3 h-2 rounded-full bg-cream"
        data-scale-max-ml={model.scaleMaxMl}
        aria-label={`Today ${model.consumedMl} ml; 50% full-day baseline ${formatMl(model.threshold?.valueMl ?? null)}; ${baselineLabel.toLowerCase()} ${formatMl(model.baseline?.valueMl ?? null)}; expected weight estimate ${formatMl(model.expected?.valueMl ?? null)}`}
      >
        <div className="h-full rounded-full bg-terracotta transition-[width]" style={{ width: `${model.consumedPercent}%` }} />
        {model.threshold && (
          <span
            data-milk-marker="threshold"
            data-value-ml={model.threshold.valueMl}
            role="img"
            aria-label={`50% full-day baseline ${formatMl(model.threshold.valueMl)}`}
            className="absolute -inset-y-1 w-px -translate-x-1/2 rounded-full bg-danger"
            style={{ left: `${model.threshold.positionPercent}%` }}
          />
        )}
        {model.baseline && (
          <span
            data-milk-marker="baseline"
            data-value-ml={model.baseline.valueMl}
            role="img"
            aria-label={`${baselineLabel} ${formatMl(model.baseline.valueMl)}`}
            className="absolute bottom-0 h-2.5 w-1 -translate-x-1/2 rounded-t-full bg-warning"
            style={{ left: `${model.baseline.positionPercent}%` }}
          />
        )}
        {model.expected && (
          <span
            data-milk-marker="expected"
            data-value-ml={model.expected.valueMl}
            role="img"
            aria-label={`Expected weight estimate ${formatMl(model.expected.valueMl)}`}
            className="absolute top-0 h-2.5 w-1 -translate-x-1/2 rounded-b-full bg-info"
            style={{ left: `${model.expected.positionPercent}%` }}
          />
        )}
      </div>
      <div role="list" aria-label="Full-day milk guide values" className="milk-threshold-legend mt-2 grid grid-cols-3 gap-x-1 text-[11px] leading-[14px] text-muted">
        <span role="listitem" className="min-w-0" aria-label={`50% full-day baseline ${formatMl(model.threshold?.valueMl ?? null)}`}><span className="font-medium text-danger">50%</span><span className="tabular-nums"> · {formatMl(model.threshold?.valueMl ?? null)}</span></span>
        <span role="listitem" className="min-w-0 text-center" aria-label={`${baselineLabel} ${formatMl(model.baseline?.valueMl ?? null)}`}><span className="font-medium text-warning">{baselineKind === "manual" ? "Manual" : "Median"}</span><span className="tabular-nums"> · {formatMl(model.baseline?.valueMl ?? null)}</span></span>
        <span role="listitem" className="min-w-0 text-right" aria-label={`Expected weight estimate ${formatMl(model.expected?.valueMl ?? null)}`}><span className="font-medium text-info">Expected</span><span className="tabular-nums"> · {formatMl(model.expected?.valueMl ?? null)}</span></span>
        <details className="col-span-3 text-left text-[11px] leading-[14px]">
          <summary className="cursor-pointer font-medium text-muted">Full-day guides · today is still in progress</summary>
          <p className="mt-1 leading-relaxed">The pre-sick baseline is frozen from up to 7 completed Singapore days before this episode, or the approved manual amount. The 50% mark is half that baseline. Expected uses the latest recorded weight × 150 ml/kg/day; it is an estimate, not a prescribed requirement or an automatic emergency verdict for a partial day.</p>
        </details>
      </div>
    </>
  );
}
