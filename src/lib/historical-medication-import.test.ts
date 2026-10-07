import assert from "node:assert/strict";
import test from "node:test";
import { createClient, type Client } from "@libsql/client";

import { applySickModeSchema } from "@/db/sick-mode-schema";
import {
  HistoricalMedicationImportError,
  applyHistoricalMedicationImport,
  historicalMedicationCanonicalDoseIdentity,
  historicalMedicationImportIdentity,
  planHistoricalMedicationImport,
  rollbackHistoricalMedicationImport,
  verifyHistoricalMedicationImport,
  type HistoricalMedicationImportManifest,
  type ReviewedHistoricalMedicationEntry,
  type ReviewedPrescriptionTarget,
} from "./historical-medication-import";

const ts = (time: string) => Date.parse(`2026-10-06T${time}:00+08:00`);

async function openFixture(prefix: string) {
  const path = `/tmp/mcphee-historical-import-${prefix}-${process.pid}-${Math.random().toString(36).slice(2)}.db`;
  const client = createClient({ url: `file:${path}` });
  await client.batch([
    "CREATE TABLE households (id TEXT PRIMARY KEY, invite_code TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL)",
    "CREATE TABLE users (id TEXT PRIMARY KEY, household_id TEXT NOT NULL, name TEXT NOT NULL, created_at INTEGER NOT NULL)",
    "CREATE TABLE babies (id TEXT PRIMARY KEY, household_id TEXT NOT NULL, name TEXT NOT NULL, birth_date INTEGER, created_at INTEGER NOT NULL)",
    "CREATE TABLE activities (id TEXT PRIMARY KEY, baby_id TEXT NOT NULL, type TEXT NOT NULL, started_at INTEGER NOT NULL, ended_at INTEGER, details TEXT, created_at INTEGER NOT NULL, created_by TEXT)",
  ], "write");
  await client.batch([
    { sql: "INSERT INTO households VALUES (?, ?, ?)", args: ["house-1", "ABC123", ts("00:00")] },
    { sql: "INSERT INTO households VALUES (?, ?, ?)", args: ["house-2", "XYZ789", ts("00:00")] },
    { sql: "INSERT INTO users VALUES (?, ?, ?, ?)", args: ["user-1", "house-1", "Parent One", ts("00:00")] },
    { sql: "INSERT INTO babies VALUES (?, ?, ?, NULL, ?)", args: ["baby-1", "house-1", "Baby One", ts("00:00")] },
    { sql: "INSERT INTO babies VALUES (?, ?, ?, NULL, ?)", args: ["baby-2", "house-2", "Baby Two", ts("00:00")] },
  ], "write");
  await applySickModeSchema(client);
  return client;
}

function noteStatement(id: string, at: number, note: string) {
  const details = JSON.stringify({ notes: note });
  return {
    details,
    statement: {
      sql: "INSERT INTO activities VALUES (?, 'baby-1', 'note', ?, NULL, ?, ?, 'Parent One')",
      args: [id, at, details, at + 1_000],
    },
  };
}

