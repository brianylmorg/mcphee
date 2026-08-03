// SG 2000 (NHG Polyclinics) weight-for-age reference for boys.
// Source: National Healthcare Group Polyclinics' Anthropometric Growth Charts
// for Singapore Preschool Children 2000 (Child Health Booklet, revised Apr 2003).
//
// This is the reference the Child Health Booklet's weight charts are plotted on,
// so percentiles from here match what the booklet shows (unlike WHO standards).
//
// Values transcribed from the user's source; months 0-24 in 2-month steps,
// percentile columns 3/10/25/50/75/90/97. NOTE: the full chart runs to 72
// months — rows past 24 are not yet filled (see PENDING below).
//
// The engine interpolates across age and across percentile in log-weight space,
// so the 2-month step table is handled smoothly and sparse/partial tables are fine.

export type Sg2000WeightPoint = {
  month: number;
  weights: { p: number; kg: number }[];
};

export const SG2000_BOYS_WEIGHT_FOR_AGE: Sg2000WeightPoint[] = [
  { month: 0, weights: [{ p: 3, kg: 2.3 }, { p: 10, kg: 2.6 }, { p: 25, kg: 2.9 }, { p: 50, kg: 3.2 }, { p: 75, kg: 3.5 }, { p: 90, kg: 3.8 }, { p: 97, kg: 4.0 }] },
  { month: 2, weights: [{ p: 3, kg: 4.1 }, { p: 10, kg: 4.6 }, { p: 25, kg: 5.1 }, { p: 50, kg: 5.6 }, { p: 75, kg: 6.1 }, { p: 90, kg: 6.5 }, { p: 97, kg: 6.9 }] },
  { month: 4, weights: [{ p: 3, kg: 5.5 }, { p: 10, kg: 6.0 }, { p: 25, kg: 6.6 }, { p: 50, kg: 7.2 }, { p: 75, kg: 7.8 }, { p: 90, kg: 8.3 }, { p: 97, kg: 8.8 }] },
  { month: 6, weights: [{ p: 3, kg: 6.4 }, { p: 10, kg: 7.0 }, { p: 25, kg: 7.6 }, { p: 50, kg: 8.3 }, { p: 75, kg: 9.0 }, { p: 90, kg: 9.7 }, { p: 97, kg: 10.3 }] },
  { month: 8, weights: [{ p: 3, kg: 7.0 }, { p: 10, kg: 7.6 }, { p: 25, kg: 8.3 }, { p: 50, kg: 9.1 }, { p: 75, kg: 9.8 }, { p: 90, kg: 10.4 }, { p: 97, kg: 11.1 }] },
  { month: 10, weights: [{ p: 3, kg: 7.5 }, { p: 10, kg: 8.1 }, { p: 25, kg: 8.8 }, { p: 50, kg: 9.6 }, { p: 75, kg: 10.4 }, { p: 90, kg: 11.0 }, { p: 97, kg: 11.8 }] },
  { month: 12, weights: [{ p: 3, kg: 7.9 }, { p: 10, kg: 8.5 }, { p: 25, kg: 9.2 }, { p: 50, kg: 10.0 }, { p: 75, kg: 10.8 }, { p: 90, kg: 11.6 }, { p: 97, kg: 12.4 }] },
  { month: 14, weights: [{ p: 3, kg: 8.2 }, { p: 10, kg: 8.9 }, { p: 25, kg: 9.6 }, { p: 50, kg: 10.4 }, { p: 75, kg: 11.2 }, { p: 90, kg: 12.0 }, { p: 97, kg: 12.9 }] },
  { month: 16, weights: [{ p: 3, kg: 8.5 }, { p: 10, kg: 9.2 }, { p: 25, kg: 9.9 }, { p: 50, kg: 10.7 }, { p: 75, kg: 11.6 }, { p: 90, kg: 12.5 }, { p: 97, kg: 13.4 }] },
  { month: 18, weights: [{ p: 3, kg: 8.8 }, { p: 10, kg: 9.5 }, { p: 25, kg: 10.3 }, { p: 50, kg: 11.1 }, { p: 75, kg: 12.0 }, { p: 90, kg: 12.9 }, { p: 97, kg: 13.8 }] },
  { month: 20, weights: [{ p: 3, kg: 9.1 }, { p: 10, kg: 9.8 }, { p: 25, kg: 10.6 }, { p: 50, kg: 11.5 }, { p: 75, kg: 12.4 }, { p: 90, kg: 13.3 }, { p: 97, kg: 14.3 }] },
  { month: 22, weights: [{ p: 3, kg: 9.5 }, { p: 10, kg: 10.2 }, { p: 25, kg: 11.0 }, { p: 50, kg: 11.9 }, { p: 75, kg: 12.8 }, { p: 90, kg: 13.7 }, { p: 97, kg: 14.7 }] },
  { month: 24, weights: [{ p: 3, kg: 9.8 }, { p: 10, kg: 10.6 }, { p: 25, kg: 11.4 }, { p: 50, kg: 12.3 }, { p: 75, kg: 13.2 }, { p: 90, kg: 14.1 }, { p: 97, kg: 15.2 }] },
  // PENDING: months 26-72 not yet transcribed from the source chart. Until they
  // are, children older than 24 months report "percentile unavailable". Add rows
  // here in the same shape (2-month step is fine) to extend coverage.
];
