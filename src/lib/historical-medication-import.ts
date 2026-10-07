import { createHash } from "node:crypto";
import type { Client, Transaction } from "@libsql/client";

import {
  HISTORICAL_MEDICATION_DOSE_MAX_LENGTH,
  HISTORICAL_MEDICATION_NAME_MAX_LENGTH,
  HISTORICAL_MEDICATION_VERSION,
  type HistoricalMedicationDetails,
  type HistoricalMedicationEventKind,
} from "@/lib/historical-medication";

export type HistoricalMedicationSourceSnapshot = {
  id: string;
  babyId: string;
  type: "note";
  startedAt: number;
  createdAt: number;
  createdBy: string | null;
  /** Exact stored JSON text, captured during review. */
  details: string;
};

export type ReviewedCanonicalDoseReference = {
  doseId: string;
  medicationId: string;
  episodeId: string;
  expectedMedicationName: string;
  expectedGivenAt: number;
  expectedRevision: number;
  expectedDoseText: string;
  /** A near match is accepted only when the reviewer names it explicitly. */
  timestampRelation: "exact" | "reviewed-near";
  /** Literal reviewed replacement; no unit conversion or dose calculation. */
  correctedDoseText?: string;
};

export type ReviewedPrescriptionTarget = {
  medicationId: string;
  episodeId: string;
  expectedMedicationName: string;
  expectedMedicationRevision: number;
  expectedEpisodeStartedAt: number;
  expectedEpisodeEndedAt: number | null;
};

export type ReviewedHistoricalMedicationEntry = {
  source: HistoricalMedicationSourceSnapshot;
  medicationName: string;
  doseText: string;
  eventKind: HistoricalMedicationEventKind;
  matchOrdinal: number;
  canonicalDose?: ReviewedCanonicalDoseReference;
  prescriptionTarget?: ReviewedPrescriptionTarget;
};

export type HistoricalMedicationImportManifest = {
  version: typeof HISTORICAL_MEDICATION_VERSION;
  inviteCode: string;
  expectedHouseholdId: string;
  babyId: string;
  entries: ReviewedHistoricalMedicationEntry[];
};

export type HistoricalMedicationImportIdentity = {
  activityId: string;
  importKey: string;
};

export type HistoricalMedicationCanonicalDoseIdentity = {
  doseId: string;
  requestId: string;
};

export type HistoricalMedicationCanonicalDoseFingerprint = HistoricalMedicationCanonicalDoseIdentity & {
  updatedAt: number;
  revision: 1;
};

export type HistoricalMedicationImportDisposition =
  | "insert"
  | "existing"
  | "canonical-covered"
  | "canonical-correction"
  | "canonical-correction-applied"
  | "canonical-dose-insert"
  | "canonical-dose-existing";

export type HistoricalMedicationImportPlanEntry = {
  sourceActivityId: string;
  matchOrdinal: number;
  activityId: string | null;
  doseId: string | null;
  importKey: string;
  disposition: HistoricalMedicationImportDisposition;
  canonicalDoseFingerprint?: HistoricalMedicationCanonicalDoseFingerprint;
};

export type HistoricalMedicationImportPlan = {
  householdId: string;
  babyId: string;
  entries: HistoricalMedicationImportPlanEntry[];
  insertCount: number;
  existingCount: number;
  canonicalCoveredCount: number;
  canonicalCorrectionCount: number;
  canonicalDoseInsertCount: number;
  canonicalDoseExistingCount: number;
};

export type HistoricalMedicationImportVerification = {
  verified: true;
  householdId: string;
  babyId: string;
  importedCount: number;
  canonicalImportedCount: number;
  canonicalCoveredCount: number;
  canonicalCorrectedCount: number;
};

export class HistoricalMedicationImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HistoricalMedicationImportError";
  }
}

type Executor = Pick<Client, "execute"> | Pick<Transaction, "execute">;
type TransactionOwner = Pick<Client, "transaction">;

type InspectedEntry = {
  manifestEntry: ReviewedHistoricalMedicationEntry;
  planEntry: HistoricalMedicationImportPlanEntry;
  details: HistoricalMedicationDetails | null;
  detailsJson: string | null;
};

const FUTURE_CLOCK_SKEW_MS = 2 * 60 * 1000;

function fail(message: string): never {
  throw new HistoricalMedicationImportError(message);
}