async function seedReviewedHistory(client: Client) {
  const paracetamol = noteStatement("note-para", ts("08:00"), "Paracetamol 3.5ml");
  const suction = noteStatement("note-suction", ts("09:00"), "Suction completed");
  const ibuprofen = noteStatement("note-ibuprofen", ts("10:00"), "Ibuprofen 3ml");
  const tamiflu = noteStatement("note-tamiflu", ts("13:19"), "Tamiflu 3.5/5ml diluted into 35ml total volume BM");
  await client.batch([
    paracetamol.statement,
    suction.statement,
    ibuprofen.statement,
    tamiflu.statement,
    {
      sql: "INSERT INTO activities VALUES (?, 'baby-1', 'bottlefeed', ?, NULL, ?, ?, 'Parent One')",
      args: ["milk-1", ts("11:00"), JSON.stringify({ amount: 90, milkType: "breastmilk" }), ts("11:00")],
    },
    {
      sql: `INSERT INTO sick_mode_episodes
            (id, baby_id, started_at, ended_at, baseline_daily_ml, baseline_kind,
             baseline_available_day_count, baseline_source_days, created_at, created_by, ended_by)
            VALUES (?, 'baby-1', ?, NULL, 800, 'manual', 0, '[]', ?, 'Parent One', NULL)`,
      args: ["episode-1", ts("07:00"), ts("07:00")],
    },
    {
      sql: `INSERT INTO sick_mode_medications
            (id, episode_id, name, dose_text, as_needed, min_interval_minutes,
             max_interval_minutes, created_at, created_by, updated_at, revision)
            VALUES ('med-ibuprofen', 'episode-1', 'Ibuprofen', '3 ml', 1, NULL, NULL, ?, 'Parent One', ?, 1)`,
      args: [ts("07:00"), ts("07:00")],
    },
    {
      sql: `INSERT INTO sick_mode_medications
            (id, episode_id, name, dose_text, as_needed, min_interval_minutes,
             max_interval_minutes, created_at, created_by, updated_at, revision)
            VALUES ('med-tamiflu', 'episode-1', 'Tamiflu', 'Prescribed', 0, 720, NULL, ?, 'Parent One', ?, 1)`,
      args: [ts("07:00"), ts("07:00")],
    },
    {
      sql: `INSERT INTO sick_mode_doses
            (id, medication_id, given_at, dose_text, given_by, request_id,
             created_at, updated_at, revision, deleted_at, deleted_by)
            VALUES ('dose-ibuprofen', 'med-ibuprofen', ?, '3mg', 'Parent One',
                    'req-ibu', ?, ?, 2, NULL, NULL)`,
      args: [ts("10:00"), ts("10:00"), ts("10:00")],
    },
    {
      sql: `INSERT INTO sick_mode_doses
            (id, medication_id, given_at, dose_text, given_by, request_id,
             created_at, updated_at, revision, deleted_at, deleted_by)
            VALUES ('dose-tamiflu', 'med-tamiflu', ?, '3.5/5ml', 'Parent One',
                    'req-tami', ?, ?, 4, NULL, NULL)`,
      args: [ts("13:14"), ts("13:14"), ts("13:14")],
    },
  ], "write");
  return { paracetamol, suction, ibuprofen, tamiflu };
}

function manifestFor(notes: Awaited<ReturnType<typeof seedReviewedHistory>>): HistoricalMedicationImportManifest {
  const source = (id: string, at: number, details: string) => ({
    id,
    babyId: "baby-1",
    type: "note" as const,
    startedAt: at,
    createdAt: at + 1_000,
    createdBy: "Parent One",
    details,
  });
  return {
    version: 1,
    inviteCode: "ABC123",
    expectedHouseholdId: "house-1",
    babyId: "baby-1",
    entries: [
      {
        source: source("note-para", ts("08:00"), notes.paracetamol.details),
        medicationName: "Paracetamol",
        doseText: "3.5 ml",
        eventKind: "medication",
        matchOrdinal: 0,
      },
      {
        source: source("note-suction", ts("09:00"), notes.suction.details),
        medicationName: "Suction",
        doseText: "",
        eventKind: "procedure",
        matchOrdinal: 0,
      },
      {
        source: source("note-ibuprofen", ts("10:00"), notes.ibuprofen.details),
        medicationName: "Ibuprofen",
        doseText: "3 ml",
        eventKind: "medication",
        matchOrdinal: 0,
        canonicalDose: {
          doseId: "dose-ibuprofen",
          medicationId: "med-ibuprofen",
          episodeId: "episode-1",
          expectedMedicationName: "Ibuprofen",
          expectedGivenAt: ts("10:00"),
          expectedRevision: 2,
          expectedDoseText: "3mg",
          correctedDoseText: "3 ml",
          timestampRelation: "exact",
        },
      },
      {
        source: source("note-tamiflu", ts("13:19"), notes.tamiflu.details),
        medicationName: "Tamiflu",
        doseText: "3.5/5ml diluted into 35ml total volume BM",
        eventKind: "medication",
        matchOrdinal: 0,
        canonicalDose: {
          doseId: "dose-tamiflu",
          medicationId: "med-tamiflu",
          episodeId: "episode-1",
          expectedMedicationName: "Tamiflu",
          expectedGivenAt: ts("13:14"),
          expectedRevision: 4,
          expectedDoseText: "3.5/5ml",
          correctedDoseText: "3.5/5ml diluted into 35ml total volume BM",
          timestampRelation: "reviewed-near",
        },
      },
    ],
  };
}

