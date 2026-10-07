export const HISTORICAL_MEDICATION_VERSION = 1 as const;
export const HISTORICAL_MEDICATION_NAME_MAX_LENGTH = 120;
export const HISTORICAL_MEDICATION_DOSE_MAX_LENGTH = 120;

export type HistoricalMedicationEventKind = "medication" | "procedure";

export type HistoricalMedicationProvenance = {
  version: typeof HISTORICAL_MEDICATION_VERSION;
  eventKind: HistoricalMedicationEventKind;
  sourceActivityId: string;
  sourceStartedAt: number;
  sourceDetailsSha256: string;
  matchOrdinal: number;
  importKey: string;
  revision: number;
  deletedAt?: number;
  deletedBy?: string | null;
};

export type HistoricalMedicationDetails = {
  medicationName: string;
  doseText: string;
  /** The source note verbatim. The source activity itself is never rewritten. */
  notes: string;
  historicalMedication: HistoricalMedicationProvenance;
};

export type HistoricalMedicationReference = {
  activityId: string;
  revision: number;
  medicationName: string;
  doseText: string;
  eventKind: HistoricalMedicationEventKind;
  originalNote: string;
  sourceActivityId: string;
  sourceStartedAt: number;
  sourceDetailsSha256: string;
  matchOrdinal: number;
  importKey: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseDetailsValue(value: unknown): Record<string, unknown> | null {
  if (isRecord(value)) return value;
  if (typeof value !== "string") return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Recognizes only the versioned standalone historical-medication contract.
 * An arbitrary activity with type=medication is not granted edit/delete
 * capabilities merely because it lacks a sick-mode dose reference.
 */
export function parseHistoricalMedicationDetails(value: unknown): HistoricalMedicationDetails | null {
  const details = parseDetailsValue(value);
  if (!details) return null;

  const provenance = details.historicalMedication;
  if (!isRecord(provenance)) return null;
  const eventKind = provenance.eventKind;
  const medicationName = details.medicationName;
  const doseText = details.doseText;
  const notes = details.notes;

  if (provenance.version !== HISTORICAL_MEDICATION_VERSION) return null;
  if (eventKind !== "medication" && eventKind !== "procedure") return null;
  if (typeof medicationName !== "string" || !medicationName.trim()
    || medicationName.length > HISTORICAL_MEDICATION_NAME_MAX_LENGTH) return null;
  if (typeof doseText !== "string" || doseText.length > HISTORICAL_MEDICATION_DOSE_MAX_LENGTH) return null;
  if (eventKind === "medication" && !doseText.trim()) return null;
  if (eventKind === "procedure" && doseText !== "") return null;
  if (typeof notes !== "string") return null;
  if (typeof provenance.sourceActivityId !== "string" || !provenance.sourceActivityId) return null;
  if (typeof provenance.sourceStartedAt !== "number" || !Number.isFinite(provenance.sourceStartedAt)
    || provenance.sourceStartedAt <= 0) return null;
  if (typeof provenance.sourceDetailsSha256 !== "string"
    || !/^[a-f0-9]{64}$/.test(provenance.sourceDetailsSha256)) return null;
  if (!Number.isInteger(provenance.matchOrdinal) || Number(provenance.matchOrdinal) < 0) return null;
  if (typeof provenance.importKey !== "string" || !provenance.importKey) return null;
  if (!Number.isInteger(provenance.revision) || Number(provenance.revision) < 1) return null;
  if (provenance.deletedAt != null
    && (typeof provenance.deletedAt !== "number" || !Number.isFinite(provenance.deletedAt) || provenance.deletedAt <= 0)) {
    return null;
  }
  if (provenance.deletedBy != null && typeof provenance.deletedBy !== "string") return null;

  return {
    medicationName,
    doseText,
    notes,
    historicalMedication: {
      version: HISTORICAL_MEDICATION_VERSION,
      eventKind,
      sourceActivityId: provenance.sourceActivityId,
      sourceStartedAt: provenance.sourceStartedAt,
      sourceDetailsSha256: provenance.sourceDetailsSha256,
      matchOrdinal: Number(provenance.matchOrdinal),
      importKey: provenance.importKey,
      revision: Number(provenance.revision),
      ...(provenance.deletedAt == null ? {} : { deletedAt: provenance.deletedAt }),
      ...(Object.prototype.hasOwnProperty.call(provenance, "deletedBy")
        ? { deletedBy: provenance.deletedBy == null ? null : provenance.deletedBy }
        : {}),
    },
  };
}

export function historicalMedicationReference(
  activityId: string,
  value: unknown,
): HistoricalMedicationReference | null {
  if (!activityId) return null;
  const details = parseHistoricalMedicationDetails(value);
  if (!details || details.historicalMedication.deletedAt != null) return null;
  const provenance = details.historicalMedication;
  return {
    activityId,
    revision: provenance.revision,
    medicationName: details.medicationName,
    doseText: details.doseText,
    eventKind: provenance.eventKind,
    originalNote: details.notes,
    sourceActivityId: provenance.sourceActivityId,
    sourceStartedAt: provenance.sourceStartedAt,
    sourceDetailsSha256: provenance.sourceDetailsSha256,
    matchOrdinal: provenance.matchOrdinal,
    importKey: provenance.importKey,
  };
}
