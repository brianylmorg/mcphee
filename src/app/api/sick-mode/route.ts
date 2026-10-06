import { NextRequest, NextResponse } from "next/server";

import { createDB } from "@/db";
import { isSickModeSchemaReady } from "@/db/sick-mode-schema";
import { requireBabyInHousehold, userNameForHousehold } from "@/lib/db/household";
import { bottleVolumes, parseActivityDetails, sgtDateKey } from "@/lib/milk-volumes";
import {
  buildBaselinePreview,
  episodeOverlapsSgtDate,
  parseEpisodeSourceDays,
  parsePeeUnits,
  sgtDayStart,
  shiftSgtDate,
  type SickActivityRow,
  type SickBaselinePreview,
  type SickDose,
  type SickEpisode,
  type SickEpisodeRange,
  type SickMedication,
  type SickModeResponse,
  type SickModeSummary,
} from "@/lib/sick-mode";
import { generateId } from "@/lib/utils";

export const runtime = "nodejs";

const NO_STORE_HEADERS = { "Cache-Control": "private, no-store, max-age=0" };
const MAX_TEXT_LENGTH = 120;
const MAX_BASELINE_ML = 10_000;
const MAX_INTERVAL_HOURS = 168;

type SqlValue = string | number | null;
type Executor = {
  execute: (statement: string | { sql: string; args: SqlValue[] }) => Promise<{
    rows: Array<Record<string, unknown>>;
    rowsAffected?: number;
  }>;
};

class SickModeApiError extends Error {
  constructor(public status: number, message: string, public code?: string) {
    super(message);
  }
}

function apiError(error: unknown) {
  if (error instanceof SickModeApiError) {
    return NextResponse.json(
      { error: error.message, ...(error.code ? { code: error.code } : {}) },
      { status: error.status },
    );
  }
  const message = error instanceof Error ? error.message : String(error);
  if (/no such table|no such index/i.test(message)) {
    return NextResponse.json(
      { error: "Sick mode database migration is required", code: "SCHEMA_NOT_READY" },
      { status: 503 },
    );
  }
  console.error("Sick mode API error:", error);
  return NextResponse.json({ error: "Internal server error" }, { status: 500 });
}

function requiredId(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  if (typeof value !== "string" || !value.trim()) throw new SickModeApiError(400, `${key} is required`);
  return value.trim();
}

function boundedText(body: Record<string, unknown>, key: string): string {
  const value = requiredId(body, key);
  if (value.length > MAX_TEXT_LENGTH) throw new SickModeApiError(400, `${key} is too long`);
  return value;
}

function requiredTimestamp(body: Record<string, unknown>, key: string, now: number): number {
  const value = Number(body[key]);
  if (!Number.isFinite(value) || value <= 0) throw new SickModeApiError(400, `${key} must be a valid timestamp`);
  if (value > now) throw new SickModeApiError(400, `${key} cannot be in the future`);
  return Math.trunc(value);
}

function optionalIntervalHours(body: Record<string, unknown>, key: string): number | null {
  const raw = body[key];
  if (raw == null || raw === "") return null;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 1 / 60 || value > MAX_INTERVAL_HOURS) {
    throw new SickModeApiError(400, `${key} must be between 0 and ${MAX_INTERVAL_HOURS} hours`);
  }
  return Math.round(value * 100) / 100;
}

function asBoolean(body: Record<string, unknown>, key: string): boolean {
  if (typeof body[key] !== "boolean") throw new SickModeApiError(400, `${key} must be true or false`);
  return body[key] as boolean;
}

function parseEpisode(row: Record<string, unknown>): SickEpisode {
  return {
    id: String(row.id),
    babyId: String(row.baby_id),
    startedAt: Number(row.started_at),
    endedAt: row.ended_at == null ? null : Number(row.ended_at),
    baselineDailyMl: Number(row.baseline_daily_ml),
    baselineKind: row.baseline_kind === "manual" ? "manual" : "calculated",
    baselineAvailableDayCount: Number(row.baseline_available_day_count),
    baselineSourceDays: parseEpisodeSourceDays(row.baseline_source_days),
    createdAt: Number(row.created_at),
    createdBy: row.created_by == null ? null : String(row.created_by),
    endedBy: row.ended_by == null ? null : String(row.ended_by),
  };
}

