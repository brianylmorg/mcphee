import { SG2000_BOYS_WEIGHT_FOR_AGE, type Sg2000WeightPoint } from "./sg2000-weight-for-age-boys";

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

// Age in fractional months from epoch-ms timestamps (365.25/12 days per month).
export function ageMonthsAt(measuredAt: number, birthDate: number): number | null {
  if (!Number.isFinite(measuredAt) || !Number.isFinite(birthDate) || measuredAt < birthDate) return null;
  return (measuredAt - birthDate) / (365.25 / 12 * 24 * 60 * 60 * 1000);
}

function weightsByPercentile(point: Sg2000WeightPoint): Map<number, number> {
  return new Map(point.weights.map((w) => [w.p, w.kg]));
}

// Percentile -> weight (kg) grid at an exact, possibly fractional age in months.
// Builds from the nearest month rows at-or-below and at-or-above the age, so
// sparse tables (e.g. every other month) still interpolate correctly.
function gridAtAge(ageMonths: number, table: Sg2000WeightPoint[]): { p: number; kg: number }[] | null {
  if (table.length === 0) return null;
  if (!Number.isFinite(ageMonths)) return null;

  const lowerRow = [...table].reverse().find((row) => row.month <= ageMonths);
  const upperRow = table.find((row) => row.month >= ageMonths);
  if (!lowerRow || !upperRow) return null;
  if (lowerRow.month === upperRow.month) {
    return lowerRow.weights.length === 0 ? null : lowerRow.weights.map((w) => ({ ...w }));
  }

  const lowerP = weightsByPercentile(lowerRow);
  const upperP = weightsByPercentile(upperRow);
  if (lowerP.size === 0 && upperP.size === 0) return null;

  const t = (ageMonths - lowerRow.month) / (upperRow.month - lowerRow.month);
  const percentiles = new Set<number>();
  lowerP.forEach((_, p) => percentiles.add(p));
  upperP.forEach((_, p) => percentiles.add(p));

  const grid: { p: number; kg: number }[] = [];
  percentiles.forEach((p) => {
    const lo = lowerP.get(p);
    const hi = upperP.get(p);
    if (lo == null && hi == null) return;
    const kg = lo == null ? (hi as number) : hi == null ? lo : lo + (hi - lo) * t;
    grid.push({ p, kg });
  });
  grid.sort((a, b) => a.kg - b.kg);
  return grid;
}

// Percentile for a boy's weight against the SG 2000 reference. Interpolates in
// log-weight space (more accurate in early life when weight grows fast), with
// mild extrapolation beyond the outermost percentile curves clamped to
// [0.1, 99.9]. Returns null for invalid input or an unpopulated table.
export function sg2000BoysWeightForAgePercentile(
  weightG: number,
  ageMonths: number,
  table: Sg2000WeightPoint[] = SG2000_BOYS_WEIGHT_FOR_AGE,
): number | null {
  if (!Number.isFinite(weightG) || weightG <= 0) return null;
  const grid = gridAtAge(ageMonths, table);
  if (!grid || grid.length === 0) return null;
  if (grid.length === 1) return clamp(grid[0].p, 0.1, 99.9);

  const weightKg = weightG / 1000;
  const interpolatePair = (low: { p: number; kg: number }, high: { p: number; kg: number }, w: number): number => {
    if (high.kg <= low.kg) return (low.p + high.p) / 2;
    const t = (Math.log(w) - Math.log(low.kg)) / (Math.log(high.kg) - Math.log(low.kg));
    return low.p + t * (high.p - low.p);
  };

  const lowest = grid[0];
  const highest = grid[grid.length - 1];

  let percentile: number;
  if (weightKg <= lowest.kg) {
    percentile = interpolatePair(grid[0], grid[1], weightKg);
  } else if (weightKg >= highest.kg) {
    percentile = interpolatePair(grid[grid.length - 2], grid[grid.length - 1], weightKg);
  } else {
    let i = 0;
    while (i < grid.length - 1 && grid[i + 1].kg < weightKg) i += 1;
    percentile = interpolatePair(grid[i], grid[i + 1], weightKg);
  }

  return clamp(percentile, 0.1, 99.9);
}
