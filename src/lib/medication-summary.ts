import { formatElapsedDuration } from "./elapsed-time";
import { formatTime } from "./utils";

const HOUR_MS = 60 * 60 * 1000;
/** From this many medicines the list starts collapsed so the milk card stays in view. */
export const MEDICATION_COLLAPSE_FROM = 3;

export type SummaryMedication = {
  name: string;
  asNeeded: boolean;
  minIntervalHours: number | null;
  latestDose: { givenAt: number } | null;
};

export type MedicationSummary = {
  /** "5 medicines", "1 medicine". */
  label: string;
  /** One line for the collapsed row; null when there is nothing to say. */
  headline: { name: string; detail: string; tone: "due" | "overdue" | "next" | "last" } | null;
};

/**
 * What the collapsed medicines row shows: the scheduled medicine due soonest
 * (overdue or due now in the warning tones), else the most recent dose of any
 * medicine. As-needed medicines never count as "due".
 */
export function medicationSummary(medications: readonly SummaryMedication[], now: number): MedicationSummary {
  const count = medications.length;
  const label = `${count} ${count === 1 ? "medicine" : "medicines"}`;

  let soonest: { name: string; dueAt: number | null } | null = null;
  for (const med of medications) {
    if (med.asNeeded || med.minIntervalHours == null) continue;
    const dueAt = med.latestDose ? med.latestDose.givenAt + med.minIntervalHours * HOUR_MS : null;
    // A scheduled medicine with no dose logged yet is due now.
    const sortKey = dueAt ?? -Infinity;
    if (!soonest || sortKey < (soonest.dueAt ?? -Infinity)) soonest = { name: med.name, dueAt };
  }

  if (soonest) {
    if (soonest.dueAt == null) return { label, headline: { name: soonest.name, detail: "no dose yet", tone: "due" } };
    const diff = soonest.dueAt - now;
    if (diff <= 0) {
      return { label, headline: { name: soonest.name, detail: `overdue ${formatElapsedDuration(-diff)}`, tone: "overdue" } };
    }
    return {
      label,
      headline: { name: soonest.name, detail: `due ${formatTime(soonest.dueAt)} · in ${formatElapsedDuration(diff)}`, tone: diff <= 30 * 60 * 1000 ? "due" : "next" },
    };
  }

  let last: { name: string; givenAt: number } | null = null;
  for (const med of medications) {
    if (med.latestDose && (!last || med.latestDose.givenAt > last.givenAt)) last = { name: med.name, givenAt: med.latestDose.givenAt };
  }
  if (last) return { label, headline: { name: last.name, detail: `given ${formatElapsedDuration(now - last.givenAt)} ago`, tone: "last" } };
  return { label, headline: null };
}