async function snapshots(client: Client) {
  const sourceNotes = (await client.execute("SELECT * FROM activities WHERE type = 'note' ORDER BY id")).rows.map(row => ({ ...row }));
  const milk = (await client.execute("SELECT * FROM activities WHERE type = 'bottlefeed' ORDER BY id")).rows.map(row => ({ ...row }));
  const episodes = (await client.execute("SELECT * FROM sick_mode_episodes ORDER BY id")).rows.map(row => ({ ...row }));
  const medications = (await client.execute("SELECT * FROM sick_mode_medications ORDER BY id")).rows.map(row => ({ ...row }));
  return { sourceNotes, milk, episodes, medications };
}

test("reviewed import is deterministic, idempotent, preserves source care data, and corrects only captured canonical text", async () => {
  const client = await openFixture("apply");
  try {
    const notes = await seedReviewedHistory(client);
    const manifest = manifestFor(notes);
    const before = await snapshots(client);

    const plan = await planHistoricalMedicationImport(client, manifest);
    assert.equal(plan.insertCount, 2);
    assert.equal(plan.canonicalCorrectionCount, 2);
    assert.equal(plan.canonicalCoveredCount, 0);

    const applied = await applyHistoricalMedicationImport(client, manifest, { now: ts("16:00") });
    assert.equal(applied.insertCount, 0);
    assert.equal(applied.existingCount, 2);
    assert.equal(applied.canonicalCorrectionCount, 0);
    assert.equal(applied.canonicalCoveredCount, 2);
    assert.deepEqual(await snapshots(client), before, "notes, milk, episodes, and prescriptions remain byte-for-byte unchanged");

    const imported = await client.execute("SELECT * FROM activities WHERE type = 'medication' ORDER BY started_at");
    assert.equal(imported.rows.length, 2);
    assert.equal(Number(imported.rows[0].created_at), ts("08:00") + 1_000);
    assert.equal(String(imported.rows[0].created_by), "Parent One");
    assert.equal(JSON.parse(String(imported.rows[0].details)).notes, "Paracetamol 3.5ml");
    assert.equal(JSON.parse(String(imported.rows[1].details)).historicalMedication.eventKind, "procedure");

    const doses = await client.execute("SELECT id, given_at, dose_text, given_by, revision FROM sick_mode_doses ORDER BY id");
    const ibuprofen = doses.rows.find(row => row.id === "dose-ibuprofen")!;
    const tamiflu = doses.rows.find(row => row.id === "dose-tamiflu")!;
    assert.deepEqual(
      { at: Number(ibuprofen.given_at), text: String(ibuprofen.dose_text), by: String(ibuprofen.given_by), revision: Number(ibuprofen.revision) },
      { at: ts("10:00"), text: "3 ml", by: "Parent One", revision: 3 },
    );
    assert.deepEqual(
      { at: Number(tamiflu.given_at), text: String(tamiflu.dose_text), by: String(tamiflu.given_by), revision: Number(tamiflu.revision) },
      { at: ts("13:14"), text: "3.5/5ml diluted into 35ml total volume BM", by: "Parent One", revision: 5 },
    );

    const verified = await verifyHistoricalMedicationImport(client, manifest);
    assert.deepEqual(
      { imported: verified.importedCount, canonical: verified.canonicalCoveredCount, corrected: verified.canonicalCorrectedCount },
      { imported: 2, canonical: 2, corrected: 2 },
    );
    await applyHistoricalMedicationImport(client, manifest, { now: ts("17:00") });
    assert.equal(Number((await client.execute("SELECT COUNT(*) AS n FROM activities WHERE type = 'medication'")).rows[0].n), 2);
    assert.equal(Number((await client.execute("SELECT revision FROM sick_mode_doses WHERE id = 'dose-ibuprofen'")).rows[0].revision), 3, "rerun does not increment a corrected dose again");

    await assert.rejects(
      rollbackHistoricalMedicationImport(client, manifest),
      /explicit restoreCanonicalCorrections approval/,
    );
    assert.equal(Number((await client.execute("SELECT COUNT(*) AS n FROM activities WHERE type = 'medication'")).rows[0].n), 2, "failed rollback is atomic");

    const rolledBack = await rollbackHistoricalMedicationImport(client, manifest, {
      restoreCanonicalCorrections: true,
      now: ts("18:00"),
    });
    assert.deepEqual(rolledBack, {
      rolledBackCount: 2,
      rolledBackCanonicalDoseCount: 0,
      restoredCanonicalCount: 2,
    });
    assert.equal(Number((await client.execute("SELECT COUNT(*) AS n FROM activities WHERE type = 'medication'")).rows[0].n), 0);
    assert.deepEqual(await snapshots(client), before);
    const restored = await client.execute("SELECT id, dose_text, revision, given_at, given_by FROM sick_mode_doses ORDER BY id");
    assert.equal(String(restored.rows.find(row => row.id === "dose-ibuprofen")!.dose_text), "3mg");
    assert.equal(Number(restored.rows.find(row => row.id === "dose-ibuprofen")!.revision), 4);
    assert.equal(Number(restored.rows.find(row => row.id === "dose-tamiflu")!.given_at), ts("13:14"));
    assert.equal(String(restored.rows.find(row => row.id === "dose-tamiflu")!.given_by), "Parent One");
  } finally {
    client.close();
  }
});

