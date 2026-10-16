import type { Client } from "@libsql/client";

import { isChildcareModeSchemaReady } from "@/db/childcare-mode-schema";
import type { TimelineRecord } from "@/lib/activity-timeline";

type Options = {
  babyId?: string | null;
  types?: string[];
  date?: string | null;
  limit?: number | null;
};

const DAY_MS = 86_400_000;

function dateWindow(date: string | null | undefined) {
  if (!date) return null;
  const start = Date.parse(`${date}T00:00:00+08:00`);
  return Number.isFinite(start) ? { start, end: start + DAY_MS } : null;
}

function descending(a: TimelineRecord, b: TimelineRecord) {
  const byStart = Number(b.started_at) - Number(a.started_at);
  if (byStart !== 0) return byStart;
  const byCreated = Number(b.created_at) - Number(a.created_at);
  if (byCreated !== 0) return byCreated;
  return String(b.id).localeCompare(String(a.id));
}

export async function projectChildcareSessionLog(
  db: Pick<Client, "execute">,
  householdId: string,
  activities: TimelineRecord[],
  options: Options = {},
): Promise<TimelineRecord[]> {
  const { babyId = null, types = [], date = null, limit = null } = options;
  const cap = (rows: TimelineRecord[]) => limit == null ? rows : rows.slice(0, limit);
  if (types.length > 0 && !types.includes("note")) return cap(activities);
  if (!await isChildcareModeSchemaReady(db)) return cap(activities);

  const args: string[] = [householdId];
  let where = "b.household_id = ?";
  if (babyId) {
    where += " AND cs.baby_id = ?";
    args.push(babyId);
  }
  const result = await db.execute({
    sql: `SELECT cs.id, cs.baby_id, cs.checked_in_at, cs.checked_out_at,
                 cs.created_at, cs.updated_at, b.name AS baby_name
          FROM childcare_sessions cs JOIN babies b ON b.id = cs.baby_id
          WHERE ${where}`,
    args,
  });
  const window = dateWindow(date);
  const markers: TimelineRecord[] = [];
  for (const row of result.rows) {
    const sessionId = String(row.id);
    const markerBabyId = String(row.baby_id);
    const babyName = typeof row.baby_name === "string" ? row.baby_name : null;
    const boundaries = [
      { kind: "start" as const, at: Number(row.checked_in_at), notes: "Care started", createdAt: Number(row.created_at) },
      ...(row.checked_out_at == null ? [] : [{ kind: "end" as const, at: Number(row.checked_out_at), notes: "Care ended", createdAt: Number(row.updated_at) }]),
    ];
    for (const boundary of boundaries) {
      if (!Number.isSafeInteger(boundary.at) || boundary.at <= 0) continue;
      if (window && (boundary.at < window.start || boundary.at >= window.end)) continue;
      markers.push({
        id: `childcare-care:${sessionId}:${boundary.kind}`,
        baby_id: markerBabyId,
        type: "note",
        started_at: boundary.at,
        ended_at: null,
        details: JSON.stringify({ notes: boundary.notes }),
        created_at: Number.isSafeInteger(boundary.createdAt) ? boundary.createdAt : boundary.at,
        created_by: "childcare",
        baby_name: babyName,
        careBoundary: boundary.kind,
      });
    }
  }
  const merged = [...activities, ...markers];
  merged.sort(descending);
  return cap(merged);
}