function parseDose(row: Record<string, unknown>): SickDose {
  return {
    id: String(row.id),
    medicationId: String(row.medication_id),
    givenAt: Number(row.given_at),
    doseText: String(row.dose_text),
    givenBy: row.given_by == null ? null : String(row.given_by),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    revision: Number(row.revision),
  };
}

async function loadBaselinePreview(
  db: Executor,
  babyId: string,
  startedAt: number,
): Promise<SickBaselinePreview> {
  const onsetDayStart = sgtDayStart(startedAt);
  const firstDayStart = onsetDayStart - 7 * 24 * 60 * 60 * 1000;
  const [activities, episodeRows] = await Promise.all([
    db.execute({
      sql: `SELECT id, type, started_at, created_at, details FROM activities
            WHERE baby_id = ? AND type = 'bottlefeed' AND started_at >= ? AND started_at < ?
            ORDER BY started_at ASC, created_at ASC, id ASC`,
      args: [babyId, firstDayStart, onsetDayStart],
    }),
    db.execute({
      sql: `SELECT started_at, ended_at FROM sick_mode_episodes
            WHERE baby_id = ? AND started_at < ? AND (ended_at IS NULL OR ended_at > ?)`,
      args: [babyId, onsetDayStart, firstDayStart],
    }),
  ]);
  const ranges: SickEpisodeRange[] = episodeRows.rows.map((row) => ({
    startedAt: Number(row.started_at),
    endedAt: row.ended_at == null ? null : Number(row.ended_at),
  }));
  return buildBaselinePreview(startedAt, activities.rows as unknown as SickActivityRow[], ranges);
}

async function requireOwnedEpisode(
  db: Executor,
  householdId: string,
  babyId: string,
  episodeId: string,
): Promise<Record<string, unknown>> {
  const result = await db.execute({
    sql: `SELECT e.* FROM sick_mode_episodes e
          JOIN babies b ON b.id = e.baby_id
          WHERE e.id = ? AND e.baby_id = ? AND b.household_id = ? LIMIT 1`,
    args: [episodeId, babyId, householdId],
  });
  if (!result.rows[0]) throw new SickModeApiError(404, "Sick mode episode not found");
  return result.rows[0];
}

async function requireOwnedMedication(
  db: Executor,
  householdId: string,
  babyId: string,
  episodeId: string,
  medicationId: string,
): Promise<Record<string, unknown>> {
  const result = await db.execute({
    sql: `SELECT m.*, e.started_at AS episode_started_at, e.ended_at AS episode_ended_at
          FROM sick_mode_medications m
          JOIN sick_mode_episodes e ON e.id = m.episode_id
          JOIN babies b ON b.id = e.baby_id
          WHERE m.id = ? AND m.episode_id = ? AND e.baby_id = ? AND b.household_id = ? LIMIT 1`,
    args: [medicationId, episodeId, babyId, householdId],
  });
  if (!result.rows[0]) throw new SickModeApiError(404, "Medication not found");
  return result.rows[0];
}

async function requireOwnedDose(
  db: Executor,
  householdId: string,
  babyId: string,
  episodeId: string,
  medicationId: string,
  doseId: string,
): Promise<Record<string, unknown>> {
  const result = await db.execute({
    sql: `SELECT d.*, e.started_at AS episode_started_at, e.ended_at AS episode_ended_at
          FROM sick_mode_doses d
          JOIN sick_mode_medications m ON m.id = d.medication_id
          JOIN sick_mode_episodes e ON e.id = m.episode_id
          JOIN babies b ON b.id = e.baby_id
          WHERE d.id = ? AND d.medication_id = ? AND m.episode_id = ?
            AND e.baby_id = ? AND b.household_id = ? AND d.deleted_at IS NULL LIMIT 1`,
    args: [doseId, medicationId, episodeId, babyId, householdId],
  });
  if (!result.rows[0]) throw new SickModeApiError(404, "Medication dose not found");
  return result.rows[0];
}

