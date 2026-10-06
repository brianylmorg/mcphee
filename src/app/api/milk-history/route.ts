import { NextRequest, NextResponse } from "next/server";
import { createDB } from "@/db";
import { isSickModeSchemaReady } from "@/db/sick-mode-schema";
import { requireBabyInHousehold } from "@/lib/db/household";
import { bottleVolumes, parseActivityDetails, sgtDateKey } from "@/lib/milk-volumes";
import { episodeOverlapsSgtDate, type SickEpisodeRange } from "@/lib/sick-mode";

export const runtime = "nodejs";

type MilkDay = {
  date: string;
  totalMl: number;
  breastmilkMl: number;
  formulaMl: number;
  expectedMl: number | null;
  asOfNowMl: number;
  isSickDay: boolean;
};

// Cap the replay window so the per-day reconstruction stays O(window) instead of
// growing with total history; the chart scrolls to the latest day either way.
const HISTORY_WINDOW_MS = 180 * 24 * 60 * 60 * 1000;

export async function GET(request: NextRequest) {
  const asOfTimestamp = Date.now();
  const householdId = request.cookies.get("mcphee_hh")?.value;
  if (!householdId) {
    return NextResponse.json({ days: [], asOfTimestamp }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
  }

  try {
    const db = createDB();
    const babyId = new URL(request.url).searchParams.get("babyId");
    if (babyId) {
      const babyError = await requireBabyInHousehold(db, babyId, householdId);
      if (babyError) return babyError;
    }

    const historyCutoff = asOfTimestamp - HISTORY_WINDOW_MS;
    let sickEpisodes: SickEpisodeRange[] = [];
    if (await isSickModeSchemaReady(db)) {
      let episodeSql = `SELECT e.started_at, e.ended_at FROM sick_mode_episodes e
                        JOIN babies b ON b.id = e.baby_id
                        WHERE b.household_id = ? AND e.started_at <= ?
                          AND (e.ended_at IS NULL OR e.ended_at >= ?)`;
      const episodeArgs: Array<string | number> = [householdId, asOfTimestamp, historyCutoff];
      if (babyId) {
        episodeSql += " AND e.baby_id = ?";
        episodeArgs.push(babyId);
      }
      const episodeResult = await db.execute({ sql: episodeSql, args: episodeArgs });
      sickEpisodes = episodeResult.rows.map((row) => ({
        startedAt: Number(row.started_at),
        endedAt: row.ended_at == null ? null : Number(row.ended_at),
      }));
    }

    let sql = `SELECT a.started_at, a.details FROM activities a
               JOIN babies b ON b.id = a.baby_id
               WHERE b.household_id = ? AND a.type = ? AND a.started_at >= ? AND a.started_at <= ?`;
    const args: Array<string | number> = [householdId, "bottlefeed", historyCutoff, asOfTimestamp];
    if (babyId) {
      sql += " AND a.baby_id = ?";
      args.push(babyId);
    }
    sql += " ORDER BY a.started_at ASC, a.created_at ASC";

    let measurementSql = `SELECT m.measured_at, m.weight_g FROM measurements m
                          JOIN babies b ON b.id = m.baby_id
                          WHERE b.household_id = ? AND m.weight_g IS NOT NULL AND m.measured_at >= ? AND m.measured_at <= ?`;
    const measurementArgs: Array<string | number> = [householdId, historyCutoff, asOfTimestamp];
    if (babyId) {
      measurementSql += " AND m.baby_id = ?";
      measurementArgs.push(babyId);
    }
    measurementSql += " ORDER BY m.measured_at ASC, m.created_at ASC";

    const [result, measurementResult] = await db.batch([
      { sql, args },
      { sql: measurementSql, args: measurementArgs },
    ], "read");
    const totalsByDate = new Map<string, MilkDay>();
    const todayStart = Date.parse(sgtDateKey(asOfTimestamp) + "T00:00:00+08:00");
    const asOfOffsetMs = Math.max(0, Math.min(24 * 60 * 60 * 1000, asOfTimestamp - todayStart));

    result.rows.forEach((row) => {
      const typedRow = row as unknown as { started_at: number; details: string | null };
      const date = sgtDateKey(Number(typedRow.started_at));
      const volumes = bottleVolumes(parseActivityDetails(typedRow.details));
      const current = totalsByDate.get(date) ?? {
        date,
        totalMl: 0,
        breastmilkMl: 0,
        formulaMl: 0,
        expectedMl: null,
        asOfNowMl: 0,
        isSickDay: sickEpisodes.some((episode) => episodeOverlapsSgtDate(episode, date)),
      };
      current.breastmilkMl += volumes.breastmilkMl;
      current.formulaMl += volumes.formulaMl;
      current.totalMl = current.breastmilkMl + current.formulaMl;
      const dayStart = Date.parse(date + "T00:00:00+08:00");
      if (Number(typedRow.started_at) - dayStart <= asOfOffsetMs) {
        current.asOfNowMl += volumes.breastmilkMl + volumes.formulaMl;
      }
      totalsByDate.set(date, current);
    });

    const firstDate = totalsByDate.keys().next().value as string | undefined;
    if (!firstDate) return NextResponse.json({ days: [], asOfTimestamp }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });

    const measurements = measurementResult.rows.map((row) => ({
      measuredAt: Number((row as unknown as { measured_at: unknown }).measured_at),
      weightG: Number((row as unknown as { weight_g: unknown }).weight_g),
    })).filter((measurement) => Number.isFinite(measurement.measuredAt) && Number.isFinite(measurement.weightG));
    const milkDates = Array.from(totalsByDate.keys());
    const today = sgtDateKey(asOfTimestamp);
    const lastDate = milkDates[milkDates.length - 1] > today ? milkDates[milkDates.length - 1] : today;
    const firstDayStart = Date.parse(firstDate + "T00:00:00+08:00");
    const lastDayStart = Date.parse(lastDate + "T00:00:00+08:00");
    const days: MilkDay[] = [];
    let measurementIndex = 0;
    let effectiveWeightG: number | null = null;

    for (let dayStart = firstDayStart; dayStart <= lastDayStart; dayStart += 24 * 60 * 60 * 1000) {
      const date = sgtDateKey(dayStart);
      const nextDayStart = dayStart + 24 * 60 * 60 * 1000;
      while (measurementIndex < measurements.length && measurements[measurementIndex].measuredAt < nextDayStart) {
        effectiveWeightG = measurements[measurementIndex].weightG;
        measurementIndex += 1;
      }
      const totals = totalsByDate.get(date) ?? {
        date, totalMl: 0, breastmilkMl: 0, formulaMl: 0, expectedMl: null, asOfNowMl: 0,
        isSickDay: sickEpisodes.some((episode) => episodeOverlapsSgtDate(episode, date)),
      };
      days.push({
        ...totals,
        expectedMl: effectiveWeightG == null ? null : Math.round((effectiveWeightG / 1000) * 150),
      });
    }

    return NextResponse.json({ days, asOfTimestamp }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
  } catch (error) {
    console.error("Milk history API error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
