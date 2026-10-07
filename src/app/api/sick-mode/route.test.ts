import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { createClient } from "@libsql/client";
import { NextRequest } from "next/server";

import { applySickModeSchema, isSickModeSchemaReady } from "@/db/sick-mode-schema";
import { GET as getMilkHistory } from "@/app/api/milk-history/route";
import { GET, POST } from "./route";

const FIXED_NOW = Date.parse("2026-10-06T12:00:00+08:00");
const ts = (date: string, time = "12:00") => Date.parse(`${date}T${time}:00+08:00`);

function request(
  path: string,
  init?: { method?: string; body?: string },
  householdId = "house-1",
  userId = "user-1",
) {
  const headers = new Headers();
  headers.set("cookie", `mcphee_hh=${householdId}; mcphee_user=${userId}`);
  if (init?.body) headers.set("content-type", "application/json");
  return new NextRequest(`http://localhost${path}`, { ...init, headers });
}

async function post(body: Record<string, unknown>) {
  return POST(request("/api/sick-mode", { method: "POST", body: JSON.stringify(body) }));
}

async function postForHousehold(
  body: Record<string, unknown>,
  householdId: string,
  userId: string,
) {
  return POST(request(
    "/api/sick-mode",
    { method: "POST", body: JSON.stringify(body) },
    householdId,
    userId,
  ));
}

async function createBaseSchema(client: ReturnType<typeof createClient>) {
  const statements = [
    "CREATE TABLE households (id TEXT PRIMARY KEY, invite_code TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL)",
    "CREATE TABLE users (id TEXT PRIMARY KEY, household_id TEXT NOT NULL, name TEXT NOT NULL, created_at INTEGER NOT NULL)",
    "CREATE TABLE babies (id TEXT PRIMARY KEY, household_id TEXT NOT NULL, name TEXT NOT NULL, birth_date INTEGER, created_at INTEGER NOT NULL)",
    "CREATE TABLE activities (id TEXT PRIMARY KEY, baby_id TEXT NOT NULL, type TEXT NOT NULL, started_at INTEGER NOT NULL, ended_at INTEGER, details TEXT, created_at INTEGER NOT NULL, created_by TEXT)",
    "CREATE TABLE measurements (id TEXT PRIMARY KEY, baby_id TEXT NOT NULL, measured_at INTEGER NOT NULL, weight_g INTEGER, length_mm INTEGER, head_mm INTEGER, note TEXT, created_at INTEGER NOT NULL)",
  ];
  for (const sql of statements) await client.execute(sql);
  await client.batch([
    { sql: "INSERT INTO households VALUES (?, ?, ?)", args: ["house-1", "ABC123", FIXED_NOW] },
    { sql: "INSERT INTO households VALUES (?, ?, ?)", args: ["house-2", "XYZ789", FIXED_NOW] },
    { sql: "INSERT INTO users VALUES (?, ?, ?, ?)", args: ["user-1", "house-1", "Parent One", FIXED_NOW] },
    { sql: "INSERT INTO users VALUES (?, ?, ?, ?)", args: ["user-2", "house-2", "Parent Two", FIXED_NOW] },
    { sql: "INSERT INTO babies VALUES (?, ?, ?, NULL, ?)", args: ["baby-1", "house-1", "Baby One", FIXED_NOW] },
    { sql: "INSERT INTO babies VALUES (?, ?, ?, NULL, ?)", args: ["baby-2", "house-1", "Baby Two", FIXED_NOW] },
    { sql: "INSERT INTO babies VALUES (?, ?, ?, NULL, ?)", args: ["foreign-baby", "house-2", "Other Baby", FIXED_NOW] },
  ], "write");
}

function medicationIdForTestRequest(
  householdId: string,
  babyId: string,
  episodeId: string,
  requestId: string,
): string {
  const digest = createHash("sha256")
    .update(JSON.stringify([householdId, babyId, episodeId, requestId]))
    .digest("hex");
  return `med_${digest}`;
}