async function loadMedications(db: Executor, episodeId: string): Promise<SickMedication[]> {
  const [medicationRows, doseRows] = await Promise.all([
    db.execute({
      sql: `SELECT * FROM sick_mode_medications WHERE episode_id = ?
            ORDER BY created_at ASC, id ASC`,
      args: [episodeId],
    }),
    db.execute({
      sql: `SELECT d.* FROM sick_mode_doses d
            JOIN sick_mode_medications m ON m.id = d.medication_id
            WHERE m.episode_id = ? AND d.deleted_at IS NULL
            ORDER BY d.given_at DESC, d.created_at DESC, d.id DESC`,
      args: [episodeId],
    }),
  ]);
  const dosesByMedication = new Map<string, SickDose[]>();
  for (const row of doseRows.rows) {
    const dose = parseDose(row);
    dosesByMedication.set(dose.medicationId, [...(dosesByMedication.get(dose.medicationId) ?? []), dose]);
  }
  return medicationRows.rows.map((row) => {
    const doses = dosesByMedication.get(String(row.id)) ?? [];
    return {
      id: String(row.id),
      episodeId: String(row.episode_id),
      name: String(row.name),
      doseText: String(row.dose_text),
      asNeeded: Number(row.as_needed) === 1,
      minIntervalHours: row.min_interval_minutes == null ? null : Number(row.min_interval_minutes) / 60,
      maxIntervalHours: row.max_interval_minutes == null ? null : Number(row.max_interval_minutes) / 60,
      createdAt: Number(row.created_at),
      createdBy: row.created_by == null ? null : String(row.created_by),
      revision: Number(row.revision),
      latestDose: doses[0] ?? null,
      doses,
    };
  });
}

async function loadSummary(
  db: Executor,
  babyId: string,
  episode: SickEpisode,
  asOfTimestamp: number,
): Promise<SickModeSummary> {
  const result = await db.execute({
    sql: `SELECT id, type, started_at, created_at, details FROM activities
          WHERE baby_id = ? AND type IN ('bottlefeed', 'diaper', 'temperature') AND started_at <= ?
          ORDER BY started_at DESC, created_at DESC, id DESC`,
    args: [babyId, asOfTimestamp],
  });
  const rows = result.rows as unknown as SickActivityRow[];
  const today = sgtDateKey(asOfTimestamp);
  const latestFeeds: SickModeSummary["latestFeeds"] = [];
  const latestDiapers: SickModeSummary["latestDiapers"] = [];
  let latestTemperature: SickModeSummary["latestTemperature"] = null;
  let todayConsumedMl = 0;
  let todayBreastmilkMl = 0;
  let todayFormulaMl = 0;
  let todayFeedDataAvailable = false;
  let peeUnitsToday = 0;
  let wetDiaperCountToday = 0;
  let lastWetAt: number | null = null;
  const consumedByDate = new Map<string, number>();

  for (const row of rows) {
    const startedAt = Number(row.started_at);
    if (!Number.isFinite(startedAt)) continue;
    const date = sgtDateKey(startedAt);
    const details = parseActivityDetails(row.details);
    if (row.type === "bottlefeed") {
      const volumes = bottleVolumes(details);
      const totalMl = volumes.breastmilkMl + volumes.formulaMl;
      if (totalMl <= 0) continue;
      consumedByDate.set(date, (consumedByDate.get(date) ?? 0) + totalMl);
      if (date === today) {
        todayConsumedMl += totalMl;
        todayBreastmilkMl += volumes.breastmilkMl;
        todayFormulaMl += volumes.formulaMl;
        todayFeedDataAvailable = true;
      }
      if (latestFeeds.length < 3) {
        latestFeeds.push({
          id: String(row.id),
          startedAt,
          totalMl,
          breastmilkMl: volumes.breastmilkMl,
          formulaMl: volumes.formulaMl,
        });
      }
      continue;
    }
    if (row.type === "diaper") {
      const peeUnits = parsePeeUnits(details);
      const isWet = peeUnits == null ? null : peeUnits > 0;
      if (isWet && lastWetAt == null) lastWetAt = startedAt;
      if (date === today && peeUnits != null) {
        peeUnitsToday += peeUnits;
        if (peeUnits > 0) wetDiaperCountToday += 1;
      }
      if (latestDiapers.length < 3) {
        const rawPoop = details.poop;
        latestDiapers.push({
          id: String(row.id),
          startedAt,
          peeUnits,
          isWet,
          poop: typeof rawPoop === "string" && rawPoop.trim() && !/^no$/i.test(rawPoop)
            ? rawPoop.trim()
            : null,
        });
      }
      continue;
    }
    if (row.type === "temperature" && latestTemperature == null) {
      const celsius = Number(details.celsius);
      if (Number.isFinite(celsius) && celsius >= 30 && celsius <= 45) {
        latestTemperature = {
          id: String(row.id),
          measuredAt: startedAt,
          celsius,
          method: typeof details.method === "string" && details.method.trim() ? details.method : null,
        };
      }
    }
  }

  const thresholdMl = Math.round(episode.baselineDailyMl * 50) / 100;
  const onsetDate = sgtDateKey(episode.startedAt);
  let lastCompletedDayConcern: SickModeSummary["lastCompletedDayConcern"] = null;
  for (let date = shiftSgtDate(today, -1); date >= onsetDate; date = shiftSgtDate(date, -1)) {
    const totalMl = consumedByDate.get(date);
    if (totalMl != null && totalMl > 0 && totalMl < thresholdMl) {
      lastCompletedDayConcern = {
        date,
        totalMl: Math.round(totalMl * 100) / 100,
        thresholdMl,
      };
      break;
    }
    if (date === onsetDate) break;
  }

  return {
    date: today,
    todayConsumedMl: Math.round(todayConsumedMl * 100) / 100,
    todayBreastmilkMl: Math.round(todayBreastmilkMl * 100) / 100,
    todayFormulaMl: Math.round(todayFormulaMl * 100) / 100,
    todayFeedDataAvailable,
    expectedDailyMl: episode.baselineDailyMl,
    thresholdMl,
    latestFeeds,
    lastCompletedDayConcern,
    peeUnitsToday,
    wetDiaperCountToday,
    lastWetAt,
    latestDiapers,
    latestTemperature,
  };
}