test("reviewed notes inside an existing episode become canonical doses on an existing prescription", async () => {
  const client = await openFixture("prescription-target");
  try {
    const notes = await seedReviewedHistory(client);
    const oldStartedAt = Date.parse("2026-10-05T06:00:00+08:00");
    const oldDetails = JSON.stringify({ notes: "Paracetamol 3.5ml before this illness" });
    await client.batch([
      {
        sql: "INSERT INTO activities VALUES ('note-old', 'baby-1', 'note', ?, NULL, ?, ?, 'Parent One')",
        args: [oldStartedAt, oldDetails, oldStartedAt + 1_000],
      },
      {
        sql: `INSERT INTO sick_mode_medications
              (id, episode_id, name, dose_text, as_needed, min_interval_minutes,
               max_interval_minutes, created_at, created_by, updated_at, revision)
              VALUES ('med-paracetamol', 'episode-1', 'Paracetamol', '3.5 ml', 1,
                      240, 360, ?, 'Parent One', ?, 7)`,
        args: [ts("07:05"), ts("07:05")],
      },
    ], "write");
    const manifest: HistoricalMedicationImportManifest = {
      version: 1,
      inviteCode: "ABC123",
      expectedHouseholdId: "house-1",
      babyId: "baby-1",
      entries: [
        {
          source: {
            id: "note-old", babyId: "baby-1", type: "note", startedAt: oldStartedAt,
            createdAt: oldStartedAt + 1_000, createdBy: "Parent One", details: oldDetails,
          },
          medicationName: "Paracetamol",
          doseText: "3.5 ml",
          eventKind: "medication",
          matchOrdinal: 0,
        },
        {
          source: {
            id: "note-para", babyId: "baby-1", type: "note", startedAt: ts("08:00"),
            createdAt: ts("08:00") + 1_000, createdBy: "Parent One", details: notes.paracetamol.details,
          },
          medicationName: "Paracetamol",
          doseText: "3.5 ml",
          eventKind: "medication",
          matchOrdinal: 0,
          prescriptionTarget: {
            medicationId: "med-paracetamol",
            episodeId: "episode-1",
            expectedMedicationName: "Paracetamol",
            expectedMedicationRevision: 7,
            expectedEpisodeStartedAt: ts("07:00"),
            expectedEpisodeEndedAt: null,
          },
        },
      ],
    };
    const episodesBefore = (await client.execute("SELECT * FROM sick_mode_episodes ORDER BY id")).rows.map(row => ({ ...row }));
    const prescriptionsBefore = (await client.execute("SELECT * FROM sick_mode_medications ORDER BY id")).rows.map(row => ({ ...row }));
    const sourceBefore = (await client.execute("SELECT * FROM activities WHERE type = 'note' ORDER BY id")).rows.map(row => ({ ...row }));

    const plan = await planHistoricalMedicationImport(client, manifest);
    assert.equal(plan.insertCount, 1);
    assert.equal(plan.canonicalDoseInsertCount, 1);
    assert.equal(plan.canonicalDoseExistingCount, 0);
    const applied = await applyHistoricalMedicationImport(client, manifest, { now: ts("16:30") });
    assert.equal(applied.existingCount, 1);
    assert.equal(applied.canonicalDoseInsertCount, 0);
    assert.equal(applied.canonicalDoseExistingCount, 1);
    const dosePlan = applied.entries.find(entry => entry.disposition === "canonical-dose-existing")!;
    assert.ok(dosePlan.canonicalDoseFingerprint);

    const importedDose = await client.execute({
      sql: "SELECT * FROM sick_mode_doses WHERE id = ?",
      args: [dosePlan.doseId!],
    });
    assert.equal(importedDose.rows.length, 1);
    assert.equal(String(importedDose.rows[0].medication_id), "med-paracetamol");
    assert.equal(Number(importedDose.rows[0].given_at), ts("08:00"));
    assert.equal(String(importedDose.rows[0].dose_text), "3.5 ml");
    assert.equal(String(importedDose.rows[0].given_by), "Parent One");
    assert.equal(Number(importedDose.rows[0].created_at), ts("08:00") + 1_000);
    assert.equal(Number(importedDose.rows[0].updated_at), ts("16:30"));
    assert.equal(Number(importedDose.rows[0].revision), 1);

    const latestHealthDose = await client.execute({
      sql: `SELECT given_at, dose_text FROM sick_mode_doses
            WHERE medication_id = 'med-paracetamol' AND deleted_at IS NULL
            ORDER BY given_at DESC, created_at DESC, id DESC LIMIT 1`,
      args: [],
    });
    assert.equal(Number(latestHealthDose.rows[0].given_at), ts("08:00"), "health latest-dose query sees converted history");
    assert.deepEqual((await client.execute("SELECT * FROM sick_mode_episodes ORDER BY id")).rows.map(row => ({ ...row })), episodesBefore);
    assert.deepEqual((await client.execute("SELECT * FROM sick_mode_medications ORDER BY id")).rows.map(row => ({ ...row })), prescriptionsBefore);
    assert.deepEqual((await client.execute("SELECT * FROM activities WHERE type = 'note' ORDER BY id")).rows.map(row => ({ ...row })), sourceBefore);

    await applyHistoricalMedicationImport(client, manifest, { now: ts("17:00") });
    assert.equal(Number((await client.execute({ sql: "SELECT COUNT(*) AS n FROM sick_mode_doses WHERE id = ?", args: [dosePlan.doseId!] })).rows[0].n), 1);
    const verified = await verifyHistoricalMedicationImport(client, manifest);
    assert.equal(verified.importedCount, 1);
    assert.equal(verified.canonicalImportedCount, 1);

    await assert.rejects(
      rollbackHistoricalMedicationImport(client, manifest),
      /Exact rollback fingerprint is required/,
    );
    assert.equal(Number((await client.execute("SELECT COUNT(*) AS n FROM activities WHERE type = 'medication'")).rows[0].n), 1, "failed rollback is atomic");
    await client.execute({ sql: "UPDATE sick_mode_doses SET dose_text = 'changed' WHERE id = ?", args: [dosePlan.doseId!] });
    await assert.rejects(
      rollbackHistoricalMedicationImport(client, manifest, {
        canonicalImportFingerprints: [dosePlan.canonicalDoseFingerprint!],
      }),
      /changed after import/,
    );
    await client.execute({ sql: "UPDATE sick_mode_doses SET dose_text = '3.5 ml' WHERE id = ?", args: [dosePlan.doseId!] });
    const rolledBack = await rollbackHistoricalMedicationImport(client, manifest, {
      canonicalImportFingerprints: [dosePlan.canonicalDoseFingerprint!],
    });
    assert.deepEqual(rolledBack, {
      rolledBackCount: 1,
      rolledBackCanonicalDoseCount: 1,
      restoredCanonicalCount: 0,
    });
    assert.equal(Number((await client.execute({ sql: "SELECT COUNT(*) AS n FROM sick_mode_doses WHERE id = ?", args: [dosePlan.doseId!] })).rows[0].n), 0);
    assert.deepEqual((await client.execute("SELECT * FROM sick_mode_episodes ORDER BY id")).rows.map(row => ({ ...row })), episodesBefore);
    assert.deepEqual((await client.execute("SELECT * FROM sick_mode_medications ORDER BY id")).rows.map(row => ({ ...row })), prescriptionsBefore);
    assert.deepEqual((await client.execute("SELECT * FROM activities WHERE type = 'note' ORDER BY id")).rows.map(row => ({ ...row })), sourceBefore);
  } finally {
    client.close();
  }
});