function isTimestamp(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function normalizedName(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("en");
}

function sourceNote(detailsText: string): string {
  let details: unknown;
  try {
    details = JSON.parse(detailsText);
  } catch {
    return fail("A reviewed source note has invalid JSON details");
  }
  if (!details || typeof details !== "object" || Array.isArray(details)) {
    return fail("A reviewed source note has invalid details");
  }
  const record = details as Record<string, unknown>;
  const note = typeof record.notes === "string"
    ? record.notes
    : typeof record.note === "string"
      ? record.note
      : "";
  if (!note.trim()) return fail("A reviewed source activity does not contain note text");
  return note;
}

function sourceHash(detailsText: string): string {
  return createHash("sha256").update(detailsText, "utf8").digest("hex");
}

export function historicalMedicationImportIdentity(
  householdId: string,
  babyId: string,
  sourceActivityId: string,
  matchOrdinal: number,
): HistoricalMedicationImportIdentity {
  const digest = createHash("sha256")
    .update(JSON.stringify([
      "historical-medication-import",
      HISTORICAL_MEDICATION_VERSION,
      householdId,
      babyId,
      sourceActivityId,
      matchOrdinal,
    ]), "utf8")
    .digest("hex");
  return {
    activityId: `historical-medication:${digest}`,
    importKey: `hm1:${digest}`,
  };
}

export function historicalMedicationCanonicalDoseIdentity(
  householdId: string,
  babyId: string,
  sourceActivityId: string,
  matchOrdinal: number,
): HistoricalMedicationCanonicalDoseIdentity {
  const digest = historicalMedicationImportIdentity(
    householdId,
    babyId,
    sourceActivityId,
    matchOrdinal,
  ).importKey.slice("hm1:".length);
  return {
    doseId: `historical-medication-dose:${digest}`,
    requestId: `historical-medication-dose-request:${digest}`,
  };
}

function validateManifest(manifest: HistoricalMedicationImportManifest): void {
  if (manifest.version !== HISTORICAL_MEDICATION_VERSION) fail("Unsupported historical medication manifest version");
  if (!manifest.inviteCode || !manifest.expectedHouseholdId || !manifest.babyId) {
    fail("Manifest invite, household, and baby identifiers are required");
  }
  if (!Array.isArray(manifest.entries) || manifest.entries.length === 0) {
    fail("Manifest must contain at least one reviewed entry");
  }

  const sourceKeys = new Set<string>();
  const canonicalDoseIds = new Set<string>();
  for (const [index, entry] of manifest.entries.entries()) {
    const label = `Manifest entry ${index}`;
    if (!entry.source || entry.source.type !== "note" || !entry.source.id) fail(`${label} needs a captured note source`);
    if (entry.source.babyId !== manifest.babyId) fail(`${label} belongs to a different baby`);
    if (!isTimestamp(entry.source.startedAt) || !isTimestamp(entry.source.createdAt)) fail(`${label} has an invalid source timestamp`);
    if (entry.source.createdBy != null && typeof entry.source.createdBy !== "string") fail(`${label} has an invalid source caregiver`);
    if (typeof entry.source.details !== "string") fail(`${label} needs exact source details`);
    sourceNote(entry.source.details);
    if (!Number.isInteger(entry.matchOrdinal) || entry.matchOrdinal < 0) fail(`${label} has an invalid match ordinal`);
    const sourceKey = `${entry.source.id}:${entry.matchOrdinal}`;
    if (sourceKeys.has(sourceKey)) fail(`${label} repeats a source match ordinal`);
    sourceKeys.add(sourceKey);

    const medicationName = entry.medicationName.trim();
    const doseText = entry.doseText.trim();
    if (!medicationName || medicationName.length > HISTORICAL_MEDICATION_NAME_MAX_LENGTH) fail(`${label} has an invalid medication name`);
    if (entry.eventKind !== "medication" && entry.eventKind !== "procedure") fail(`${label} has an invalid event kind`);
    if (entry.eventKind === "medication" && (!doseText || doseText.length > HISTORICAL_MEDICATION_DOSE_MAX_LENGTH)) {
      fail(`${label} needs a literal dose of at most ${HISTORICAL_MEDICATION_DOSE_MAX_LENGTH} characters`);
    }
    if (entry.eventKind === "procedure" && doseText) fail(`${label} procedure must not have a dose`);

    const canonical = entry.canonicalDose;
    const prescription = entry.prescriptionTarget;
    if (canonical && prescription) fail(`${label} cannot target both an existing dose and a prescription`);
    if (prescription) {
      if (entry.eventKind !== "medication") fail(`${label} procedure cannot target a medication prescription`);
      if (!prescription.medicationId || !prescription.episodeId) fail(`${label} has an incomplete prescription target`);
      if (!prescription.expectedMedicationName.trim()
        || normalizedName(prescription.expectedMedicationName) !== normalizedName(medicationName)) {
        fail(`${label} prescription name does not match the reviewed event`);
      }
      if (!Number.isInteger(prescription.expectedMedicationRevision)
        || prescription.expectedMedicationRevision < 1
        || !isTimestamp(prescription.expectedEpisodeStartedAt)
        || (prescription.expectedEpisodeEndedAt != null
          && (!isTimestamp(prescription.expectedEpisodeEndedAt)
            || prescription.expectedEpisodeEndedAt < prescription.expectedEpisodeStartedAt))) {
        fail(`${label} has an invalid prescription or episode snapshot`);
      }
      if (entry.source.startedAt < prescription.expectedEpisodeStartedAt
        || (prescription.expectedEpisodeEndedAt != null
          && entry.source.startedAt > prescription.expectedEpisodeEndedAt)) {
        fail(`${label} source timestamp falls outside the reviewed episode`);
      }
    }
    if (!canonical) continue;
    if (!canonical.doseId || !canonical.medicationId || !canonical.episodeId) fail(`${label} has an incomplete canonical reference`);
    if (canonicalDoseIds.has(canonical.doseId)) fail(`${label} repeats a canonical dose`);
    canonicalDoseIds.add(canonical.doseId);
    if (!canonical.expectedMedicationName.trim()
      || normalizedName(canonical.expectedMedicationName) !== normalizedName(medicationName)) {
      fail(`${label} canonical medication name does not match the reviewed event`);
    }
    if (!isTimestamp(canonical.expectedGivenAt) || !Number.isInteger(canonical.expectedRevision) || canonical.expectedRevision < 1) {
      fail(`${label} has an invalid canonical snapshot`);
    }
    if (!canonical.expectedDoseText || canonical.expectedDoseText.length > HISTORICAL_MEDICATION_DOSE_MAX_LENGTH) {
      fail(`${label} has an invalid captured canonical dose text`);
    }
    if (canonical.timestampRelation === "exact" && canonical.expectedGivenAt !== entry.source.startedAt) {
      fail(`${label} marks unequal source and canonical timestamps as exact`);
    }
    if (canonical.timestampRelation !== "exact" && canonical.timestampRelation !== "reviewed-near") {
      fail(`${label} needs an explicit canonical timestamp relation`);
    }
    if (canonical.correctedDoseText != null) {
      const corrected = canonical.correctedDoseText.trim();
      if (!corrected || corrected.length > HISTORICAL_MEDICATION_DOSE_MAX_LENGTH) fail(`${label} has an invalid canonical correction`);
    }
  }
}

async function requireManifestScope(executor: Executor, manifest: HistoricalMedicationImportManifest): Promise<void> {
  const result = await executor.execute({
    sql: `SELECT h.id AS household_id, b.id AS baby_id
          FROM households h JOIN babies b ON b.household_id = h.id
          WHERE h.invite_code = ? AND h.id = ? AND b.id = ? LIMIT 1`,
    args: [manifest.inviteCode, manifest.expectedHouseholdId, manifest.babyId],
  });
  if (!result.rows[0]) fail("Invite, household, and baby scope do not match");
}

function expectedImportedDetails(
  householdId: string,
  babyId: string,
  entry: ReviewedHistoricalMedicationEntry,
): { identity: HistoricalMedicationImportIdentity; details: HistoricalMedicationDetails; json: string } {
  const identity = historicalMedicationImportIdentity(
    householdId,
    babyId,
    entry.source.id,
    entry.matchOrdinal,
  );
  const details: HistoricalMedicationDetails = {
    medicationName: entry.medicationName.trim(),
    doseText: entry.eventKind === "procedure" ? "" : entry.doseText.trim(),
    notes: sourceNote(entry.source.details),
    historicalMedication: {
      version: HISTORICAL_MEDICATION_VERSION,
      eventKind: entry.eventKind,
      sourceActivityId: entry.source.id,
      sourceStartedAt: entry.source.startedAt,
      sourceDetailsSha256: sourceHash(entry.source.details),
      matchOrdinal: entry.matchOrdinal,
      importKey: identity.importKey,
      revision: 1,
    },
  };
  return { identity, details, json: JSON.stringify(details) };
}

async function requireUnchangedSource(executor: Executor, entry: ReviewedHistoricalMedicationEntry): Promise<void> {
  const result = await executor.execute({
    sql: `SELECT id, baby_id, type, started_at, details, created_at, created_by
          FROM activities WHERE id = ? LIMIT 1`,
    args: [entry.source.id],
  });
  const row = result.rows[0];
  if (!row
    || String(row.baby_id) !== entry.source.babyId
    || String(row.type) !== "note"
    || Number(row.started_at) !== entry.source.startedAt
    || Number(row.created_at) !== entry.source.createdAt
    || (row.created_by == null ? null : String(row.created_by)) !== entry.source.createdBy
    || String(row.details ?? "") !== entry.source.details) {
    fail(`Source note ${entry.source.id} changed after review`);
  }
}

async function inspectCanonical(
  executor: Executor,
  manifest: HistoricalMedicationImportManifest,
  entry: ReviewedHistoricalMedicationEntry,
): Promise<HistoricalMedicationImportDisposition> {
  const canonical = entry.canonicalDose!;
  const result = await executor.execute({
    sql: `SELECT d.id, d.medication_id, d.given_at, d.dose_text, d.revision, d.deleted_at,
                 m.name AS medication_name, m.episode_id, e.baby_id, b.household_id
          FROM sick_mode_doses d
          JOIN sick_mode_medications m ON m.id = d.medication_id
          JOIN sick_mode_episodes e ON e.id = m.episode_id
          JOIN babies b ON b.id = e.baby_id
          WHERE d.id = ? LIMIT 1`,
    args: [canonical.doseId],
  });
  const row = result.rows[0];
  if (!row
    || row.deleted_at != null
    || String(row.medication_id) !== canonical.medicationId
    || String(row.episode_id) !== canonical.episodeId
    || String(row.baby_id) !== manifest.babyId
    || String(row.household_id) !== manifest.expectedHouseholdId
    || normalizedName(String(row.medication_name)) !== normalizedName(canonical.expectedMedicationName)
    || Number(row.given_at) !== canonical.expectedGivenAt) {
    fail(`Canonical dose ${canonical.doseId} no longer matches its reviewed identity`);
  }

  const desired = canonical.correctedDoseText?.trim();
  const currentRevision = Number(row.revision);
  const currentText = String(row.dose_text);
  if (!desired || desired === canonical.expectedDoseText) {
    if (currentRevision !== canonical.expectedRevision || currentText !== canonical.expectedDoseText) {
      fail(`Canonical dose ${canonical.doseId} changed after review`);
    }
    return "canonical-covered";
  }
  if (currentRevision === canonical.expectedRevision && currentText === canonical.expectedDoseText) {
    return "canonical-correction";
  }
  if (currentRevision === canonical.expectedRevision + 1 && currentText === desired) {
    return "canonical-correction-applied";
  }
  fail(`Canonical dose ${canonical.doseId} changed after review`);
}

async function inspectPrescriptionTarget(
  executor: Executor,
  manifest: HistoricalMedicationImportManifest,
  entry: ReviewedHistoricalMedicationEntry,
): Promise<{
  disposition: "canonical-dose-insert" | "canonical-dose-existing";
  identity: HistoricalMedicationCanonicalDoseIdentity;
  fingerprint?: HistoricalMedicationCanonicalDoseFingerprint;
}> {
  const target = entry.prescriptionTarget!;
  const prescriptionResult = await executor.execute({
    sql: `SELECT m.id, m.name, m.revision, m.episode_id,
                 e.started_at AS episode_started_at, e.ended_at AS episode_ended_at,
                 e.baby_id, b.household_id
          FROM sick_mode_medications m
          JOIN sick_mode_episodes e ON e.id = m.episode_id
          JOIN babies b ON b.id = e.baby_id
          WHERE m.id = ? LIMIT 1`,
    args: [target.medicationId],
  });
  const prescription = prescriptionResult.rows[0];
  const actualEndedAt = prescription?.episode_ended_at == null
    ? null
    : Number(prescription.episode_ended_at);
  if (!prescription
    || String(prescription.episode_id) !== target.episodeId
    || String(prescription.baby_id) !== manifest.babyId
    || String(prescription.household_id) !== manifest.expectedHouseholdId
    || normalizedName(String(prescription.name)) !== normalizedName(target.expectedMedicationName)
    || Number(prescription.revision) !== target.expectedMedicationRevision
    || Number(prescription.episode_started_at) !== target.expectedEpisodeStartedAt
    || actualEndedAt !== target.expectedEpisodeEndedAt) {
    fail(`Prescription ${target.medicationId} or its episode changed after review`);
  }
  if (entry.source.startedAt < Number(prescription.episode_started_at)
    || (actualEndedAt != null && entry.source.startedAt > actualEndedAt)) {
    fail(`Source note ${entry.source.id} falls outside its reviewed episode`);
  }

  const identity = historicalMedicationCanonicalDoseIdentity(
    manifest.expectedHouseholdId,
    manifest.babyId,
    entry.source.id,
    entry.matchOrdinal,
  );
  const existingResult = await executor.execute({
    sql: `SELECT id, medication_id, given_at, dose_text, given_by, request_id,
                 created_at, updated_at, revision, deleted_at, deleted_by
          FROM sick_mode_doses WHERE id = ? OR request_id = ?`,
    args: [identity.doseId, identity.requestId],
  });
  if (existingResult.rows.length === 0) {
    return { disposition: "canonical-dose-insert", identity };
  }
  if (existingResult.rows.length !== 1) fail(`Deterministic canonical dose identity collision for source note ${entry.source.id}`);
  const dose = existingResult.rows[0];
  const exact = String(dose.id) === identity.doseId
    && String(dose.request_id) === identity.requestId
    && String(dose.medication_id) === target.medicationId
    && Number(dose.given_at) === entry.source.startedAt
    && String(dose.dose_text) === entry.doseText.trim()
    && (dose.given_by == null ? null : String(dose.given_by)) === entry.source.createdBy
    && Number(dose.created_at) === entry.source.createdAt
    && isTimestamp(Number(dose.updated_at))
    && Number(dose.revision) === 1
    && dose.deleted_at == null
    && dose.deleted_by == null;
  if (!exact) fail(`Deterministic canonical dose identity collision for source note ${entry.source.id}`);
  return {
    disposition: "canonical-dose-existing",
    identity,
    fingerprint: {
      ...identity,
      updatedAt: Number(dose.updated_at),
      revision: 1,
    },
  };
}

async function inspectManifest(
  executor: Executor,
  manifest: HistoricalMedicationImportManifest,
): Promise<{ plan: HistoricalMedicationImportPlan; inspected: InspectedEntry[] }> {
  validateManifest(manifest);
  await requireManifestScope(executor, manifest);
  const inspected: InspectedEntry[] = [];

  for (const entry of manifest.entries) {
    await requireUnchangedSource(executor, entry);
    const expected = expectedImportedDetails(manifest.expectedHouseholdId, manifest.babyId, entry);
    if (entry.prescriptionTarget) {
      const target = await inspectPrescriptionTarget(executor, manifest, entry);
      inspected.push({
        manifestEntry: entry,
        details: null,
        detailsJson: null,
        planEntry: {
          sourceActivityId: entry.source.id,
          matchOrdinal: entry.matchOrdinal,
          activityId: null,
          doseId: target.identity.doseId,
          importKey: expected.identity.importKey,
          disposition: target.disposition,
          ...(target.fingerprint ? { canonicalDoseFingerprint: target.fingerprint } : {}),
        },
      });
      continue;
    }
    if (entry.canonicalDose) {
      const disposition = await inspectCanonical(executor, manifest, entry);
      inspected.push({
        manifestEntry: entry,
        details: null,
        detailsJson: null,
        planEntry: {
          sourceActivityId: entry.source.id,
          matchOrdinal: entry.matchOrdinal,
          activityId: null,
          doseId: entry.canonicalDose.doseId,
          importKey: expected.identity.importKey,
          disposition,
        },
      });
      continue;
    }

    const existing = await executor.execute({
      sql: `SELECT id, baby_id, type, started_at, ended_at, details, created_at, created_by
            FROM activities WHERE id = ? LIMIT 1`,
      args: [expected.identity.activityId],
    });
    let disposition: HistoricalMedicationImportDisposition = "insert";
    if (existing.rows[0]) {
      const row = existing.rows[0];
      const exact = String(row.baby_id) === manifest.babyId
        && String(row.type) === "medication"
        && Number(row.started_at) === entry.source.startedAt
        && row.ended_at == null
        && String(row.details ?? "") === expected.json
        && Number(row.created_at) === entry.source.createdAt
        && (row.created_by == null ? null : String(row.created_by)) === entry.source.createdBy;
      if (!exact) fail(`Deterministic import ID collision for source note ${entry.source.id}`);
      disposition = "existing";
    }
    inspected.push({
      manifestEntry: entry,
      details: expected.details,
      detailsJson: expected.json,
      planEntry: {
        sourceActivityId: entry.source.id,
        matchOrdinal: entry.matchOrdinal,
        activityId: expected.identity.activityId,
        doseId: null,
        importKey: expected.identity.importKey,
        disposition,
      },
    });
  }

  const entries = inspected.map((item) => item.planEntry);
  return {
    inspected,
    plan: {
      householdId: manifest.expectedHouseholdId,
      babyId: manifest.babyId,
      entries,
      insertCount: entries.filter((entry) => entry.disposition === "insert").length,
      existingCount: entries.filter((entry) => entry.disposition === "existing").length,
      canonicalCoveredCount: entries.filter((entry) => entry.disposition === "canonical-covered"
        || entry.disposition === "canonical-correction-applied").length,
      canonicalCorrectionCount: entries.filter((entry) => entry.disposition === "canonical-correction").length,
      canonicalDoseInsertCount: entries.filter((entry) => entry.disposition === "canonical-dose-insert").length,
      canonicalDoseExistingCount: entries.filter((entry) => entry.disposition === "canonical-dose-existing").length,
    },
  };
}

export async function planHistoricalMedicationImport(
  db: Executor,
  manifest: HistoricalMedicationImportManifest,
): Promise<HistoricalMedicationImportPlan> {
  return (await inspectManifest(db, manifest)).plan;
}

export async function applyHistoricalMedicationImport(
  db: TransactionOwner,
  manifest: HistoricalMedicationImportManifest,
  { now = Date.now() }: { now?: number } = {},
): Promise<HistoricalMedicationImportPlan> {
  if (!isTimestamp(now)) fail("Import timestamp is invalid");
  const tx = await db.transaction("write");
  try {
    const { inspected } = await inspectManifest(tx, manifest);
    for (const item of inspected) {
      const entry = item.manifestEntry;
      if (item.planEntry.disposition === "insert") {
        await tx.execute({
          sql: `INSERT INTO activities
                (id, baby_id, type, started_at, ended_at, details, created_at, created_by)
                VALUES (?, ?, 'medication', ?, NULL, ?, ?, ?)`,
          args: [
            item.planEntry.activityId!, manifest.babyId, entry.source.startedAt,
            item.detailsJson!, entry.source.createdAt, entry.source.createdBy,
          ],
        });
      } else if (item.planEntry.disposition === "canonical-dose-insert") {
        const target = entry.prescriptionTarget!;
        const identity = historicalMedicationCanonicalDoseIdentity(
          manifest.expectedHouseholdId,
          manifest.babyId,
          entry.source.id,
          entry.matchOrdinal,
        );
        await tx.execute({
          sql: `INSERT INTO sick_mode_doses
                (id, medication_id, given_at, dose_text, given_by, request_id,
                 created_at, updated_at, revision, deleted_at, deleted_by)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, NULL, NULL)`,
          args: [
            identity.doseId, target.medicationId, entry.source.startedAt,
            entry.doseText.trim(), entry.source.createdBy, identity.requestId,
            entry.source.createdAt, now,
          ],
        });
      } else if (item.planEntry.disposition === "canonical-correction") {
        const canonical = entry.canonicalDose!;
        const corrected = canonical.correctedDoseText!.trim();
        const update = await tx.execute({
          sql: `UPDATE sick_mode_doses
                SET dose_text = ?, updated_at = ?, revision = revision + 1
                WHERE id = ? AND medication_id = ? AND given_at = ? AND dose_text = ?
                  AND revision = ? AND deleted_at IS NULL`,
          args: [
            corrected, now, canonical.doseId, canonical.medicationId,
            canonical.expectedGivenAt, canonical.expectedDoseText, canonical.expectedRevision,
          ],
        });
        if ((update.rowsAffected ?? 0) !== 1) fail(`Canonical dose ${canonical.doseId} changed during import`);
      }
    }
    const after = (await inspectManifest(tx, manifest)).plan;
    if (after.insertCount !== 0
      || after.canonicalCorrectionCount !== 0
      || after.canonicalDoseInsertCount !== 0) {
      fail("Import verification did not reach an idempotent state");
    }
    await tx.commit();
    return after;
  } catch (error) {
    try { await tx.rollback(); } catch {}
    throw error;
  } finally {
    tx.close();
  }
}

export async function verifyHistoricalMedicationImport(
  db: Executor,
  manifest: HistoricalMedicationImportManifest,
): Promise<HistoricalMedicationImportVerification> {
  const { plan } = await inspectManifest(db, manifest);
  if (plan.insertCount !== 0
    || plan.canonicalCorrectionCount !== 0
    || plan.canonicalDoseInsertCount !== 0) {
    fail("Historical medication import is incomplete");
  }
  const canonicalCorrectedCount = plan.entries.filter((entry) => entry.disposition === "canonical-correction-applied").length;
  return {
    verified: true,
    householdId: plan.householdId,
    babyId: plan.babyId,
    importedCount: plan.existingCount,
    canonicalImportedCount: plan.canonicalDoseExistingCount,
    canonicalCoveredCount: plan.canonicalCoveredCount,
    canonicalCorrectedCount,
  };
}

export async function rollbackHistoricalMedicationImport(
  db: TransactionOwner,
  manifest: HistoricalMedicationImportManifest,
  {
    restoreCanonicalCorrections = false,
    canonicalImportFingerprints = [],
    now = Date.now(),
  }: {
    restoreCanonicalCorrections?: boolean;
    canonicalImportFingerprints?: readonly HistoricalMedicationCanonicalDoseFingerprint[];
    now?: number;
  } = {},
): Promise<{ rolledBackCount: number; rolledBackCanonicalDoseCount: number; restoredCanonicalCount: number }> {
  if (!isTimestamp(now)) fail("Rollback timestamp is invalid");
  validateManifest(manifest);
  const tx = await db.transaction("write");
  try {
    await requireManifestScope(tx, manifest);
    let rolledBackCount = 0;
    let rolledBackCanonicalDoseCount = 0;
    let restoredCanonicalCount = 0;
    const fingerprintByDoseId = new Map<string, HistoricalMedicationCanonicalDoseFingerprint>();
    for (const fingerprint of canonicalImportFingerprints) {
      if (fingerprintByDoseId.has(fingerprint.doseId)) fail(`Duplicate rollback fingerprint for ${fingerprint.doseId}`);
      fingerprintByDoseId.set(fingerprint.doseId, fingerprint);
    }

    // Validate every target before changing any target.
    const importedTargets: Array<{ id: string; details: string; entry: ReviewedHistoricalMedicationEntry }> = [];
    const importedDoseTargets: Array<{
      entry: ReviewedHistoricalMedicationEntry;
      identity: HistoricalMedicationCanonicalDoseIdentity;
      fingerprint: HistoricalMedicationCanonicalDoseFingerprint;
    }> = [];
    const canonicalTargets: ReviewedHistoricalMedicationEntry[] = [];
    for (const entry of manifest.entries) {
      const expected = expectedImportedDetails(manifest.expectedHouseholdId, manifest.babyId, entry);
      if (entry.prescriptionTarget) {
        const target = entry.prescriptionTarget;
        const identity = historicalMedicationCanonicalDoseIdentity(
          manifest.expectedHouseholdId,
          manifest.babyId,
          entry.source.id,
          entry.matchOrdinal,
        );
        const result = await tx.execute({
          sql: `SELECT d.id, d.medication_id, d.given_at, d.dose_text, d.given_by,
                       d.request_id, d.created_at, d.updated_at, d.revision,
                       d.deleted_at, d.deleted_by, m.episode_id, m.name AS medication_name,
                       e.baby_id, b.household_id
                FROM sick_mode_doses d
                JOIN sick_mode_medications m ON m.id = d.medication_id
                JOIN sick_mode_episodes e ON e.id = m.episode_id
                JOIN babies b ON b.id = e.baby_id
                WHERE d.id = ? OR d.request_id = ?`,
          args: [identity.doseId, identity.requestId],
        });
        if (result.rows.length === 0) continue; // Already rolled back.
        if (result.rows.length !== 1) fail(`Imported canonical dose ${identity.doseId} cannot be safely rolled back`);
        const fingerprint = fingerprintByDoseId.get(identity.doseId);
        if (!fingerprint
          || fingerprint.requestId !== identity.requestId
          || fingerprint.revision !== 1
          || !isTimestamp(fingerprint.updatedAt)) {
          fail(`Exact rollback fingerprint is required for imported canonical dose ${identity.doseId}`);
        }
        const row = result.rows[0];
        const exact = String(row.id) === identity.doseId
          && String(row.request_id) === identity.requestId
          && String(row.medication_id) === target.medicationId
          && String(row.episode_id) === target.episodeId
          && String(row.baby_id) === manifest.babyId
          && String(row.household_id) === manifest.expectedHouseholdId
          && normalizedName(String(row.medication_name)) === normalizedName(target.expectedMedicationName)
          && Number(row.given_at) === entry.source.startedAt
          && String(row.dose_text) === entry.doseText.trim()
          && (row.given_by == null ? null : String(row.given_by)) === entry.source.createdBy
          && Number(row.created_at) === entry.source.createdAt
          && Number(row.updated_at) === fingerprint.updatedAt
          && Number(row.revision) === fingerprint.revision
          && row.deleted_at == null
          && row.deleted_by == null;
        if (!exact) fail(`Imported canonical dose ${identity.doseId} changed after import`);
        importedDoseTargets.push({ entry, identity, fingerprint });
        continue;
      }
      if (entry.canonicalDose) {
        const canonical = entry.canonicalDose;
        const desired = canonical.correctedDoseText?.trim();
        if (!desired || desired === canonical.expectedDoseText) continue;
        const result = await tx.execute({
          sql: `SELECT d.dose_text, d.revision, d.given_at, d.deleted_at, d.medication_id,
                       m.episode_id, m.name AS medication_name, e.baby_id, b.household_id
                FROM sick_mode_doses d
                JOIN sick_mode_medications m ON m.id = d.medication_id
                JOIN sick_mode_episodes e ON e.id = m.episode_id
                JOIN babies b ON b.id = e.baby_id WHERE d.id = ? LIMIT 1`,
          args: [canonical.doseId],
        });
        const row = result.rows[0];
        const identityMatches = row && row.deleted_at == null
          && String(row.medication_id) === canonical.medicationId
          && String(row.episode_id) === canonical.episodeId
          && String(row.baby_id) === manifest.babyId
          && String(row.household_id) === manifest.expectedHouseholdId
          && normalizedName(String(row.medication_name)) === normalizedName(canonical.expectedMedicationName)
          && Number(row.given_at) === canonical.expectedGivenAt;
        if (!identityMatches) fail(`Canonical dose ${canonical.doseId} cannot be safely rolled back`);
        const revision = Number(row!.revision);
        const text = String(row!.dose_text);
        if (revision === canonical.expectedRevision && text === canonical.expectedDoseText) continue;
        if (revision === canonical.expectedRevision + 2 && text === canonical.expectedDoseText) continue;
        if (revision !== canonical.expectedRevision + 1 || text !== desired) {
          fail(`Canonical dose ${canonical.doseId} changed after import`);
        }
        if (!restoreCanonicalCorrections) {
          fail("Canonical corrections require explicit restoreCanonicalCorrections approval");
        }
        canonicalTargets.push(entry);
        continue;
      }

      const result = await tx.execute({
        sql: `SELECT baby_id, type, started_at, ended_at, details, created_at, created_by
              FROM activities WHERE id = ? LIMIT 1`,
        args: [expected.identity.activityId],
      });
      if (!result.rows[0]) continue; // Already rolled back.
      const row = result.rows[0];
      const exact = String(row.baby_id) === manifest.babyId
        && String(row.type) === "medication"
        && Number(row.started_at) === entry.source.startedAt
        && row.ended_at == null
        && String(row.details ?? "") === expected.json
        && Number(row.created_at) === entry.source.createdAt
        && (row.created_by == null ? null : String(row.created_by)) === entry.source.createdBy;
      if (!exact) fail(`Imported activity ${expected.identity.activityId} changed after import`);
      importedTargets.push({ id: expected.identity.activityId, details: expected.json, entry });
    }

    for (const target of importedTargets) {
      const removed = await tx.execute({
        sql: `DELETE FROM activities
              WHERE id = ? AND baby_id = ? AND type = 'medication' AND started_at = ?
                AND details = ? AND created_at = ?
                AND ((created_by IS NULL AND ? IS NULL) OR created_by = ?)`,
        args: [
          target.id, manifest.babyId, target.entry.source.startedAt, target.details,
          target.entry.source.createdAt, target.entry.source.createdBy, target.entry.source.createdBy,
        ],
      });
      if ((removed.rowsAffected ?? 0) !== 1) fail(`Imported activity ${target.id} changed during rollback`);
      rolledBackCount++;
    }
    for (const target of importedDoseTargets) {
      const removed = await tx.execute({
        sql: `DELETE FROM sick_mode_doses
              WHERE id = ? AND medication_id = ? AND given_at = ? AND dose_text = ?
                AND request_id = ? AND created_at = ? AND updated_at = ? AND revision = 1
                AND deleted_at IS NULL AND deleted_by IS NULL
                AND ((given_by IS NULL AND ? IS NULL) OR given_by = ?)`,
        args: [
          target.identity.doseId, target.entry.prescriptionTarget!.medicationId,
          target.entry.source.startedAt, target.entry.doseText.trim(), target.identity.requestId,
          target.entry.source.createdAt, target.fingerprint.updatedAt,
          target.entry.source.createdBy, target.entry.source.createdBy,
        ],
      });
      if ((removed.rowsAffected ?? 0) !== 1) {
        fail(`Imported canonical dose ${target.identity.doseId} changed during rollback`);
      }
      rolledBackCanonicalDoseCount++;
    }
    for (const entry of canonicalTargets) {
      const canonical = entry.canonicalDose!;
      const desired = canonical.correctedDoseText!.trim();
      const restored = await tx.execute({
        sql: `UPDATE sick_mode_doses
              SET dose_text = ?, updated_at = ?, revision = revision + 1
              WHERE id = ? AND medication_id = ? AND given_at = ? AND dose_text = ?
                AND revision = ? AND deleted_at IS NULL`,
        args: [
          canonical.expectedDoseText, now, canonical.doseId, canonical.medicationId,
          canonical.expectedGivenAt, desired, canonical.expectedRevision + 1,
        ],
      });
      if ((restored.rowsAffected ?? 0) !== 1) fail(`Canonical dose ${canonical.doseId} changed during rollback`);
      restoredCanonicalCount++;
    }

    await tx.commit();
    return { rolledBackCount, rolledBackCanonicalDoseCount, restoredCanonicalCount };
  } catch (error) {
    try { await tx.rollback(); } catch {}
    throw error;
  } finally {
    tx.close();
  }
}
