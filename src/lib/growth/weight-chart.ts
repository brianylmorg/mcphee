import { ageMonthsAt, sg2000BoysWeightAtPercentile, sg2000BoysWeightForAgePercentile } from "./percentile";

const DAY_MS = 24 * 60 * 60 * 1000;

export type WeighIn = { id: string; measuredAt: number; weightG: number };

export type WeighInRow = WeighIn & {
  ageMonths: number | null;
  percentile: number | null;
  /** Change since the previous weigh-in, or null for the first. */
  deltaG: number | null;
  deltaDays: number | null;
};

/** Oldest first, with age, percentile and the change since the weigh-in before. */
export function weighInRows(weighIns: WeighIn[], birthDate: number | null): WeighInRow[] {
  const sorted = [...weighIns].sort((a, b) => a.measuredAt - b.measuredAt);
  return sorted.map((entry, index) => {
    const previous = index > 0 ? sorted[index - 1] : null;
    const ageMonths = birthDate ? ageMonthsAt(entry.measuredAt, birthDate) : null;
    return {
      ...entry,
      ageMonths,
      percentile: ageMonths == null ? null : sg2000BoysWeightForAgePercentile(entry.weightG, ageMonths),
      deltaG: previous ? entry.weightG - previous.weightG : null,
      deltaDays: previous ? Math.max(0, Math.round((entry.measuredAt - previous.measuredAt) / DAY_MS)) : null,
    };
  });
}

export type ChartPoint = WeighInRow & { x: number; y: number };
export type BandPath = { lower: number; upper: number; d: string };
export type GridLine = { weightG: number; y: number };
export type MonthTick = { x: number; label: string };

export type WeightChart = {
  width: number;
  height: number;
  plotTop: number;
  plotBottom: number;
  points: ChartPoint[];
  line: string;
  bands: BandPath[];
  median: string | null;
  gridLines: GridLine[];
  monthTicks: MonthTick[];
};

const BAND_PAIRS: [number, number][] = [[3, 97], [10, 90], [25, 75]];
/** Smallest horizontal room per day, so long histories scroll instead of squashing. */
const MIN_PX_PER_DAY = 5;

function niceStep(rangeG: number): number {
  return [250, 500, 1000, 2000, 5000].find((step) => rangeG / step <= 7) ?? 5000;
}

const monthLabel = new Intl.DateTimeFormat("en-SG", { timeZone: "Asia/Singapore", month: "short" });

/**
 * Lays weigh-ins out on a true time axis (equal days get equal width) with
 * SG 2000 percentile bands behind them. Bands are sampled across the shown
 * dates while the baby's age is inside the reference table.
 */
export function buildWeightChart(
  rows: WeighInRow[],
  birthDate: number | null,
  viewportWidth: number,
  height = 220,
): WeightChart {
  const plotTop = 16;
  const plotBottom = height - 28;
  const padX = 22;
  if (rows.length === 0) {
    return { width: viewportWidth, height, plotTop, plotBottom, points: [], line: "", bands: [], median: null, gridLines: [], monthTicks: [] };
  }

  const first = rows[0].measuredAt;
  const last = rows[rows.length - 1].measuredAt;
  // A little breathing room either side; a single weigh-in gets a week each way.
  const spanDays = Math.max(14, (last - first) / DAY_MS);
  const start = first - Math.max(3, spanDays * 0.06) * DAY_MS;
  const end = last + Math.max(3, spanDays * 0.06) * DAY_MS;
  const days = (end - start) / DAY_MS;
  const width = Math.max(viewportWidth, Math.round(days * MIN_PX_PER_DAY) + padX * 2);
  const xAt = (timestamp: number) => padX + ((timestamp - start) / (end - start)) * (width - padX * 2);

  // Sample the reference curves every few days across the shown range.
  const samples: { at: number; curves: Map<number, number> }[] = [];
  if (birthDate) {
    const step = Math.max(1, Math.round(days / 60)) * DAY_MS;
    const sampleTimes: number[] = [];
    for (let at = start; at < end; at += step) sampleTimes.push(at);
    sampleTimes.push(end); // always reach the right edge
    for (const at of sampleTimes) {
      const age = ageMonthsAt(at, birthDate);
      if (age == null) continue;
      const curves = new Map<number, number>();
      for (const p of [3, 10, 25, 50, 75, 90, 97]) {
        const weight = sg2000BoysWeightAtPercentile(p, age);
        if (weight != null) curves.set(p, weight);
      }
      if (curves.size === 7) samples.push({ at, curves });
    }
  }

  const weights = rows.map((row) => row.weightG);
  const curveWeights = samples.flatMap((sample) => [sample.curves.get(3)!, sample.curves.get(97)!]);
  const minG = Math.min(...weights, ...curveWeights);
  const maxG = Math.max(...weights, ...curveWeights);
  const range = Math.max(400, maxG - minG);
  const bottomG = Math.max(0, minG - range * 0.06);
  const topG = maxG + range * 0.06;
  const yAt = (weightG: number) => plotTop + ((topG - weightG) / (topG - bottomG)) * (plotBottom - plotTop);

  const bands = samples.length < 2 ? [] : BAND_PAIRS.map(([lower, upper]) => {
    const upperEdge = samples.map((s) => `${xAt(s.at).toFixed(1)},${yAt(s.curves.get(upper)!).toFixed(1)}`);
    const lowerEdge = [...samples].reverse().map((s) => `${xAt(s.at).toFixed(1)},${yAt(s.curves.get(lower)!).toFixed(1)}`);
    return { lower, upper, d: `M${upperEdge.join(" L")} L${lowerEdge.join(" L")} Z` };
  });
  const median = samples.length < 2 ? null
    : samples.map((s) => `${xAt(s.at).toFixed(1)},${yAt(s.curves.get(50)!).toFixed(1)}`).join(" ");

  const points = rows.map((row) => ({ ...row, x: xAt(row.measuredAt), y: yAt(row.weightG) }));

  const gridStep = niceStep(topG - bottomG);
  const gridLines: GridLine[] = [];
  for (let w = Math.ceil(bottomG / gridStep) * gridStep; w <= topG; w += gridStep) gridLines.push({ weightG: w, y: yAt(w) });

  // A tick at the start of each month (Singapore time) inside the range.
  const monthTicks: MonthTick[] = [];
  const cursor = new Date(start + 8 * 60 * 60 * 1000);
  let tick = Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1) - 8 * 60 * 60 * 1000;
  while (tick <= end) {
    monthTicks.push({ x: xAt(tick), label: monthLabel.format(new Date(tick)) });
    const next = new Date(tick + 8 * 60 * 60 * 1000);
    tick = Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 1) - 8 * 60 * 60 * 1000;
  }

  return {
    width,
    height,
    plotTop,
    plotBottom,
    points,
    line: points.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" "),
    bands,
    median,
    gridLines,
    monthTicks,
  };
}