test("changed sources, cross-household scope, and deterministic ID collisions abort without writes", async () => {
  const client = await openFixture("reject");
  try {
    const notes = await seedReviewedHistory(client);
    const manifest = manifestFor(notes);
    const crossHousehold = { ...manifest, inviteCode: "XYZ789" };
    await assert.rejects(planHistoricalMedicationImport(client, crossHousehold), /scope do not match/);

    await client.execute({
      sql: "UPDATE activities SET details = ? WHERE id = 'note-para'",
      args: [JSON.stringify({ notes: "Paracetamol note changed after review" })],
    });
    await assert.rejects(applyHistoricalMedicationImport(client, manifest), /changed after review/);
    assert.equal(Number((await client.execute("SELECT COUNT(*) AS n FROM activities WHERE type = 'medication'")).rows[0].n), 0);
    assert.equal(String((await client.execute("SELECT dose_text FROM sick_mode_doses WHERE id = 'dose-ibuprofen'")).rows[0].dose_text), "3mg");

    // Restore the exact captured source, then occupy the deterministic ID with
    // an unrelated row. The importer must abort instead of overwriting it.
    await client.execute({ sql: "UPDATE activities SET details = ? WHERE id = 'note-para'", args: [notes.paracetamol.details] });
    const identity = historicalMedicationImportIdentity("house-1", "baby-1", "note-para", 0);
    await client.execute({
      sql: "INSERT INTO activities VALUES (?, 'baby-1', 'note', ?, NULL, '{}', ?, 'Parent One')",
      args: [identity.activityId, ts("08:00"), ts("08:00")],
    });
    await assert.rejects(planHistoricalMedicationImport(client, manifest), /Deterministic import ID collision/);
  } finally {
    client.close();
  }
});