function unavailableResponse(asOfTimestamp: number): SickModeResponse {
  return {
    schemaReady: false,
    asOfTimestamp,
    activeEpisode: null,
    archivedEpisode: null,
    episodes: [],
    baselinePreview: null,
    medicationSuggestions: [],
    medications: [],
    archivedMedications: [],
    summary: null,
    error: "Sick mode database migration is required",
  };
}

export async function GET(request: NextRequest) {
  const asOfTimestamp = Date.now();
  const householdId = request.cookies.get("mcphee_hh")?.value;
  if (!householdId) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: NO_STORE_HEADERS });
  const babyId = new URL(request.url).searchParams.get("babyId");
  if (!babyId) return NextResponse.json({ error: "babyId is required" }, { status: 400, headers: NO_STORE_HEADERS });

  try {
    const db = createDB();
    const babyError = await requireBabyInHousehold(db, babyId, householdId);
    if (babyError) {
      babyError.headers.set("Cache-Control", NO_STORE_HEADERS["Cache-Control"]);
      return babyError;
    }
    if (!(await isSickModeSchemaReady(db))) {
      return NextResponse.json(unavailableResponse(asOfTimestamp), { headers: NO_STORE_HEADERS });
    }

    const searchParams = new URL(request.url).searchParams;
    const requestedStartedAt = Number(searchParams.get("startedAt") ?? asOfTimestamp);
    const archivedEpisodeId = searchParams.get("episodeId");
    if (!Number.isFinite(requestedStartedAt) || requestedStartedAt <= 0 || requestedStartedAt > asOfTimestamp) {
      return NextResponse.json({ error: "startedAt must be a valid non-future timestamp" }, { status: 400, headers: NO_STORE_HEADERS });
    }

    const [episodeResult, suggestionResult, baselinePreview] = await Promise.all([
      db.execute({
        sql: `SELECT * FROM sick_mode_episodes WHERE baby_id = ?
              ORDER BY started_at DESC, created_at DESC, id DESC`,
        args: [babyId],
      }),
      db.execute({
        sql: `SELECT m.name, MAX(m.created_at) AS last_used_at FROM sick_mode_medications m
              JOIN sick_mode_episodes e ON e.id = m.episode_id
              JOIN babies b ON b.id = e.baby_id
              WHERE b.household_id = ?
              GROUP BY LOWER(m.name)
              ORDER BY last_used_at DESC, m.name ASC`,
        args: [householdId],
      }),
      loadBaselinePreview(db as unknown as Executor, babyId, Math.trunc(requestedStartedAt)),
    ]);
    const episodes = episodeResult.rows.map(parseEpisode);
    const activeEpisode = episodes.find((episode) => episode.endedAt == null) ?? null;
    const archivedEpisode = archivedEpisodeId
      ? episodes.find((episode) => episode.id === archivedEpisodeId && episode.endedAt != null) ?? null
      : null;
    if (archivedEpisodeId && !archivedEpisode) {
      return NextResponse.json({ error: "Archived sick mode episode not found" }, { status: 404, headers: NO_STORE_HEADERS });
    }
    const [medications, summary, archivedMedications] = await Promise.all([
      activeEpisode ? loadMedications(db as unknown as Executor, activeEpisode.id) : Promise.resolve([]),
      activeEpisode ? loadSummary(db as unknown as Executor, babyId, activeEpisode, asOfTimestamp) : Promise.resolve(null),
      archivedEpisode ? loadMedications(db as unknown as Executor, archivedEpisode.id) : Promise.resolve([]),
    ]);
    const response: SickModeResponse = {
      schemaReady: true,
      asOfTimestamp,
      activeEpisode,
      archivedEpisode,
      episodes,
      baselinePreview,
      medicationSuggestions: suggestionResult.rows.map((row) => String(row.name)),
      medications,
      archivedMedications,
      summary,
    };
    return NextResponse.json(response, { headers: NO_STORE_HEADERS });
  } catch (error) {
    const response = apiError(error);
    response.headers.set("Cache-Control", NO_STORE_HEADERS["Cache-Control"]);
    return response;
  }
}

