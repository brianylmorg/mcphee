export type MedicationPrescriptionDraftInput = {
  name: string;
  doseText: string;
  asNeeded: boolean;
  minIntervalHours: string;
  maxIntervalHours: string;
};

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