test("sick-mode API is fail-closed, scoped, repeat-migratable, and preserves frozen clinical snapshots", async () => {
  const originalNow = Date.now;
  Date.now = () => FIXED_NOW;
  const dbPath = `/tmp/mcphee-sick-mode-${process.pid}-${Math.random().toString(36).slice(2)}.db`;
  process.env.TURSO_DATABASE_URL = `file:${dbPath}`;
  delete process.env.TURSO_AUTH_TOKEN;
  const client = createClient({ url: process.env.TURSO_DATABASE_URL });
  try {
    await createBaseSchema(client);

    const unavailable = await GET(request("/api/sick-mode?babyId=baby-1"));
    assert.equal(unavailable.status, 200);
    assert.equal(unavailable.headers.get("cache-control"), "private, no-store, max-age=0");
    assert.equal((await unavailable.json()).schemaReady, false);
    assert.equal(await isSickModeSchemaReady(client), false, "GET must not migrate implicitly");
    const unavailableWrite = await post({ action: "start", babyId: "baby-1", startedAt: ts("2026-10-04") });
    assert.equal(unavailableWrite.status, 503);
    assert.equal((await unavailableWrite.json()).code, "SCHEMA_NOT_READY");
    const normalMilkHistory = await getMilkHistory(request("/api/milk-history?babyId=baby-1"));
    assert.equal(normalMilkHistory.status, 200, "milk history must remain readable before the additive migration");

    await applySickModeSchema(client);
    await applySickModeSchema(client);
    assert.equal(await isSickModeSchemaReady(client), true);

    const sourceDates = ["2026-09-27", "2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02", "2026-10-03"];
    await client.batch(sourceDates.map((date, index) => ({
      sql: "INSERT INTO activities VALUES (?, ?, 'bottlefeed', ?, NULL, ?, ?, ?)",
      args: [`source-${index}`, "baby-1", ts(date), JSON.stringify({ milkType: "formula", amount: 800 }), ts(date), "Parent One"],
    })), "write");
    await client.execute({
      sql: `INSERT INTO sick_mode_episodes
            (id, baby_id, started_at, ended_at, baseline_daily_ml, baseline_kind,
             baseline_available_day_count, baseline_source_days, created_at, created_by, ended_by)
            VALUES (?, ?, ?, ?, ?, 'manual', 0, '[]', ?, ?, ?)`,
      args: ["past-episode", "baby-1", ts("2026-09-29", "01:00"), ts("2026-09-29", "23:00"), 800, ts("2026-09-29"), "Parent One", "Parent One"],
    });

    const previewResponse = await GET(request(`/api/sick-mode?babyId=baby-1&startedAt=${ts("2026-10-04", "10:00")}`));
    const preview = await previewResponse.json();
    assert.equal(preview.schemaReady, true);
    assert.equal(preview.baselinePreview.availableDayCount, 6);
    assert.equal(preview.baselinePreview.medianDailyMl, 800);
    assert.equal(preview.baselinePreview.requiresIncompleteConfirmation, true);

    const overlappingPastEpisode = await post({
      action: "start",
      babyId: "baby-1",
      startedAt: ts("2026-09-29", "12:00"),
      manualBaselineMl: 800,
    });
    assert.equal(overlappingPastEpisode.status, 409);
    assert.equal((await overlappingPastEpisode.json()).code, "EPISODE_OVERLAP");

    const deniedIncomplete = await post({ action: "start", babyId: "baby-1", startedAt: ts("2026-10-04", "10:00") });
    assert.equal(deniedIncomplete.status, 400);

    const beforeActivityCount = Number((await client.execute("SELECT COUNT(*) AS n FROM activities")).rows[0].n);
    const started = await post({
      action: "start",
      babyId: "baby-1",
      startedAt: ts("2026-10-04", "10:00"),
      confirmIncomplete: true,
    });
    assert.equal(started.status, 200);
    const { episodeId } = await started.json() as { episodeId: string };
    assert.ok(episodeId);

    await client.batch([
      { sql: "INSERT INTO activities VALUES (?, ?, 'bottlefeed', ?, NULL, ?, ?, ?)", args: ["yesterday", "baby-1", ts("2026-10-05", "12:00"), JSON.stringify({ breastmilkAmount: 200, formulaAmount: 100 }), ts("2026-10-05", "12:00"), "Parent One"] },
      { sql: "INSERT INTO activities VALUES (?, ?, 'bottlefeed', ?, NULL, ?, ?, ?)", args: ["today-old", "baby-1", ts("2026-10-06", "07:00"), JSON.stringify({ amount: 20 }), ts("2026-10-06", "07:00"), "Parent One"] },
      { sql: "INSERT INTO activities VALUES (?, ?, 'bottlefeed', ?, NULL, ?, ?, ?)", args: ["today-a", "baby-1", ts("2026-10-06", "08:00"), JSON.stringify({ milkType: "formula", amount: 25 }), ts("2026-10-06", "08:00"), "Parent One"] },
      { sql: "INSERT INTO activities VALUES (?, ?, 'bottlefeed', ?, NULL, ?, ?, ?)", args: ["today-b", "baby-1", ts("2026-10-06", "09:00"), JSON.stringify({ milkType: "breastmilk", amount: 50 }), ts("2026-10-06", "09:00"), "Parent One"] },
      { sql: "INSERT INTO activities VALUES (?, ?, 'bottlefeed', ?, NULL, ?, ?, ?)", args: ["today-c", "baby-1", ts("2026-10-06", "10:00"), JSON.stringify({ breastmilkAmount: 60, formulaAmount: 40 }), ts("2026-10-06", "10:00"), "Parent One"] },
      { sql: "INSERT INTO activities VALUES (?, ?, 'bottlefeed', ?, NULL, ?, ?, ?)", args: ["waste-only", "baby-1", ts("2026-10-06", "10:30"), JSON.stringify({ amount: 0, wastedAmount: 90 }), ts("2026-10-06", "10:30"), "Parent One"] },
      { sql: "INSERT INTO activities VALUES (?, ?, 'bottlefeed', ?, NULL, ?, ?, ?)", args: ["future-feed", "baby-1", ts("2026-10-06", "13:00"), JSON.stringify({ amount: 1000 }), ts("2026-10-06", "13:00"), "Parent One"] },
      { sql: "INSERT INTO activities VALUES (?, ?, 'bottlefeed', ?, NULL, ?, ?, ?)", args: ["sibling-feed", "baby-2", ts("2026-10-06", "11:00"), JSON.stringify({ milkType: "formula", amount: 900 }), ts("2026-10-06", "11:00"), "Parent One"] },
      { sql: "INSERT INTO activities VALUES (?, ?, 'diaper', ?, NULL, ?, ?, ?)", args: ["diaper-one", "baby-1", ts("2026-10-06", "08:15"), JSON.stringify({ peeUnits: "1", poop: "no" }), ts("2026-10-06", "08:15"), "Parent One"] },
      { sql: "INSERT INTO activities VALUES (?, ?, 'diaper', ?, NULL, ?, ?, ?)", args: ["diaper-legacy", "baby-1", ts("2026-10-06", "09:15"), JSON.stringify({ peeSize: "M", poop: "L" }), ts("2026-10-06", "09:15"), "Parent One"] },
      { sql: "INSERT INTO activities VALUES (?, ?, 'diaper', ?, NULL, ?, ?, ?)", args: ["diaper-unknown", "baby-1", ts("2026-10-06", "10:15"), JSON.stringify({ peeUnits: "?", poop: "M" }), ts("2026-10-06", "10:15"), "Parent One"] },
      { sql: "INSERT INTO activities VALUES (?, ?, 'temperature', ?, NULL, ?, ?, ?)", args: ["temp-current", "baby-1", ts("2026-10-06", "10:45"), JSON.stringify({ celsius: 38.1, method: "ear" }), ts("2026-10-06", "10:45"), "Parent One"] },
      { sql: "INSERT INTO activities VALUES (?, ?, 'temperature', ?, NULL, ?, ?, ?)", args: ["temp-future", "baby-1", ts("2026-10-06", "13:15"), JSON.stringify({ celsius: 39.9 }), ts("2026-10-06", "13:15"), "Parent One"] },
    ], "write");

    const activeResponse = await GET(request("/api/sick-mode?babyId=baby-1"));
    const active = await activeResponse.json();
    assert.equal(active.activeEpisode.baselineDailyMl, 800);
    assert.equal(active.summary.todayConsumedMl, 195);
    assert.equal(active.summary.todayBreastmilkMl, 130);
    assert.equal(active.summary.todayFormulaMl, 65);
    assert.deepEqual(active.summary.latestFeeds.map((feed: { id: string }) => feed.id), ["today-c", "today-b", "today-a"]);
    assert.deepEqual(active.summary.lastCompletedDayConcern, { date: "2026-10-05", totalMl: 300, thresholdMl: 400 });
    assert.equal(active.summary.peeUnitsToday, 4);
    assert.equal(active.summary.wetDiaperCountToday, 2);
    assert.equal(active.summary.lastWetAt, ts("2026-10-06", "09:15"));
    assert.equal(active.summary.latestTemperature.id, "temp-current");

    await client.execute({ sql: "UPDATE activities SET details = ? WHERE id LIKE 'source-%'", args: [JSON.stringify({ amount: 1 })] });
    const frozen = await GET(request("/api/sick-mode?babyId=baby-1"));
    assert.equal((await frozen.json()).activeEpisode.baselineDailyMl, 800, "baseline snapshot must not change after feed edits");

    const foreign = await post({ action: "addMedication", babyId: "baby-2", episodeId, requestId: "foreign-medication-attempt", name: "Paracetamol", doseText: "3.5ml", asNeeded: true, minIntervalHours: 4, maxIntervalHours: 6 });
    assert.equal(foreign.status, 404);

    const missingMedicationRequestId = await post({ action: "addMedication", babyId: "baby-1", episodeId, name: "No request id", doseText: "3.5ml", asNeeded: true, minIntervalHours: 4, maxIntervalHours: 6 });
    assert.equal(missingMedicationRequestId.status, 400);

    const scheduledWithoutInterval = await post({
      action: "addMedication",
      babyId: "baby-1",
      episodeId,
      requestId: "scheduled-without-interval",
      name: "Scheduled medicine",
      doseText: "3.5ml",
      asNeeded: false,
    });
    assert.equal(scheduledWithoutInterval.status, 400);
    assert.equal((await scheduledWithoutInterval.json()).error, "Enter how often this medication should be given.");
    assert.equal(Number((await client.execute("SELECT COUNT(*) AS n FROM sick_mode_medications")).rows[0].n), 0);

    const legacyRequestId = "legacy-scheduled-without-interval";
    const legacyMedicationId = medicationIdForTestRequest("house-1", "baby-1", episodeId, legacyRequestId);
    const legacyMedicationPayload = {
      action: "addMedication",
      babyId: "baby-1",
      episodeId,
      requestId: legacyRequestId,
      name: "Legacy scheduled medicine",
      doseText: "3.5ml",
      asNeeded: false,
    };
    await client.execute({
      sql: `INSERT INTO sick_mode_medications
            (id, episode_id, name, dose_text, as_needed, min_interval_minutes,
             max_interval_minutes, created_at, created_by, updated_at, revision)
            VALUES (?, ?, ?, ?, 0, NULL, NULL, ?, ?, ?, 1)`,
      args: [
        legacyMedicationId,
        episodeId,
        legacyMedicationPayload.name,
        legacyMedicationPayload.doseText,
        FIXED_NOW,
        "Parent One",
        FIXED_NOW,
      ],
    });
    const legacyReplay = await post(legacyMedicationPayload);
    assert.equal(legacyReplay.status, 200);
    assert.deepEqual(await legacyReplay.json(), {
      ok: true,
      id: legacyMedicationId,
      episodeId,
      idempotent: true,
    });
    const changedLegacyReplay = await post({ ...legacyMedicationPayload, doseText: "7ml" });
    assert.equal(changedLegacyReplay.status, 409);
    assert.equal((await changedLegacyReplay.json()).code, "REQUEST_ID_CONFLICT");
    const legacyUpdateWithoutInterval = await post({
      action: "updateMedication",
      babyId: "baby-1",
      episodeId,
      medicationId: legacyMedicationId,
      name: legacyMedicationPayload.name,
      doseText: legacyMedicationPayload.doseText,
      asNeeded: false,
      expectedRevision: 1,
    });
    assert.equal(legacyUpdateWithoutInterval.status, 400);
    const legacyAfterRejectedUpdate = (await client.execute({
      sql: "SELECT revision, min_interval_minutes, max_interval_minutes FROM sick_mode_medications WHERE id = ?",
      args: [legacyMedicationId],
    })).rows[0];
    assert.equal(Number(legacyAfterRejectedUpdate.revision), 1);
    assert.equal(legacyAfterRejectedUpdate.min_interval_minutes, null);
    assert.equal(legacyAfterRejectedUpdate.max_interval_minutes, null);
    await client.execute({
      sql: "DELETE FROM sick_mode_medications WHERE id = ?",
      args: [legacyMedicationId],
    });

    for (const [requestId, minIntervalHours, maxIntervalHours] of [
      ["invalid-zero-interval", 0, undefined],
      ["invalid-negative-interval", -1, undefined],
      ["invalid-nonnumeric-interval", "not-a-number", undefined],
      ["invalid-reversed-interval", 6, 4],
    ] as const) {
      const invalidInterval = await post({
        action: "addMedication",
        babyId: "baby-1",
        episodeId,
        requestId,
        name: "Invalid schedule",
        doseText: "3.5ml",
        asNeeded: requestId === "invalid-reversed-interval",
        minIntervalHours,
        maxIntervalHours,
      });
      assert.equal(invalidInterval.status, 400);
    }
    assert.equal(Number((await client.execute("SELECT COUNT(*) AS n FROM sick_mode_medications")).rows[0].n), 0);

    const firstMedicationPayload = { action: "addMedication", babyId: "baby-1", episodeId, requestId: "medication-request-1", name: "Paracetamol", doseText: "3.5ml", asNeeded: false, minIntervalHours: 6 };
    const committedMedication = await post(firstMedicationPayload);
    assert.equal(committedMedication.status, 200);
    const committedMedicationId = (await committedMedication.json()).id;
    const retriedMedication = await post(firstMedicationPayload);
    assert.equal(retriedMedication.status, 200);
    assert.deepEqual(await retriedMedication.json(), { ok: true, id: committedMedicationId, episodeId, idempotent: true });
    assert.equal(Number((await client.execute({ sql: "SELECT COUNT(*) AS n FROM sick_mode_medications WHERE id = ?", args: [committedMedicationId] })).rows[0].n), 1);

    const changedMedicationRetry = await post({ ...firstMedicationPayload, doseText: "7ml" });
    assert.equal(changedMedicationRetry.status, 409);
    assert.equal((await changedMedicationRetry.json()).code, "REQUEST_ID_CONFLICT");
    assert.equal(Number((await client.execute({ sql: "SELECT COUNT(*) AS n FROM sick_mode_medications WHERE episode_id = ?", args: [episodeId] })).rows[0].n), 1);

    const foreignEpisodeStart = await postForHousehold({
      action: "start",
      babyId: "foreign-baby",
      startedAt: ts("2026-10-04", "10:00"),
      manualBaselineMl: 800,
    }, "house-2", "user-2");
    assert.equal(foreignEpisodeStart.status, 200);
    const foreignEpisodeId = (await foreignEpisodeStart.json()).episodeId;
    const foreignMedicationPayload = {
      ...firstMedicationPayload,
      babyId: "foreign-baby",
      episodeId: foreignEpisodeId,
      name: "Foreign household medication",
    };
    const foreignMedication = await postForHousehold(foreignMedicationPayload, "house-2", "user-2");
    assert.equal(foreignMedication.status, 200);
    const foreignMedicationId = (await foreignMedication.json()).id;
    assert.notEqual(foreignMedicationId, committedMedicationId, "request identities must be scoped to their household, baby, and episode");
    const foreignMedicationRetry = await postForHousehold(foreignMedicationPayload, "house-2", "user-2");
    assert.deepEqual(await foreignMedicationRetry.json(), { ok: true, id: foreignMedicationId, episodeId: foreignEpisodeId, idempotent: true });

    const medicationIds: string[] = [committedMedicationId];
    for (const [index, name] of ["Ibuprofen", "Medicine C", "Medicine D"].entries()) {
      const response = await post({
        action: "addMedication",
        babyId: "baby-1",
        episodeId,
        requestId: `medication-request-${index + 2}`,
        name,
        doseText: "3.5ml",
        asNeeded: true,
        ...(index === 0 ? {} : { minIntervalHours: 4, maxIntervalHours: 6 }),
      });
      assert.equal(response.status, 200);
      medicationIds.push((await response.json()).id);
    }
    const medicationId = medicationIds[0];
    const staleMedicationEdit = await post({ action: "updateMedication", babyId: "baby-1", episodeId, medicationId, name: "Paracetamol", doseText: "3.5ml", asNeeded: true, minIntervalHours: 4, maxIntervalHours: 6, expectedRevision: 9 });
    assert.equal(staleMedicationEdit.status, 409);
    const missingScheduleEdit = await post({ action: "updateMedication", babyId: "baby-1", episodeId, medicationId, name: "Paracetamol", doseText: "3.5ml", asNeeded: false, expectedRevision: 1 });
    assert.equal(missingScheduleEdit.status, 400);
    const unchangedAfterRejectedEdit = (await client.execute({
      sql: "SELECT revision, as_needed, min_interval_minutes FROM sick_mode_medications WHERE id = ?",
      args: [medicationId],
    })).rows[0];
    assert.equal(Number(unchangedAfterRejectedEdit.revision), 1);
    assert.equal(Number(unchangedAfterRejectedEdit.as_needed), 0);
    assert.equal(Number(unchangedAfterRejectedEdit.min_interval_minutes), 360);
    const medicationEdit = await post({ action: "updateMedication", babyId: "baby-1", episodeId, medicationId, name: "Paracetamol", doseText: "3.5ml", asNeeded: false, minIntervalHours: 6, expectedRevision: 1 });
    assert.equal(medicationEdit.status, 200);
    const repeatedMedicationEdit = await post({ action: "updateMedication", babyId: "baby-1", episodeId, medicationId, name: "Paracetamol", doseText: "3.5ml", asNeeded: false, minIntervalHours: 6, expectedRevision: 1 });
    assert.equal(repeatedMedicationEdit.status, 409);
    const firstDosePayload = { action: "logDose", babyId: "baby-1", episodeId, medicationId, givenAt: ts("2026-10-06", "10:00"), doseText: "3.5ml", requestId: "dose-request-1", expectedLatestDoseId: null };
    const firstDose = await post(firstDosePayload);
    assert.equal(firstDose.status, 200);
    const firstDoseId = (await firstDose.json()).id;
    const retriedDose = await post(firstDosePayload);
    assert.equal(retriedDose.status, 200);
    assert.deepEqual((await retriedDose.json()), { ok: true, id: firstDoseId, episodeId, idempotent: true });

    const staleDose = await post({ ...firstDosePayload, givenAt: ts("2026-10-06", "11:00"), requestId: "dose-request-2" });
    assert.equal(staleDose.status, 409);
    const secondDose = await post({ ...firstDosePayload, givenAt: ts("2026-10-06", "11:00"), requestId: "dose-request-2", expectedLatestDoseId: firstDoseId });
    assert.equal(secondDose.status, 200);
    const secondDoseId = (await secondDose.json()).id;

    const staleEdit = await post({ action: "updateDose", babyId: "baby-1", episodeId, medicationId, doseId: secondDoseId, givenAt: ts("2026-10-06", "11:05"), doseText: "3.5ml", expectedRevision: 9 });
    assert.equal(staleEdit.status, 409);
    const edit = await post({ action: "updateDose", babyId: "baby-1", episodeId, medicationId, doseId: secondDoseId, givenAt: ts("2026-10-06", "11:05"), doseText: "3.5ml", expectedRevision: 1 });
    assert.equal(edit.status, 200);
    const remove = await post({ action: "deleteDose", babyId: "baby-1", episodeId, medicationId, doseId: secondDoseId, expectedRevision: 2 });
    assert.equal(remove.status, 200);

    const withMedication = await GET(request("/api/sick-mode?babyId=baby-1"));
    const medicationData = await withMedication.json();
    assert.equal(medicationData.medications.length, 4, "all concurrent medications must be returned");
    const dosedMedication = medicationData.medications.find((medication: { id: string }) => medication.id === medicationId);
    assert.equal(dosedMedication.doses.length, 1);
    assert.equal(dosedMedication.latestDose.id, firstDoseId);

    const milkHistoryResponse = await getMilkHistory(request("/api/milk-history?babyId=baby-1"));
    const milkHistory = await milkHistoryResponse.json();
    assert.equal(milkHistory.days.some((entry: { date: string }) => entry.date === "2026-10-07"), false, "future rows must be excluded");
    assert.equal(milkHistory.days.find((entry: { date: string }) => entry.date === "2026-10-05").isSickDay, true);
    assert.equal(milkHistory.days.find((entry: { date: string }) => entry.date === "2026-10-02").isSickDay, false);

    const invalidEnd = await post({ action: "end", babyId: "baby-1", episodeId, endedAt: ts("2026-10-06", "09:00") });
    assert.equal(invalidEnd.status, 400, "episode cannot end before a retained dose");
    const ended = await post({ action: "end", babyId: "baby-1", episodeId });
    assert.equal(ended.status, 200);
    const afterEnd = await GET(request("/api/sick-mode?babyId=baby-1"));
    const archived = await afterEnd.json();
    assert.equal(archived.activeEpisode, null);
    assert.equal(archived.episodes.some((episode: { id: string }) => episode.id === episodeId), true);
    const archivedDetailResponse = await GET(request(`/api/sick-mode?babyId=baby-1&episodeId=${episodeId}`));
    const archivedDetail = await archivedDetailResponse.json();
    assert.equal(archivedDetail.archivedEpisode.id, episodeId);
    assert.equal(archivedDetail.archivedMedications.length, 4);
    assert.equal(archivedDetail.archivedMedications.find((medication: { id: string }) => medication.id === medicationId).doses.length, 1);
    assert.equal(Number((await client.execute({ sql: "SELECT COUNT(*) AS n FROM sick_mode_doses WHERE medication_id = ?", args: [medicationId] })).rows[0].n), 2, "soft-deleted and active doses remain archived");
    assert.equal(Number((await client.execute("SELECT COUNT(*) AS n FROM activities")).rows[0].n), beforeActivityCount + 13, "sick-mode writes must not add milk-bank/activity ledger rows");
  } finally {
    Date.now = originalNow;
    client.close();
  }
});

