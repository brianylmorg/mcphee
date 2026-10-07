import type { Client } from "@libsql/client";
import { isSickModeSchemaReady } from "@/db/sick-mode-schema";
import { normalizeActivityCreators } from "@/lib/activity-creators";

export const TIMELINE_TYPES = new Set([
  "bottlefeed", "breastfeed", "pump", "diaper", "vomit", "sleep", "bankadjust",
  "note", "temperature", "bankfreeze", "bankthaw", "bankdiscard", "medication",
]);

export type MedicationDoseReference = {
  doseId: string;
  medicationId: string;
  episodeId: string;
  revision: number;
  medicationName: string;
  doseText: string;
  episodeStartedAt: number;
  episodeEndedAt: number | null;
};

export type TimelineRecord = Record<string, unknown> & {
  id: string;
  baby_id: string;
  type: string;
  started_at: number;
  ended_at: number | null;
  details: string | null;
  created_at: number;
  created_by: string | null;
  medicationDose?: MedicationDoseReference;
};

/** One diary view over the existing records. Medication doses are never copied
 * into activities, so historical edits/deletions have one source of truth. */
export async function readActivityTimeline(
  db: Pick<Client, "execute" | "batch">,
  householdId: string,
  { babyId, types = [], date, limit = null }: {
    babyId?: string | null;
    types?: string[];
    date?: string | null;
    limit?: number | null;
  } = {},
): Promise<TimelineRecord[]> {
  const args: Array<string | number> = [householdId];
  let activityWhere = "b.household_id = ?";
  if (babyId) { activityWhere += " AND a.baby_id = ?"; args.push(babyId); }
  const ordinaryTypes = types.filter(type => type !== "medication");
  if (types.length) {
    activityWhere += ordinaryTypes.length
      ? ` AND a.type IN (${ordinaryTypes.map(() => "?").join(",")})`
      : " AND 0";
    args.push(...ordinaryTypes);
  }
  const dayStart = date ? Date.parse(date + "T00:00:00+08:00") : null;
  if (dayStart != null) {
    if (!Number.isFinite(dayStart)) throw new Error("Invalid date");
    activityWhere += " AND ((a.started_at >= ? AND a.started_at < ?) OR (a.type = 'sleep' AND a.ended_at >= ? AND a.ended_at < ?))";
    args.push(dayStart, dayStart + 86400000, dayStart, dayStart + 86400000);
  }
  let sql = `SELECT a.id, a.baby_id, a.type, a.started_at, a.ended_at, a.details,
    a.created_at, a.created_by, b.name AS baby_name, NULL AS medication_dose_json
    FROM activities a JOIN babies b ON b.id = a.baby_id WHERE ${activityWhere}`;

  if ((!types.length || types.includes("medication")) && await isSickModeSchemaReady(db)) {
    let doseWhere = "b.household_id = ? AND d.deleted_at IS NULL";
    args.push(householdId);
    if (babyId) { doseWhere += " AND e.baby_id = ?"; args.push(babyId); }
    if (dayStart != null) {
      doseWhere += " AND d.given_at >= ? AND d.given_at < ?";
      args.push(dayStart, dayStart + 86400000);
    }
    sql += ` UNION ALL SELECT 'medication-dose:' || d.id, e.baby_id, 'medication', d.given_at,
      NULL, json_object('medicationName', m.name, 'doseText', d.dose_text), d.created_at,
      d.given_by, b.name,
      json_object('doseId', d.id, 'medicationId', m.id, 'episodeId', e.id,
        'revision', d.revision, 'medicationName', m.name, 'doseText', d.dose_text,
        'episodeStartedAt', e.started_at, 'episodeEndedAt', e.ended_at)
      FROM sick_mode_doses d JOIN sick_mode_medications m ON m.id = d.medication_id
      JOIN sick_mode_episodes e ON e.id = m.episode_id JOIN babies b ON b.id = e.baby_id
      WHERE ${doseWhere}`;
  }
  sql = `SELECT * FROM (${sql}) ORDER BY started_at DESC, created_at DESC, id DESC`;
  if (limit != null) { sql += " LIMIT ?"; args.push(limit); }
  const [result, users] = await db.batch([
    { sql, args },
    { sql: "SELECT name FROM users WHERE household_id = ?", args: [householdId] },
  ], "read");
  const rows = result.rows.map(row => {
    const { medication_dose_json, ...record } = row as unknown as Record<string, unknown>;
    return {
      ...record,
      created_by: record.created_by,
      ...(medication_dose_json == null ? {} : {
        medicationDose: JSON.parse(String(medication_dose_json)) as MedicationDoseReference,
      }),
    };
  });
  return normalizeActivityCreators(rows, users.rows.map(row => ({ name: row.name }))) as TimelineRecord[];
}
