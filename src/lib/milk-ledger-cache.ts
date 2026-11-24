import type { Client, InStatement } from "@libsql/client";
import { bottleBreastmilkLibraryDeduction } from "./milk-calculation";
import { parseActivityDetails, pumpAmount } from "./milk-volumes";
import { replayMilkLedger, type MilkLedgerActivity } from "./milk-bank-ledger";
import { MILK_LEDGER_READY_QUERY, MILK_LEDGER_TYPES, milkLedgerSchemaReadyFrom } from "@/db/milk-ledger-cache-schema";

// Bump when the summary's shape or meaning changes, so rows cached by older
// code are recomputed instead of served.
export const MILK_LEDGER_CACHE_FORMAT = "mb1";
// Safety net for time-dependence nobody has listed: recompute at least daily.
const MAX_CACHE_AGE_MS = 24 * 60 * 60 * 1000;

export type MilkBankSummary = {
  /** The dashboard's `pumpedMilk` object, exactly as the full replay builds it. */
  pumpedMilk: {
    walletMl: number;
    availableMl: number;
    frozenMl: number;
    frozenPackets: ReturnType<typeof replayMilkLedger>["frozenPackets"];
    bankHistory: ReturnType<typeof replayMilkLedger>["history"];
    totalPumpedMl: number;
    breastmilkConsumedMl: number;
    lastPumpMl: number;
    lastPumpAt: number | null;
    batches: Array<{
      id: string;
      addedAt: number;
      pumpedAt: number;
      amountMl: number;
      remainingMl: number;
      isAdjustment: boolean;
      source: "pump" | "adjustment" | "thaw";
    }>;
  };
  /** Earliest moment the summary changes with no new write (a future entry going live, a packet expiring), or null. */
  nextChangeAt: number | null;
};

type Executor = Pick<Client, "batch">;

export const ledgerQuery = (householdId: string): InStatement => ({
  sql: `SELECT a.id, a.baby_id, a.type, a.details, a.started_at, a.created_at FROM activities a
        JOIN babies b ON a.baby_id = b.id
        WHERE b.household_id = ?
          AND a.type IN (${MILK_LEDGER_TYPES.map(() => "?").join(", ")})
        ORDER BY a.started_at ASC, a.created_at ASC`,
  args: [householdId, ...MILK_LEDGER_TYPES],
});

const VERSION_QUERY = "SELECT version, (SELECT schema_version FROM pragma_schema_version) AS schema_version FROM milk_ledger_version WHERE id = 1";

/** Replays the household's whole ledger. Rows must be in ledgerQuery's order. */
export function summarizeMilkLedger(rows: ReadonlyArray<Record<string, unknown>>, nowMs: number): MilkBankSummary {
  const ledgerEvents: MilkLedgerActivity[] = rows.map((row) => ({
    id: String(row.id),
    type: String(row.type),
    startedAt: Number(row.started_at),
    createdAt: Number(row.created_at),
    details: parseActivityDetails(row.details as string | null),
  }));
  const bankState = replayMilkLedger(ledgerEvents, nowMs, new Set(ledgerEvents.map((event) => event.id)));
  const pumpEvents = ledgerEvents.filter((event) => event.type === "pump");
  const latestPump = pumpEvents[pumpEvents.length - 1];
  const totalPumpedMl = pumpEvents.reduce((sum, event) => sum + pumpAmount(event.details), 0);
  const breastmilkConsumedMl = ledgerEvents
    .filter((event) => event.type === "bottlefeed")
    .reduce((sum, event) => sum + bottleBreastmilkLibraryDeduction(event.details), 0);
  const changes = [
    ...ledgerEvents.map((event) => event.startedAt).filter((at) => at > nowMs),
    ...bankState.frozenPackets.map((packet) => packet.expiresAt).filter((at) => at > nowMs),
  ];
  return {
    pumpedMilk: {
      walletMl: bankState.availableMl,
      availableMl: bankState.availableMl,
      frozenMl: bankState.frozenMl,
      frozenPackets: bankState.frozenPackets,
      bankHistory: bankState.history,
      totalPumpedMl,
      breastmilkConsumedMl,
      lastPumpMl: latestPump ? pumpAmount(latestPump.details) : 0,
      lastPumpAt: latestPump?.startedAt ?? null,
      batches: bankState.availableBatches.map((batch) => ({
        id: batch.id,
        addedAt: batch.addedAt,
        pumpedAt: batch.addedAt,
        amountMl: batch.amountMl,
        remainingMl: batch.remainingMl,
        isAdjustment: batch.source === "adjustment",
        source: batch.source,
      })),
    },
    nextChangeAt: changes.length > 0 ? Math.min(...changes) : null,
  };
}

/**
 * The household's milk bank, from the cache when it is still exact, otherwise
 * replayed from the full ledger (and cached when the triggers are in place).
 * Before the cache migration it simply replays every time, as before.
 */
export async function loadMilkBankSummary(db: Executor, householdId: string, nowMs: number): Promise<MilkBankSummary> {
  let schemaPresent = true;
  try {
    const [version, cached] = await db.batch([
      VERSION_QUERY,
      {
        sql: "SELECT ledger_version, schema_version, format, computed_at, valid_until, payload FROM milk_ledger_cache WHERE household_id = ?",
        args: [householdId],
      },
    ], "read");
    const current = version.rows[0];
    const row = cached.rows[0];
    if (
      current && row
      && Number(row.ledger_version) === Number(current.version)
      && Number(row.schema_version) === Number(current.schema_version)
      && row.format === MILK_LEDGER_CACHE_FORMAT
      && Number(row.computed_at) <= nowMs
      && nowMs < Number(row.valid_until)
    ) {
      return JSON.parse(String(row.payload)) as MilkBankSummary;
    }
  } catch {
    schemaPresent = false;
  }

  if (!schemaPresent) {
    const [ledger] = await db.batch([ledgerQuery(householdId)], "read");
    return summarizeMilkLedger(ledger.rows, nowMs);
  }

  // Version, trigger check and ledger in one read transaction, so the cached
  // row is labelled with the version its data was read at. A write landing
  // after this read bumps the version past the label, so the row is ignored.
  const [version, ready, ledger] = await db.batch([VERSION_QUERY, MILK_LEDGER_READY_QUERY, ledgerQuery(householdId)], "read");
  const summary = summarizeMilkLedger(ledger.rows, nowMs);
  const current = version.rows[0];
  if (current && milkLedgerSchemaReadyFrom(ready.rows)) {
    const validUntil = Math.min(summary.nextChangeAt ?? Infinity, nowMs + MAX_CACHE_AGE_MS);
    try {
      await db.batch([{
        sql: `INSERT INTO milk_ledger_cache (household_id, ledger_version, schema_version, format, computed_at, valid_until, payload)
              VALUES (?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(household_id) DO UPDATE SET
                ledger_version = excluded.ledger_version,
                schema_version = excluded.schema_version,
                format = excluded.format,
                computed_at = excluded.computed_at,
                valid_until = excluded.valid_until,
                payload = excluded.payload
              WHERE excluded.ledger_version >= milk_ledger_cache.ledger_version`,
        args: [
          householdId,
          Number(current.version),
          Number(current.schema_version),
          MILK_LEDGER_CACHE_FORMAT,
          nowMs,
          validUntil,
          JSON.stringify(summary),
        ],
      }], "write");
    } catch (error) {
      console.error("Milk bank cache write failed; serving the fresh replay", error);
    }
  }
  return summary;
}