test("updateStart moves an active episode's start within its guards and refreshes the baseline only across Singapore days", async () => {
  const originalNow = Date.now;
  Date.now = () => FIXED_NOW;
  const dbPath = `/tmp/mcphee-sick-mode-update-${process.pid}-${Math.random().toString(36).slice(2)}.db`;
  process.env.TURSO_DATABASE_URL = `file:${dbPath}`;
  delete process.env.TURSO_AUTH_TOKEN;
  const client = createClient({ url: process.env.TURSO_DATABASE_URL });
  try {
    await createBaseSchema(client);
    await applySickModeSchema(client);

    const feedDays: Array<[string, number]> = [
      ["2026-09-27", 700], ["2026-09-28", 800], ["2026-09-29", 900], ["2026-09-30", 1000],
      ["2026-10-01", 1100], ["2026-10-02", 1200], ["2026-10-03", 1300], ["2026-10-04", 1400],
      ["2026-10-05", 1500],
    ];
    await client.batch(feedDays.map(([date, ml], index) => ({
      sql: "INSERT INTO activities VALUES (?, ?, 'bottlefeed', ?, NULL, ?, ?, ?)",
      args: [`feed-${index}`, "baby-1", ts(date), JSON.stringify({ milkType: "formula", amount: ml }), ts(date), "Parent One"],
    })), "write");

    // A prior episode on 27 Sep must keep excluding that day from other episodes' baselines.
    await client.execute({
      sql: `INSERT INTO sick_mode_episodes
            (id, baby_id, started_at, ended_at, baseline_daily_ml, baseline_kind,
             baseline_available_day_count, baseline_source_days, created_at, created_by, ended_by)
            VALUES (?, ?, ?, ?, ?, 'manual', 0, '[]', ?, ?, ?)`,
      args: ["prior-episode", "baby-1", ts("2026-09-27", "01:00"), ts("2026-09-27", "23:00"), 500, ts("2026-09-27"), "Parent One", "Parent One"],
    });

    const started = await post({ action: "start", babyId: "baby-1", startedAt: ts("2026-10-04", "10:00"), confirmIncomplete: true });
    assert.equal(started.status, 200);
    const { episodeId } = await started.json() as { episodeId: string };

    const initial = await GET(request("/api/sick-mode?babyId=baby-1"));
    const initialData = await initial.json();
    assert.equal(initialData.activeEpisode.baselineDailyMl, 1050);
    assert.equal(initialData.activeEpisode.baselineAvailableDayCount, 6);
    assert.equal(initialData.activeEpisode.baselineKind, "calculated");

    const missingStartedAt = await post({ action: "updateStart", babyId: "baby-1", episodeId, expectedStartedAt: ts("2026-10-04", "10:00") });
    assert.equal(missingStartedAt.status, 400);
    const missingExpected = await post({ action: "updateStart", babyId: "baby-1", episodeId, startedAt: ts("2026-10-04", "09:00") });
    assert.equal(missingExpected.status, 400);
    const futureStart = await post({ action: "updateStart", babyId: "baby-1", episodeId, startedAt: ts("2026-10-07", "00:00"), expectedStartedAt: ts("2026-10-04", "10:00") });
    assert.equal(futureStart.status, 400);
    const wrongBaby = await post({ action: "updateStart", babyId: "baby-2", episodeId, startedAt: ts("2026-10-04", "09:00"), expectedStartedAt: ts("2026-10-04", "10:00") });
    assert.equal(wrongBaby.status, 404, "the episode must belong to the requested baby");
    const foreignHousehold = await postForHousehold({ action: "updateStart", babyId: "foreign-baby", episodeId, startedAt: ts("2026-10-04", "09:00"), expectedStartedAt: ts("2026-10-04", "10:00") }, "house-2", "user-2");
    assert.equal(foreignHousehold.status, 404, "another household must not edit the episode");

    const stale = await post({ action: "updateStart", babyId: "baby-1", episodeId, startedAt: ts("2026-10-04", "09:00"), expectedStartedAt: ts("2026-10-04", "08:00") });
    assert.equal(stale.status, 409);
    assert.equal((await stale.json()).code, "STALE_EPISODE");
    const unchangedAfterStale = (await client.execute({ sql: "SELECT started_at FROM sick_mode_episodes WHERE id = ?", args: [episodeId] })).rows[0];
    assert.equal(Number(unchangedAfterStale.started_at), ts("2026-10-04", "10:00"), "a stale edit must not move the start");

    // A retry whose requested value already matches the stored start succeeds without rebuilding the snapshot.
    const exactRetry = await post({ action: "updateStart", babyId: "baby-1", episodeId, startedAt: ts("2026-10-04", "10:00"), expectedStartedAt: ts("2026-10-04", "08:00") });
    assert.equal(exactRetry.status, 200);
    assert.equal((await exactRetry.json()).idempotent, true);

    const before = (await client.execute({
      sql: "SELECT started_at, baseline_daily_ml, baseline_available_day_count, baseline_source_days FROM sick_mode_episodes WHERE id = ?",
      args: [episodeId],
    })).rows[0];
    // Source edits must not leak into a same-day move.
    await client.execute({
      sql: "UPDATE activities SET details = ? WHERE baby_id = 'baby-1' AND started_at >= ? AND started_at < ?",
      args: [JSON.stringify({ milkType: "formula", amount: 5 }), ts("2026-09-27"), ts("2026-10-04")],
    });
    const sameDay = await post({ action: "updateStart", babyId: "baby-1", episodeId, startedAt: ts("2026-10-04", "06:00"), expectedStartedAt: ts("2026-10-04", "10:00") });
    assert.equal(sameDay.status, 200);
    const after = (await client.execute({
      sql: "SELECT started_at, baseline_daily_ml, baseline_available_day_count, baseline_source_days FROM sick_mode_episodes WHERE id = ?",
      args: [episodeId],
    })).rows[0];
    assert.equal(Number(after.started_at), ts("2026-10-04", "06:00"));
    assert.equal(Number(after.baseline_daily_ml), Number(before.baseline_daily_ml), "same-day moves keep the frozen baseline amount");
    assert.equal(Number(after.baseline_available_day_count), Number(before.baseline_available_day_count));
    assert.equal(String(after.baseline_source_days), String(before.baseline_source_days));
    await client.batch(feedDays.map(([date, ml], index) => ({
      sql: "UPDATE activities SET details = ? WHERE id = ?",
      args: [JSON.stringify({ milkType: "formula", amount: ml }), `feed-${index}`],
    })), "write");

    // The editor preview must drop the episode being edited from its own proposed window.
    const previewWithoutSelf = await (await GET(request(`/api/sick-mode?babyId=baby-1&startedAt=${ts("2026-10-05", "10:00")}`))).json();
    assert.equal(previewWithoutSelf.baselinePreview.availableDayCount, 6, "the live episode currently covers 4 Oct");
    const previewWithSelf = await (await GET(request(`/api/sick-mode?babyId=baby-1&startedAt=${ts("2026-10-05", "10:00")}&editingEpisodeId=${episodeId}`))).json();
    assert.equal(previewWithSelf.baselinePreview.availableDayCount, 7);
    assert.equal(previewWithSelf.baselinePreview.medianDailyMl, 1100);

    // Moving Later across a date recomputes the baseline excluding the edited episode but keeping other sick days out.
    const later = await post({ action: "updateStart", babyId: "baby-1", episodeId, startedAt: ts("2026-10-05", "10:00"), expectedStartedAt: ts("2026-10-04", "06:00") });
    assert.equal(later.status, 200);
    const laterRow = (await client.execute({ sql: "SELECT started_at, baseline_daily_ml, baseline_available_day_count FROM sick_mode_episodes WHERE id = ?", args: [episodeId] })).rows[0];
    assert.equal(Number(laterRow.started_at), ts("2026-10-05", "10:00"));
    assert.equal(Number(laterRow.baseline_daily_ml), 1100);
    assert.equal(Number(laterRow.baseline_available_day_count), 7);

    // A partial calculated window is denied without confirmation and must leave the episode untouched.
    const beforeDenied = (await client.execute({ sql: "SELECT started_at, baseline_daily_ml, baseline_kind, baseline_available_day_count, baseline_source_days FROM sick_mode_episodes WHERE id = ?", args: [episodeId] })).rows[0];
    const incompleteDenied = await post({ action: "updateStart", babyId: "baby-1", episodeId, startedAt: ts("2026-09-30", "10:00"), expectedStartedAt: ts("2026-10-05", "10:00") });
    assert.equal(incompleteDenied.status, 400);
    assert.equal((await incompleteDenied.json()).code, "INCOMPLETE_BASELINE_CONFIRMATION_REQUIRED");
    const deniedRow = (await client.execute({ sql: "SELECT started_at, baseline_daily_ml, baseline_kind, baseline_available_day_count, baseline_source_days FROM sick_mode_episodes WHERE id = ?", args: [episodeId] })).rows[0];
    assert.equal(Number(deniedRow.started_at), ts("2026-10-05", "10:00"), "a denied incomplete move must not move the start");
    assert.deepEqual(deniedRow, beforeDenied, "a denied incomplete move must not partially rewrite the episode");

    // Confirming the incomplete window applies the recalculated baseline.
    const incompleteConfirmed = await post({ action: "updateStart", babyId: "baby-1", episodeId, startedAt: ts("2026-09-30", "10:00"), expectedStartedAt: ts("2026-10-05", "10:00"), confirmIncomplete: true });
    assert.equal(incompleteConfirmed.status, 200);
    const confirmedRow = (await client.execute({ sql: "SELECT started_at, baseline_daily_ml, baseline_kind, baseline_available_day_count FROM sick_mode_episodes WHERE id = ?", args: [episodeId] })).rows[0];
    assert.equal(Number(confirmedRow.started_at), ts("2026-09-30", "10:00"));
    assert.equal(Number(confirmedRow.baseline_daily_ml), 850);
    assert.equal(String(confirmedRow.baseline_kind), "calculated");
    assert.equal(Number(confirmedRow.baseline_available_day_count), 2);

    // Restore a complete calculated start so the following manual-baseline tests begin from a full window.
    const restoredComplete = await post({ action: "updateStart", babyId: "baby-1", episodeId, startedAt: ts("2026-10-05", "10:00"), expectedStartedAt: ts("2026-09-30", "10:00") });
    assert.equal(restoredComplete.status, 200);
    const restoredRow = (await client.execute({ sql: "SELECT started_at, baseline_daily_ml, baseline_kind, baseline_available_day_count FROM sick_mode_episodes WHERE id = ?", args: [episodeId] })).rows[0];
    assert.equal(Number(restoredRow.started_at), ts("2026-10-05", "10:00"));
    assert.equal(Number(restoredRow.baseline_daily_ml), 1100);
    assert.equal(String(restoredRow.baseline_kind), "calculated");
    assert.equal(Number(restoredRow.baseline_available_day_count), 7);

    // Moving earlier into a fully excluded window requires a positive manual fallback.
    const needsManual = await post({ action: "updateStart", babyId: "baby-1", episodeId, startedAt: ts("2026-09-28", "10:00"), expectedStartedAt: ts("2026-10-05", "10:00") });
    assert.equal(needsManual.status, 400);
    assert.equal((await needsManual.json()).code, "MANUAL_BASELINE_REQUIRED");
    const manualMove = await post({ action: "updateStart", babyId: "baby-1", episodeId, startedAt: ts("2026-09-28", "10:00"), expectedStartedAt: ts("2026-10-05", "10:00"), manualBaselineMl: 900 });
    assert.equal(manualMove.status, 200);
    const manualRow = (await client.execute({ sql: "SELECT started_at, baseline_daily_ml, baseline_kind, baseline_available_day_count FROM sick_mode_episodes WHERE id = ?", args: [episodeId] })).rows[0];
    assert.equal(Number(manualRow.started_at), ts("2026-09-28", "10:00"));
    assert.equal(Number(manualRow.baseline_daily_ml), 900);
    assert.equal(String(manualRow.baseline_kind), "manual");

    // An originally manual baseline keeps its amount and label while refreshing source-day metadata.
    const retained = await post({ action: "updateStart", babyId: "baby-1", episodeId, startedAt: ts("2026-09-30", "10:00"), expectedStartedAt: ts("2026-09-28", "10:00") });
    assert.equal(retained.status, 200);
    const retainedRow = (await client.execute({ sql: "SELECT baseline_daily_ml, baseline_kind, baseline_available_day_count FROM sick_mode_episodes WHERE id = ?", args: [episodeId] })).rows[0];
    assert.equal(Number(retainedRow.baseline_daily_ml), 900);
    assert.equal(String(retainedRow.baseline_kind), "manual");
    assert.equal(Number(retainedRow.baseline_available_day_count), 2);

    // Other-episode overlap is rejected without moving the start.
    await client.execute({
      sql: `INSERT INTO sick_mode_episodes
            (id, baby_id, started_at, ended_at, baseline_daily_ml, baseline_kind,
             baseline_available_day_count, baseline_source_days, created_at, created_by, ended_by)
            VALUES (?, ?, ?, ?, ?, 'manual', 0, '[]', ?, ?, ?)`,
      args: ["overlap-episode", "baby-1", ts("2026-10-01", "00:00"), ts("2026-10-01", "12:00"), 600, ts("2026-10-01"), "Parent One", "Parent One"],
    });
    const overlapping = await post({ action: "updateStart", babyId: "baby-1", episodeId, startedAt: ts("2026-10-01", "06:00"), expectedStartedAt: ts("2026-09-30", "10:00") });
    assert.equal(overlapping.status, 409);
    assert.equal((await overlapping.json()).code, "EPISODE_OVERLAP");
    assert.equal(Number((await client.execute({ sql: "SELECT started_at FROM sick_mode_episodes WHERE id = ?", args: [episodeId] })).rows[0].started_at), ts("2026-09-30", "10:00"));
    // Drop only the synthetic overlap fixture; a lingering real overlap would (wrongly) block the later same-day move.
    await client.execute({ sql: "DELETE FROM sick_mode_episodes WHERE id = ?", args: ["overlap-episode"] });

    const episodeCount = Number((await client.execute({ sql: "SELECT COUNT(*) AS n FROM sick_mode_episodes WHERE baby_id = ?", args: ["baby-1"] })).rows[0].n);
    const activityCount = Number((await client.execute("SELECT COUNT(*) AS n FROM activities")).rows[0].n);

    // A start later than a retained dose is rejected; earlier than the dose is allowed.
    const medicationResponse = await post({ action: "addMedication", babyId: "baby-1", episodeId, requestId: "update-start-med-1", name: "Paracetamol", doseText: "3.5ml", asNeeded: true, minIntervalHours: 4, maxIntervalHours: 6 });
    assert.equal(medicationResponse.status, 200);
    const medicationId = (await medicationResponse.json()).id;
    const doseResponse = await post({ action: "logDose", babyId: "baby-1", episodeId, medicationId, givenAt: ts("2026-09-30", "14:00"), doseText: "3.5ml", requestId: "update-start-dose-1", expectedLatestDoseId: null });
    assert.equal(doseResponse.status, 200);
    const doseCount = Number((await client.execute({ sql: "SELECT COUNT(*) AS n FROM sick_mode_doses WHERE medication_id = ?", args: [medicationId] })).rows[0].n);
    const afterDose = await post({ action: "updateStart", babyId: "baby-1", episodeId, startedAt: ts("2026-09-30", "16:00"), expectedStartedAt: ts("2026-09-30", "10:00") });
    assert.equal(afterDose.status, 400, "a start later than a retained dose is rejected");
    const beforeDose = await post({ action: "updateStart", babyId: "baby-1", episodeId, startedAt: ts("2026-09-30", "08:00"), expectedStartedAt: ts("2026-09-30", "10:00") });
    assert.equal(beforeDose.status, 200);
    assert.equal(Number((await client.execute({ sql: "SELECT started_at FROM sick_mode_episodes WHERE id = ?", args: [episodeId] })).rows[0].started_at), ts("2026-09-30", "08:00"));

    // Normal milk-history sick-day flags follow the moved start without rebuilding the ledger.
    const milkHistory = await (await getMilkHistory(request("/api/milk-history?babyId=baby-1"))).json();
    const milkDay = (date: string) => milkHistory.days.find((entry: { date: string }) => entry.date === date);
    assert.equal(milkDay("2026-09-30").isSickDay, true);
    assert.equal(milkDay("2026-09-29").isSickDay, false);
    assert.equal(milkDay("2026-10-02").isSickDay, true);

    assert.equal(Number((await client.execute({ sql: "SELECT COUNT(*) AS n FROM sick_mode_episodes WHERE baby_id = ?", args: ["baby-1"] })).rows[0].n), episodeCount, "updateStart must not insert episodes");
    assert.equal(Number((await client.execute("SELECT COUNT(*) AS n FROM activities")).rows[0].n), activityCount, "updateStart must not write activity/ledger rows");
    assert.equal(Number((await client.execute({ sql: "SELECT COUNT(*) AS n FROM sick_mode_doses WHERE medication_id = ?", args: [medicationId] })).rows[0].n), doseCount, "updateStart must not write dose rows");

    // Ended episodes reject both a stale edit and an idempotent-looking retry.
    const ended = await post({ action: "end", babyId: "baby-1", episodeId });
    assert.equal(ended.status, 200);
    const endedStale = await post({ action: "updateStart", babyId: "baby-1", episodeId, startedAt: ts("2026-09-30", "07:00"), expectedStartedAt: ts("2026-09-30", "08:00") });
    assert.equal(endedStale.status, 409);
    const endedRetry = await post({ action: "updateStart", babyId: "baby-1", episodeId, startedAt: ts("2026-09-30", "08:00"), expectedStartedAt: ts("2026-09-30", "08:00") });
    assert.equal(endedRetry.status, 409, "ended episodes must reject even a matching retry");
  } finally {
    Date.now = originalNow;
    client.close();
  }
});

