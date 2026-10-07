import assert from "node:assert/strict";
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

    const firstMedicationPayload = { action: "addMedication", babyId: "baby-1", episodeId, requestId: "medication-request-1", name: "Paracetamol", doseText: "3.5ml", asNeeded: true, minIntervalHours: 4, maxIntervalHours: 6 };
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
      const response = await post({ action: "addMedication", babyId: "baby-1", episodeId, requestId: `medication-request-${index + 2}`, name, doseText: "3.5ml", asNeeded: true, minIntervalHours: 4, maxIntervalHours: 6 });
      assert.equal(response.status, 200);
      medicationIds.push((await response.json()).id);
    }
    const medicationId = medicationIds[0];
    const staleMedicationEdit = await post({ action: "updateMedication", babyId: "baby-1", episodeId, medicationId, name: "Paracetamol", doseText: "3.5ml", asNeeded: true, minIntervalHours: 4, maxIntervalHours: 6, expectedRevision: 9 });
    assert.equal(staleMedicationEdit.status, 409);
    const medicationEdit = await post({ action: "updateMedication", babyId: "baby-1", episodeId, medicationId, name: "Paracetamol", doseText: "3.5ml", asNeeded: true, minIntervalHours: 4, maxIntervalHours: 6, expectedRevision: 1 });
    assert.equal(medicationEdit.status, 200);
    const repeatedMedicationEdit = await post({ action: "updateMedication", babyId: "baby-1", episodeId, medicationId, name: "Paracetamol", doseText: "3.5ml", asNeeded: true, minIntervalHours: 4, maxIntervalHours: 6, expectedRevision: 1 });
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
