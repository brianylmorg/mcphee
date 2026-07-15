import { WHO_BOYS_WEIGHT_FOR_AGE_LMS, type WhoLmsPoint } from "./weight-for-age-boys";

function erf(x: number): number {
  // Abramowitz and Stegun 7.1.26; enough precision for percentile display.
  const sign = x < 0 ? -1 : 1;
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const absX = Math.abs(x);
  const t = 1 / (1 + p * absX);
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-absX * absX);
  return sign * y;
}

function normalCdf(z: number): number {
  return 0.5 * (1 + erf(z / Math.SQRT2));
}

function interpolateLms(ageMonths: number, table: WhoLmsPoint[]): WhoLmsPoint | null {
  if (!Number.isFinite(ageMonths) || ageMonths < table[0].month || ageMonths > table[table.length - 1].month) {
    return null;
  }

  const lower = Math.floor(ageMonths);
  const upper = Math.ceil(ageMonths);
  const lowerPoint = table.find((point) => point.month === lower);
  const upperPoint = table.find((point) => point.month === upper);
  if (!lowerPoint || !upperPoint) return null;
  if (lower === upper) return lowerPoint;

  const t = ageMonths - lower;
  return {
    month: ageMonths,
    l: lowerPoint.l + (upperPoint.l - lowerPoint.l) * t,
    m: lowerPoint.m + (upperPoint.m - lowerPoint.m) * t,
    s: lowerPoint.s + (upperPoint.s - lowerPoint.s) * t,
  };
}

export function ageMonthsAt(measuredAt: number, birthDate: number): number | null {
  if (!Number.isFinite(measuredAt) || !Number.isFinite(birthDate) || measuredAt < birthDate) return null;
  return (measuredAt - birthDate) / (365.25 / 12 * 24 * 60 * 60 * 1000);
}

export function whoBoysWeightForAgePercentile(weightG: number, ageMonths: number): number | null {
  if (!Number.isFinite(weightG) || weightG <= 0) return null;
  const lms = interpolateLms(ageMonths, WHO_BOYS_WEIGHT_FOR_AGE_LMS);
  if (!lms) return null;

  const weightKg = weightG / 1000;
  const z = Math.abs(lms.l) < 0.00001
    ? Math.log(weightKg / lms.m) / lms.s
    : (Math.pow(weightKg / lms.m, lms.l) - 1) / (lms.l * lms.s);

  return Math.max(0.1, Math.min(99.9, normalCdf(z) * 100));
}