export async function POST(request: NextRequest) {
  const householdId = request.cookies.get("mcphee_hh")?.value;
  if (!householdId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const action = typeof body.action === "string" ? body.action : "";
  const babyId = typeof body.babyId === "string" ? body.babyId.trim() : "";
  if (!babyId) return NextResponse.json({ error: "babyId is required" }, { status: 400 });

  const db = createDB();
  try {
    const babyError = await requireBabyInHousehold(db, babyId, householdId);
    if (babyError) return babyError;
    if (!(await isSickModeSchemaReady(db))) {
      throw new SickModeApiError(503, "Sick mode database migration is required", "SCHEMA_NOT_READY");
    }
    const createdBy = await userNameForHousehold(
      db,
      request.cookies.get("mcphee_user")?.value,
      householdId,
    );
    const tx = await db.transaction("write");
    try {
      const executor = tx as unknown as Executor;
      const now = Date.now();
      let result: Record<string, unknown>;

      if (action === "start") {
        const startedAt = requiredTimestamp(body, "startedAt", now);
        const overlap = await executor.execute({
          sql: `SELECT id FROM sick_mode_episodes
                WHERE baby_id = ? AND (ended_at IS NULL OR ended_at > ?) LIMIT 1`,
          args: [babyId, startedAt],
        });
        if (overlap.rows[0]) {
          throw new SickModeApiError(409, "Sick mode cannot overlap another episode", "EPISODE_OVERLAP");
        }
        const preview = await loadBaselinePreview(executor, babyId, startedAt);
        const rawManual = body.manualBaselineMl;
        const hasManual = rawManual != null && rawManual !== "";
        const manualBaselineMl = Number(rawManual);
        if (hasManual && (!Number.isFinite(manualBaselineMl) || manualBaselineMl <= 0 || manualBaselineMl > MAX_BASELINE_ML)) {
          throw new SickModeApiError(400, `manualBaselineMl must be between 0 and ${MAX_BASELINE_ML}`);
        }
        if (!hasManual && preview.requiresManualBaseline) {
          throw new SickModeApiError(400, "A positive manual baseline is required because no eligible feed days were found", "MANUAL_BASELINE_REQUIRED");
        }
        if (!hasManual && preview.requiresIncompleteConfirmation && body.confirmIncomplete !== true) {
          throw new SickModeApiError(400, "Confirm the incomplete baseline before starting sick mode", "INCOMPLETE_BASELINE_CONFIRMATION_REQUIRED");
        }
        const baselineDailyMl = hasManual ? Math.round(manualBaselineMl * 100) / 100 : preview.medianDailyMl!;
        const episodeId = generateId();
        await executor.execute({
          sql: `INSERT INTO sick_mode_episodes
                (id, baby_id, started_at, ended_at, baseline_daily_ml, baseline_kind,
                 baseline_available_day_count, baseline_source_days, created_at, created_by, ended_by)
                VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, NULL)`,
          args: [
            episodeId,
            babyId,
            startedAt,
            baselineDailyMl,
            hasManual ? "manual" : "calculated",
            preview.availableDayCount,
            JSON.stringify(preview.sourceDays),
            now,
            createdBy,
          ],
        });
        result = { ok: true, episodeId };
      } else if (action === "end") {
        const episodeId = requiredId(body, "episodeId");
        const episode = await requireOwnedEpisode(executor, householdId, babyId, episodeId);
        if (episode.ended_at != null) throw new SickModeApiError(409, "Sick mode episode has already ended");
        const endedAt = body.endedAt == null ? now : requiredTimestamp(body, "endedAt", now);
        if (endedAt < Number(episode.started_at)) throw new SickModeApiError(400, "endedAt cannot be before sick mode started");
        const laterDose = await executor.execute({
          sql: `SELECT d.id FROM sick_mode_doses d
                JOIN sick_mode_medications m ON m.id = d.medication_id
                WHERE m.episode_id = ? AND d.deleted_at IS NULL AND d.given_at > ? LIMIT 1`,
          args: [episodeId, endedAt],
        });
        if (laterDose.rows[0]) throw new SickModeApiError(400, "endedAt cannot be before a logged medication dose");
        const update = await executor.execute({
          sql: "UPDATE sick_mode_episodes SET ended_at = ?, ended_by = ? WHERE id = ? AND ended_at IS NULL",
          args: [endedAt, createdBy, episodeId],
        });
        if ((update.rowsAffected ?? 0) !== 1) throw new SickModeApiError(409, "Sick mode episode changed on another device");
        result = { ok: true, episodeId };
      } else if (action === "addMedication" || action === "updateMedication") {
        const episodeId = requiredId(body, "episodeId");
        const episode = await requireOwnedEpisode(executor, householdId, babyId, episodeId);
        if (episode.ended_at != null) throw new SickModeApiError(409, "Medication setup cannot be changed after sick mode ends");
        const name = boundedText(body, "name");
        const doseText = boundedText(body, "doseText");
        const asNeeded = asBoolean(body, "asNeeded");
        const minIntervalHours = optionalIntervalHours(body, "minIntervalHours");
        const maxIntervalHours = optionalIntervalHours(body, "maxIntervalHours");
        if (minIntervalHours != null && maxIntervalHours != null && minIntervalHours > maxIntervalHours) {
          throw new SickModeApiError(400, "minIntervalHours cannot exceed maxIntervalHours");
        }
        const minMinutes = minIntervalHours == null ? null : Math.round(minIntervalHours * 60);
        const maxMinutes = maxIntervalHours == null ? null : Math.round(maxIntervalHours * 60);
        if (action === "addMedication") {
          const medicationId = generateId();
          await executor.execute({
            sql: `INSERT INTO sick_mode_medications
                  (id, episode_id, name, dose_text, as_needed, min_interval_minutes,
                   max_interval_minutes, created_at, created_by, updated_at, revision)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
            args: [medicationId, episodeId, name, doseText, asNeeded ? 1 : 0, minMinutes, maxMinutes, now, createdBy, now],
          });
          result = { ok: true, id: medicationId, episodeId };
        } else {
          const medicationId = requiredId(body, "medicationId");
          await requireOwnedMedication(executor, householdId, babyId, episodeId, medicationId);
          const revision = Number(body.expectedRevision);
          if (!Number.isInteger(revision) || revision < 1) throw new SickModeApiError(400, "expectedRevision is required");
          const update = await executor.execute({
            sql: `UPDATE sick_mode_medications SET name = ?, dose_text = ?, as_needed = ?,
                  min_interval_minutes = ?, max_interval_minutes = ?, updated_at = ?, revision = revision + 1
                  WHERE id = ? AND revision = ?`,
            args: [name, doseText, asNeeded ? 1 : 0, minMinutes, maxMinutes, now, medicationId, revision],
          });
          if ((update.rowsAffected ?? 0) !== 1) {
            throw new SickModeApiError(409, "Medication changed on another device", "STALE_MEDICATION");
          }
          result = { ok: true, id: medicationId, episodeId };
        }
      } else if (action === "logDose") {
        const episodeId = requiredId(body, "episodeId");
        const medicationId = requiredId(body, "medicationId");
        const medication = await requireOwnedMedication(executor, householdId, babyId, episodeId, medicationId);
        if (medication.episode_ended_at != null) throw new SickModeApiError(409, "A new dose cannot be logged after sick mode ends");
        const givenAt = requiredTimestamp(body, "givenAt", now);
        if (givenAt < Number(medication.episode_started_at)) throw new SickModeApiError(400, "givenAt cannot be before sick mode started");
        const doseText = boundedText(body, "doseText");
        const requestId = boundedText(body, "requestId");
        const existing = await executor.execute({
          sql: "SELECT * FROM sick_mode_doses WHERE request_id = ? LIMIT 1",
          args: [requestId],
        });
        if (existing.rows[0]) {
          const row = existing.rows[0];
          if (String(row.medication_id) === medicationId && Number(row.given_at) === givenAt && String(row.dose_text) === doseText && row.deleted_at == null) {
            result = { ok: true, id: String(row.id), episodeId, idempotent: true };
          } else {
            throw new SickModeApiError(409, "requestId was already used for a different dose", "REQUEST_ID_CONFLICT");
          }
        } else {
          if (Object.prototype.hasOwnProperty.call(body, "expectedLatestDoseId")) {
            const latest = await executor.execute({
              sql: `SELECT id FROM sick_mode_doses WHERE medication_id = ? AND deleted_at IS NULL
                    ORDER BY given_at DESC, created_at DESC, id DESC LIMIT 1`,
              args: [medicationId],
            });
            const actualLatest = latest.rows[0] ? String(latest.rows[0].id) : null;
            const expectedLatest = body.expectedLatestDoseId == null ? null : String(body.expectedLatestDoseId);
            if (actualLatest !== expectedLatest) {
              throw new SickModeApiError(409, "Medication history changed on another device", "STALE_MEDICATION_HISTORY");
            }
          }
          const doseId = generateId();
          await executor.execute({
            sql: `INSERT INTO sick_mode_doses
                  (id, medication_id, given_at, dose_text, given_by, request_id,
                   created_at, updated_at, revision, deleted_at, deleted_by)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, NULL, NULL)`,
            args: [doseId, medicationId, givenAt, doseText, createdBy, requestId, now, now],
          });
          result = { ok: true, id: doseId, episodeId };
        }
      } else if (action === "updateDose") {
        const episodeId = requiredId(body, "episodeId");
        const medicationId = requiredId(body, "medicationId");
        const doseId = requiredId(body, "doseId");
        const dose = await requireOwnedDose(executor, householdId, babyId, episodeId, medicationId, doseId);
        const revision = Number(body.expectedRevision);
        if (!Number.isInteger(revision) || revision < 1) throw new SickModeApiError(400, "expectedRevision is required");
        const givenAt = requiredTimestamp(body, "givenAt", now);
        if (givenAt < Number(dose.episode_started_at) || (dose.episode_ended_at != null && givenAt > Number(dose.episode_ended_at))) {
          throw new SickModeApiError(400, "givenAt must fall within the sick mode episode");
        }
        const doseText = boundedText(body, "doseText");
        const update = await executor.execute({
          sql: `UPDATE sick_mode_doses SET given_at = ?, dose_text = ?, updated_at = ?, revision = revision + 1
                WHERE id = ? AND medication_id = ? AND revision = ? AND deleted_at IS NULL`,
          args: [givenAt, doseText, now, doseId, medicationId, revision],
        });
        if ((update.rowsAffected ?? 0) !== 1) throw new SickModeApiError(409, "Medication dose changed on another device", "STALE_DOSE");
        result = { ok: true, id: doseId, episodeId };
      } else if (action === "deleteDose") {
        const episodeId = requiredId(body, "episodeId");
        const medicationId = requiredId(body, "medicationId");
        const doseId = requiredId(body, "doseId");
        await requireOwnedDose(executor, householdId, babyId, episodeId, medicationId, doseId);
        const revision = Number(body.expectedRevision);
        if (!Number.isInteger(revision) || revision < 1) throw new SickModeApiError(400, "expectedRevision is required");
        const update = await executor.execute({
          sql: `UPDATE sick_mode_doses SET deleted_at = ?, deleted_by = ?, updated_at = ?, revision = revision + 1
                WHERE id = ? AND medication_id = ? AND revision = ? AND deleted_at IS NULL`,
          args: [now, createdBy, now, doseId, medicationId, revision],
        });
        if ((update.rowsAffected ?? 0) !== 1) throw new SickModeApiError(409, "Medication dose changed on another device", "STALE_DOSE");
        result = { ok: true, id: doseId, episodeId };
      } else {
        throw new SickModeApiError(400, "Unknown sick mode action");
      }

      await tx.commit();
      return NextResponse.json(result);
    } catch (error) {
      try { await tx.rollback(); } catch {}
      throw error;
    } finally {
      tx.close();
    }
  } catch (error) {
    return apiError(error);
  }
}