test("resume reopens the same ended episode continuously without rewriting its clinical records", async () => {
  const originalNow = Date.now;
  Date.now = () => FIXED_NOW;
  const dbPath = `/tmp/mcphee-sick-mode-resume-${process.pid}-${Math.random().toString(36).slice(2)}.db`;
  process.env.TURSO_DATABASE_URL = `file:${dbPath}`;
  delete process.env.TURSO_AUTH_TOKEN;
  const client = createClient({ url: process.env.TURSO_DATABASE_URL });
  const episodeId = "resume-episode";
  const originalStartedAt = ts("2026-10-03", "08:00");
  const originalEndedAt = ts("2026-10-03", "20:00");
  const resumePayload = {
    action: "resume",
    babyId: "baby-1",
    episodeId,
    expectedStartedAt: originalStartedAt,
    expectedEndedAt: originalEndedAt,
  };
  try {
    await createBaseSchema(client);
    await applySickModeSchema(client);

    const feedDays: Array<[string, number]> = [
      ["2026-09-25", 100], ["2026-09-26", 200], ["2026-09-27", 300],
      ["2026-09-28", 400], ["2026-09-29", 500], ["2026-09-30", 600],
      ["2026-10-01", 700], ["2026-10-02", 800], ["2026-10-03", 900],
      ["2026-10-04", 1000], ["2026-10-05", 1100],
    ];
    await client.batch(feedDays.map(([date, amount], index) => ({
      sql: "INSERT INTO activities VALUES (?, ?, 'bottlefeed', ?, NULL, ?, ?, ?)",
      args: [
        `resume-feed-${index}`,
        "baby-1",
        ts(date),
        JSON.stringify({ milkType: "formula", amount }),
        ts(date),
        "Parent One",
      ],
    })), "write");
    await client.execute({
      sql: `INSERT INTO sick_mode_episodes
            (id, baby_id, started_at, ended_at, baseline_daily_ml, baseline_kind,
             baseline_available_day_count, baseline_source_days, created_at, created_by, ended_by)
            VALUES (?, ?, ?, ?, ?, 'calculated', ?, ?, ?, ?, ?)`,
      args: [
        episodeId,
        "baby-1",
        originalStartedAt,
        originalEndedAt,
        777.5,
        7,
        JSON.stringify([{ date: "2026-10-02", totalMl: 777.5 }]),
        ts("2026-10-03", "08:01"),
        "Parent One",
        "Parent One",
      ],
    });
    await client.batch([
      {
        sql: `INSERT INTO sick_mode_medications
              (id, episode_id, name, dose_text, as_needed, min_interval_minutes,
               max_interval_minutes, created_at, created_by, updated_at, revision)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: ["resume-med", episodeId, "Paracetamol", "3.5ml", 1, 240, 360, ts("2026-10-03", "08:30"), "Parent One", ts("2026-10-03", "08:30"), 1],
      },
      {
        sql: `INSERT INTO sick_mode_doses
              (id, medication_id, given_at, dose_text, given_by, request_id,
               created_at, updated_at, revision, deleted_at, deleted_by)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)`,
        args: ["resume-dose", "resume-med", ts("2026-10-03", "12:00"), "3.5ml", "Parent One", "resume-dose-request", ts("2026-10-03", "12:00"), ts("2026-10-03", "12:00"), 1],
      },
    ], "write");

    const episodeBefore = { ...(await client.execute({ sql: "SELECT * FROM sick_mode_episodes WHERE id = ?", args: [episodeId] })).rows[0] };
    const medicationsBefore = (await client.execute({ sql: "SELECT * FROM sick_mode_medications WHERE episode_id = ? ORDER BY id", args: [episodeId] })).rows.map((row) => ({ ...row }));
    const dosesBefore = (await client.execute({ sql: `SELECT d.* FROM sick_mode_doses d
                                                       JOIN sick_mode_medications m ON m.id = d.medication_id
                                                       WHERE m.episode_id = ? ORDER BY d.id`, args: [episodeId] })).rows.map((row) => ({ ...row }));
    const activitiesBefore = (await client.execute("SELECT * FROM activities ORDER BY id")).rows.map((row) => ({ ...row }));

    const beforeHistory = await (await getMilkHistory(request("/api/milk-history?babyId=baby-1"))).json();
    assert.equal(beforeHistory.days.find((day: { date: string }) => day.date === "2026-10-04").isSickDay, false, "the ended episode initially leaves a healthy gap");

    for (const invalidPayload of [
      { ...resumePayload, expectedStartedAt: "" },
      { ...resumePayload, expectedStartedAt: -1 },
      { ...resumePayload, expectedStartedAt: "not-a-time" },
      { ...resumePayload, expectedStartedAt: FIXED_NOW + 1 },
      { ...resumePayload, expectedEndedAt: "" },
      { ...resumePayload, expectedEndedAt: -1 },
      { ...resumePayload, expectedEndedAt: "not-a-time" },
      { ...resumePayload, expectedEndedAt: FIXED_NOW + 1 },
    ]) {
      const invalid = await post(invalidPayload);
      assert.equal(invalid.status, 400, "invalid or future captured timestamps must fail closed");
    }

    const unknown = await post({ ...resumePayload, episodeId: "missing-episode" });
    assert.equal(unknown.status, 404);
    const wrongBaby = await post({ ...resumePayload, babyId: "baby-2" });
    assert.equal(wrongBaby.status, 404);
    const foreignHousehold = await postForHousehold(
      { ...resumePayload, babyId: "foreign-baby" },
      "house-2",
      "user-2",
    );
    assert.equal(foreignHousehold.status, 404);

    const staleStart = await post({ ...resumePayload, expectedStartedAt: ts("2026-10-03", "07:59") });
    assert.equal(staleStart.status, 409);
    assert.equal((await staleStart.json()).code, "STALE_EPISODE");
    const staleEnd = await post({ ...resumePayload, expectedEndedAt: ts("2026-10-03", "19:59") });
    assert.equal(staleEnd.status, 409);
    assert.equal((await staleEnd.json()).code, "STALE_EPISODE");

    await client.execute({
      sql: `INSERT INTO sick_mode_episodes
            (id, baby_id, started_at, ended_at, baseline_daily_ml, baseline_kind,
             baseline_available_day_count, baseline_source_days, created_at, created_by, ended_by)
            VALUES (?, ?, ?, NULL, ?, 'manual', 0, '[]', ?, ?, NULL)`,
      args: ["resume-active-overlap", "baby-1", ts("2026-10-05", "08:00"), 600, ts("2026-10-05", "08:00"), "Parent One"],
    });
    const activeOverlap = await post(resumePayload);
    assert.equal(activeOverlap.status, 409);
    assert.equal((await activeOverlap.json()).code, "EPISODE_OVERLAP");
    await client.execute({ sql: "DELETE FROM sick_mode_episodes WHERE id = ?", args: ["resume-active-overlap"] });

    await client.execute({
      sql: `INSERT INTO sick_mode_episodes
            (id, baby_id, started_at, ended_at, baseline_daily_ml, baseline_kind,
             baseline_available_day_count, baseline_source_days, created_at, created_by, ended_by)
            VALUES (?, ?, ?, ?, ?, 'manual', 0, '[]', ?, ?, ?)`,
      args: ["resume-newer-ended", "baby-1", ts("2026-10-04", "08:00"), ts("2026-10-05", "08:00"), 600, ts("2026-10-04", "08:00"), "Parent One", "Parent One"],
    });
    const endedOverlap = await post(resumePayload);
    assert.equal(endedOverlap.status, 409, "an older episode cannot resume through a newer ended episode");
    assert.equal((await endedOverlap.json()).code, "EPISODE_OVERLAP");
    await client.execute({ sql: "DELETE FROM sick_mode_episodes WHERE id = ?", args: ["resume-newer-ended"] });

    // A fully earlier episode is not part of the proposed continuous interval.
    await client.execute({
      sql: `INSERT INTO sick_mode_episodes
            (id, baby_id, started_at, ended_at, baseline_daily_ml, baseline_kind,
             baseline_available_day_count, baseline_source_days, created_at, created_by, ended_by)
            VALUES (?, ?, ?, ?, ?, 'manual', 0, '[]', ?, ?, ?)`,
      args: ["resume-earlier", "baby-1", ts("2026-09-30", "00:00"), ts("2026-10-01", "00:00"), 600, ts("2026-09-30", "00:00"), "Parent One", "Parent One"],
    });

    const resumed = await post(resumePayload);
    assert.equal(resumed.status, 200);
    assert.deepEqual(await resumed.json(), { ok: true, episodeId });

    const episodeAfter = { ...(await client.execute({ sql: "SELECT * FROM sick_mode_episodes WHERE id = ?", args: [episodeId] })).rows[0] };
    assert.deepEqual(episodeAfter, { ...episodeBefore, ended_at: null, ended_by: null }, "resume must only clear the episode end fields");
    const medicationsAfter = (await client.execute({ sql: "SELECT * FROM sick_mode_medications WHERE episode_id = ? ORDER BY id", args: [episodeId] })).rows.map((row) => ({ ...row }));
    const dosesAfter = (await client.execute({ sql: `SELECT d.* FROM sick_mode_doses d
                                                      JOIN sick_mode_medications m ON m.id = d.medication_id
                                                      WHERE m.episode_id = ? ORDER BY d.id`, args: [episodeId] })).rows.map((row) => ({ ...row }));
    assert.deepEqual(medicationsAfter, medicationsBefore, "medication setup must be preserved exactly");
    assert.deepEqual(dosesAfter, dosesBefore, "dose history must be preserved exactly");
    assert.deepEqual((await client.execute("SELECT * FROM activities ORDER BY id")).rows.map((row) => ({ ...row })), activitiesBefore, "resume must not write activity rows");

    const active = await (await GET(request("/api/sick-mode?babyId=baby-1"))).json();
    assert.equal(active.activeEpisode.id, episodeId);
    const afterHistory = await (await getMilkHistory(request("/api/milk-history?babyId=baby-1"))).json();
    assert.equal(afterHistory.days.find((day: { date: string }) => day.date === "2026-10-04").isSickDay, true, "the former gap becomes part of the resumed continuous episode");

    const lostSuccessRetry = await post(resumePayload);
    assert.equal(lostSuccessRetry.status, 200);
    assert.deepEqual(await lostSuccessRetry.json(), { ok: true, episodeId, idempotent: true });
    const activeStaleStart = await post({ ...resumePayload, expectedStartedAt: ts("2026-10-03", "07:59") });
    assert.equal(activeStaleStart.status, 409);
    assert.equal((await activeStaleStart.json()).code, "STALE_EPISODE");

    // Once reopened, the existing editor can move the start and recompute a calculated baseline.
    const movedStartAt = ts("2026-10-02", "08:00");
    const moved = await post({
      action: "updateStart",
      babyId: "baby-1",
      episodeId,
      startedAt: movedStartAt,
      expectedStartedAt: originalStartedAt,
      confirmIncomplete: true,
    });
    assert.equal(moved.status, 200);
    const movedRow = (await client.execute({
      sql: `SELECT started_at, baseline_daily_ml, baseline_kind,
                   baseline_available_day_count, baseline_source_days
            FROM sick_mode_episodes WHERE id = ?`,
      args: [episodeId],
    })).rows[0];
    assert.equal(Number(movedRow.started_at), movedStartAt);
    assert.equal(Number(movedRow.baseline_daily_ml), 350);
    assert.equal(String(movedRow.baseline_kind), "calculated");
    assert.equal(Number(movedRow.baseline_available_day_count), 6);
    assert.notEqual(String(movedRow.baseline_source_days), String(episodeBefore.baseline_source_days));
    assert.deepEqual((await client.execute("SELECT * FROM activities ORDER BY id")).rows.map((row) => ({ ...row })), activitiesBefore, "editing the resumed start must not rewrite activities");

    const reEndedAt = ts("2026-10-06", "11:30");
    const reEnded = await post({ action: "end", babyId: "baby-1", episodeId, endedAt: reEndedAt });
    assert.equal(reEnded.status, 200);
    const staleSecondResume = await post({
      ...resumePayload,
      expectedStartedAt: movedStartAt,
      expectedEndedAt: originalEndedAt,
    });
    assert.equal(staleSecondResume.status, 409, "a later end must invalidate the previously captured end time");
    assert.equal((await staleSecondResume.json()).code, "STALE_EPISODE");
    const finalRow = (await client.execute({ sql: "SELECT ended_at, ended_by FROM sick_mode_episodes WHERE id = ?", args: [episodeId] })).rows[0];
    assert.equal(Number(finalRow.ended_at), reEndedAt);
    assert.equal(String(finalRow.ended_by), "Parent One");
  } finally {
    Date.now = originalNow;
    client.close();
  }
});