test("canonical mappings are explicit and never infer a near timestamp", async () => {
  const client = await openFixture("canonical-validation");
  try {
    const notes = await seedReviewedHistory(client);
    const manifest = manifestFor(notes);
    const tamifluEntry = manifest.entries.find(entry => entry.medicationName === "Tamiflu")!;
    const invalid: HistoricalMedicationImportManifest = {
      ...manifest,
      entries: manifest.entries.map(entry => entry === tamifluEntry
        ? { ...entry, canonicalDose: { ...entry.canonicalDose!, timestampRelation: "exact" } }
        : entry),
    };
    await assert.rejects(planHistoricalMedicationImport(client, invalid), HistoricalMedicationImportError);
    assert.equal(Number((await client.execute("SELECT COUNT(*) AS n FROM activities WHERE type = 'medication'")).rows[0].n), 0);
  } finally {
    client.close();
  }
});

test("prescription targets reject crossed episode bounds, foreign babies, and changed snapshots", async () => {
  const client = await openFixture("prescription-reject");
  try {
    const notes = await seedReviewedHistory(client);
    await client.batch([
      {
        sql: `INSERT INTO sick_mode_medications
              (id, episode_id, name, dose_text, as_needed, min_interval_minutes,
               max_interval_minutes, created_at, created_by, updated_at, revision)
              VALUES ('med-paracetamol', 'episode-1', 'Paracetamol', '3.5 ml', 1,
                      240, 360, ?, 'Parent One', ?, 7)`,
        args: [ts("07:05"), ts("07:05")],
      },
      {
        sql: `INSERT INTO sick_mode_episodes
              (id, baby_id, started_at, ended_at, baseline_daily_ml, baseline_kind,
               baseline_available_day_count, baseline_source_days, created_at, created_by, ended_by)
              VALUES ('foreign-episode', 'baby-2', ?, NULL, 800, 'manual', 0, '[]', ?, 'Other', NULL)`,
        args: [ts("07:00"), ts("07:00")],
      },
      {
        sql: `INSERT INTO sick_mode_medications
              (id, episode_id, name, dose_text, as_needed, min_interval_minutes,
               max_interval_minutes, created_at, created_by, updated_at, revision)
              VALUES ('foreign-paracetamol', 'foreign-episode', 'Paracetamol', '3.5 ml', 1,
                      240, 360, ?, 'Other', ?, 1)`,
        args: [ts("07:05"), ts("07:05")],
      },
    ], "write");
    const baseTarget: ReviewedPrescriptionTarget = {
      medicationId: "med-paracetamol",
      episodeId: "episode-1",
      expectedMedicationName: "Paracetamol",
      expectedMedicationRevision: 7,
      expectedEpisodeStartedAt: ts("07:00"),
      expectedEpisodeEndedAt: null,
    };
    const baseEntry: ReviewedHistoricalMedicationEntry = {
      source: {
        id: "note-para", babyId: "baby-1", type: "note" as const, startedAt: ts("08:00"),
        createdAt: ts("08:00") + 1_000, createdBy: "Parent One", details: notes.paracetamol.details,
      },
      medicationName: "Paracetamol",
      doseText: "3.5 ml",
      eventKind: "medication" as const,
      matchOrdinal: 0,
      prescriptionTarget: baseTarget,
    };
    const manifest = (entry: ReviewedHistoricalMedicationEntry): HistoricalMedicationImportManifest => ({
      version: 1,
      inviteCode: "ABC123",
      expectedHouseholdId: "house-1",
      babyId: "baby-1",
      entries: [entry],
    });

    await assert.rejects(planHistoricalMedicationImport(client, manifest({
      ...baseEntry,
      prescriptionTarget: { ...baseTarget, expectedMedicationRevision: 6 },
    })), /changed after review/);
    await assert.rejects(planHistoricalMedicationImport(client, manifest({
      ...baseEntry,
      prescriptionTarget: { ...baseTarget, expectedEpisodeStartedAt: ts("06:00") },
    })), /changed after review/);
    await assert.rejects(planHistoricalMedicationImport(client, manifest({
      ...baseEntry,
      prescriptionTarget: {
        medicationId: "foreign-paracetamol",
        episodeId: "foreign-episode",
        expectedMedicationName: "Paracetamol",
        expectedMedicationRevision: 1,
        expectedEpisodeStartedAt: ts("07:00"),
        expectedEpisodeEndedAt: null,
      },
    })), /changed after review/);
    await assert.rejects(planHistoricalMedicationImport(client, manifest({
      ...baseEntry,
      prescriptionTarget: { ...baseTarget, expectedEpisodeEndedAt: ts("07:30") },
    })), /outside the reviewed episode/);

    const identity = historicalMedicationCanonicalDoseIdentity("house-1", "baby-1", "note-para", 0);
    assert.equal(Number((await client.execute({ sql: "SELECT COUNT(*) AS n FROM sick_mode_doses WHERE id = ?", args: [identity.doseId] })).rows[0].n), 0);
  } finally {
    client.close();
  }
});
