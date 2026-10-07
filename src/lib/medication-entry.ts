export type MedicationPrescriptionDraftInput = {
  requestId?: string;
  name: string;
  doseText: string;
  asNeeded: boolean;
  minIntervalHours: string;
  maxIntervalHours: string;
};

export type IdentifiedMedicationPrescriptionDraftInput = MedicationPrescriptionDraftInput & {
  requestId: string;
};

const MIN_INTERVAL_HOURS = 1 / 60;
const MAX_INTERVAL_HOURS = 168;

type MedicationScheduleDraft = Pick<
  MedicationPrescriptionDraftInput,
  "asNeeded" | "minIntervalHours" | "maxIntervalHours"
>;

function draftIntervalHours(value: string): number | null | undefined {
  if (!value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * Returns a user-facing validation message for the medication schedule fields.
 * A scheduled medication needs an interval; PRN intervals remain optional.
 */
export function medicationScheduleValidationError(draft: MedicationScheduleDraft): string | null {
  const minIntervalHours = draftIntervalHours(draft.minIntervalHours);
  const maxIntervalHours = draftIntervalHours(draft.maxIntervalHours);

  if (!draft.asNeeded && minIntervalHours === null) {
    return "Enter how often this medication should be given.";
  }
  if (minIntervalHours === undefined
    || (minIntervalHours != null
      && (minIntervalHours < MIN_INTERVAL_HOURS || minIntervalHours > MAX_INTERVAL_HOURS))) {
    return `Every (hours) must be between 0 and ${MAX_INTERVAL_HOURS} hours.`;
  }
  if (maxIntervalHours === undefined
    || (maxIntervalHours != null
      && (maxIntervalHours < MIN_INTERVAL_HOURS || maxIntervalHours > MAX_INTERVAL_HOURS))) {
    return `Latest interval must be between 0 and ${MAX_INTERVAL_HOURS} hours.`;
  }
  if (minIntervalHours != null && maxIntervalHours != null && maxIntervalHours < minIntervalHours) {
    return "Latest interval cannot be earlier than every interval.";
  }
  return null;
}

export function identifyMedicationPrescriptionDraft(
  draft: MedicationPrescriptionDraftInput,
): IdentifiedMedicationPrescriptionDraftInput {
  const requestId = draft.requestId?.trim() || globalThis.crypto.randomUUID();
  return { ...draft, requestId };
}

export type MedicationEntry =
  | {
      kind: "add";
      episodeId: string;
      initialDrafts?: MedicationPrescriptionDraftInput[];
    }
  | {
      kind: "log";
      episodeId: string;
      medicationId?: string;
    };

export function medicationAddEntry(
  episodeId: string,
  initialDrafts?: MedicationPrescriptionDraftInput[],
): MedicationEntry {
  return { kind: "add", episodeId, ...(initialDrafts ? { initialDrafts } : {}) };
}

export function medicationLogEntry(episodeId: string, medicationId?: string): MedicationEntry {
  return { kind: "log", episodeId, ...(medicationId ? { medicationId } : {}) };
}

export function entryForActiveEpisode(
  entry: MedicationEntry | null,
  activeEpisodeId: string | undefined,
): MedicationEntry | null {
  return entry?.episodeId === activeEpisodeId ? entry : null;
}
