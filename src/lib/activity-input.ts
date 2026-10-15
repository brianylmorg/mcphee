import type { Client } from "@libsql/client";

import type { MilkLedgerActivity } from "./milk-bank-ledger";
import { parseActivityDetails } from "./milk-volumes";

const VALID_TYPES = new Set([
  "bottlefeed",
  "breastfeed",
  "pump",
  "diaper",
  "vomit",
  "sleep",
  "bankadjust",
  "note",
  "temperature",
]);
const FUTURE_CLOCK_SKEW_MS = 2 * 60 * 1000;

function isValidTimestamp(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

export function validateActivityInput(body: Record<string, unknown>, now = Date.now()): string | null {
  if (typeof body.babyId !== "string" || !body.babyId) return "babyId is required";
  if (typeof body.type !== "string" || !VALID_TYPES.has(body.type)) return "Invalid activity type";
  if (!isValidTimestamp(body.startedAt)) return "startedAt must be a timestamp";
  if (body.endedAt != null && !isValidTimestamp(body.endedAt)) return "endedAt must be a timestamp";
  if (body.endedAt != null && Number(body.endedAt) < Number(body.startedAt)) {
    return "endedAt must be after startedAt";
  }
  if (body.details != null && (typeof body.details !== "object" || Array.isArray(body.details))) {
    return "details must be an object";
  }
  if ((body.type === "note" || body.type === "temperature" || body.type === "sleep")
      && Number(body.startedAt) > now + FUTURE_CLOCK_SKEW_MS) {
    return "startedAt cannot be in the future";
  }
  if (body.type === "sleep" && body.endedAt != null && Number(body.endedAt) > now + FUTURE_CLOCK_SKEW_MS) {
    return "endedAt cannot be in the future";
  }
  const details = (body.details ?? {}) as Record<string, unknown>;
  if (typeof details.notes === "string" && details.notes.length > 500) {
    return "Notes must be 500 characters or fewer";
  }
  if (body.type === "note" && (typeof details.notes !== "string" || !details.notes.trim())) {
    return "Note text is required";
  }
  if (body.type === "temperature") {
    const celsius = Number(details.celsius);
    if (!Number.isFinite(celsius) || celsius < 30 || celsius > 45) {
      return "Temperature must be between 30 and 45 °C";
    }
    const methods = new Set(["armpit", "ear", "oral", "rectal", "forehead", "other"]);
    if (details.method != null && details.method !== "" && !methods.has(String(details.method))) {
      return "Invalid temperature measurement method";
    }
  }
  return null;
}

type ActivityExecutor = Pick<Client, "execute">;

export async function milkLedgerForHousehold(
  db: ActivityExecutor,
  householdId: string,
  excludeActivityId?: string,
): Promise<MilkLedgerActivity[]> {
  let sql = `SELECT a.id, a.type, a.started_at, a.created_at, a.details FROM activities a
             JOIN babies b ON b.id = a.baby_id
             WHERE b.household_id = ? AND a.type IN (?, ?, ?, ?, ?, ?)`;
  const args: Array<string | number> = [
    householdId,
    "pump",
    "bottlefeed",
    "bankadjust",
    "bankfreeze",
    "bankthaw",
    "bankdiscard",
  ];
  if (excludeActivityId) {
    sql += " AND a.id != ?";
    args.push(excludeActivityId);
  }
  sql += " ORDER BY a.started_at ASC, a.created_at ASC, a.id ASC";

  const result = await db.execute({ sql, args });
  return result.rows.map((row) => ({
    id: String(row.id),
    type: String(row.type),
    startedAt: Number(row.started_at),
    createdAt: Number(row.created_at),
    details: parseActivityDetails(row.details),
  }));
}
