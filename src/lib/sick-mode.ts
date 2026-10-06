import { bottleVolumes, parseActivityDetails, sgtDateKey } from "@/lib/milk-volumes";

export const SGT_DAY_MS = 24 * 60 * 60 * 1000;
export const SICK_MODE_BASELINE_DAYS = 7;

export type SickBaselineDay = { date: string; totalMl: number };

export type SickBaselinePreview = {
  startedAt: number;
  onsetDate: string;
  medianDailyMl: number | null;
  availableDayCount: number;
  requiredDayCount: number;
  requiresIncompleteConfirmation: boolean;
  requiresManualBaseline: boolean;
  sourceDays: SickBaselineDay[];
};

export type SickEpisode = {
  id: string;
  babyId: string;
  startedAt: number;
  endedAt: number | null;
  baselineDailyMl: number;
  baselineKind: "calculated" | "manual";
  baselineAvailableDayCount: number;
  baselineSourceDays: SickBaselineDay[];
  createdAt: number;
  createdBy: string | null;
  endedBy: string | null;
};

export type SickDose = {
  id: string;
  medicationId: string;
  givenAt: number;
  doseText: string;
  givenBy: string | null;
  createdAt: number;
  updatedAt: number;
  revision: number;
};

export type SickMedication = {
  id: string;
  episodeId: string;
  name: string;
  doseText: string;
  asNeeded: boolean;
  minIntervalHours: number | null;
  maxIntervalHours: number | null;
  createdAt: number;
  createdBy: string | null;
  revision: number;
  latestDose: SickDose | null;
  doses: SickDose[];
};

export type SickFeedSummary = {
  id: string;
  startedAt: number;
  totalMl: number;
  breastmilkMl: number;
  formulaMl: number;
};

export type SickDiaperSummary = {
  id: string;
  startedAt: number;
  peeUnits: number | null;
  isWet: boolean | null;
  poop: string | null;
};

export type SickTemperatureSummary = {
  id: string;
  measuredAt: number;
  celsius: number;
  method: string | null;
};

export type SickCompletedDayConcern = {
  date: string;
  totalMl: number;
  thresholdMl: number;
};

export type SickModeSummary = {
  date: string;
  todayConsumedMl: number;
  todayBreastmilkMl: number;
  todayFormulaMl: number;
  todayFeedDataAvailable: boolean;
  expectedDailyMl: number;
  thresholdMl: number;
  latestFeeds: SickFeedSummary[];
  lastCompletedDayConcern: SickCompletedDayConcern | null;
  peeUnitsToday: number;
  wetDiaperCountToday: number;
  lastWetAt: number | null;
  latestDiapers: SickDiaperSummary[];
  latestTemperature: SickTemperatureSummary | null;
};

export type SickModeResponse = {
  schemaReady: boolean;
  asOfTimestamp: number;
  activeEpisode: SickEpisode | null;
  archivedEpisode: SickEpisode | null;
  episodes: SickEpisode[];
  baselinePreview: SickBaselinePreview | null;
  medicationSuggestions: string[];
  medications: SickMedication[];
  archivedMedications: SickMedication[];
  summary: SickModeSummary | null;
  error?: string;
};

export type SickActivityRow = {
  id: string;
  type: string;
  started_at: number;
  created_at?: number;
  details: unknown;
};

export type SickEpisodeRange = { startedAt: number; endedAt: number | null };

export function sgtDayStart(timestampOrDate: number | string): number {
  const date = typeof timestampOrDate === "string" ? timestampOrDate : sgtDateKey(timestampOrDate);
  return Date.parse(`${date}T00:00:00+08:00`);
}

export function shiftSgtDate(date: string, days: number): string {
  return sgtDateKey(sgtDayStart(date) + days * SGT_DAY_MS);
}

export function medianMilk(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const value = sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
  return Math.round(value * 100) / 100;
}

export function episodeOverlapsSgtDate(episode: SickEpisodeRange, date: string): boolean {
  const start = sgtDayStart(date);
  const end = start + SGT_DAY_MS;
  return episode.startedAt < end && (episode.endedAt == null || episode.endedAt > start);
}

export function buildBaselinePreview(
  startedAt: number,
  activities: SickActivityRow[],
  priorEpisodes: SickEpisodeRange[],
): SickBaselinePreview {
  const onsetDate = sgtDateKey(startedAt);
  const candidateDates = Array.from({ length: SICK_MODE_BASELINE_DAYS }, (_, index) =>
    shiftSgtDate(onsetDate, index - SICK_MODE_BASELINE_DAYS),
  );
  const totals = new Map(candidateDates.map((date) => [date, 0]));

  for (const activity of activities) {
    if (activity.type !== "bottlefeed" || !Number.isFinite(Number(activity.started_at))) continue;
    const date = sgtDateKey(Number(activity.started_at));
    if (!totals.has(date)) continue;
    const volumes = bottleVolumes(parseActivityDetails(activity.details));
    totals.set(date, (totals.get(date) ?? 0) + volumes.breastmilkMl + volumes.formulaMl);
  }

  const sourceDays = candidateDates.flatMap((date) => {
    if (priorEpisodes.some((episode) => episodeOverlapsSgtDate(episode, date))) return [];
    const totalMl = Math.round((totals.get(date) ?? 0) * 100) / 100;
    return totalMl > 0 ? [{ date, totalMl }] : [];
  });
  const medianDailyMl = medianMilk(sourceDays.map((day) => day.totalMl));

  return {
    startedAt,
    onsetDate,
    medianDailyMl,
    availableDayCount: sourceDays.length,
    requiredDayCount: SICK_MODE_BASELINE_DAYS,
    requiresIncompleteConfirmation: sourceDays.length > 0 && sourceDays.length < SICK_MODE_BASELINE_DAYS,
    requiresManualBaseline: sourceDays.length === 0,
    sourceDays,
  };
}

export function parsePeeUnits(details: Record<string, unknown>): number | null {
  const raw = details.peeUnits ?? details.peeSize;
  if (typeof raw === "number" && Number.isInteger(raw) && raw >= 0 && raw <= 5) return raw;
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  if (/^[0-5]$/.test(value)) return Number(value);
  if (/^(no|none)$/i.test(value)) return 0;
  if (value === "M") return 3;
  if (value === "L") return 5;
  return null;
}

export function parseEpisodeSourceDays(value: unknown): SickBaselineDay[] {
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const row = item as Record<string, unknown>;
      const totalMl = Number(row.totalMl);
      return typeof row.date === "string" && Number.isFinite(totalMl) && totalMl > 0
        ? [{ date: row.date, totalMl }]
        : [];
    });
  } catch {
    return [];
  }
}
