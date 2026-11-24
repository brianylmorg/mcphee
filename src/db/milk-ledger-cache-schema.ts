import type { Client } from "@libsql/client";

// The milk bank is a replay of every bottle, pump and bank event a household
// has ever logged (src/lib/milk-bank-ledger.ts), so computing it reads the
// whole ledger: ~3k rows by Nov 2026 and growing. The dashboard reloads on
// every write to any of its inputs, from every open device, which made this
// one query ~92% of the database's row reads.
//
// So the dashboard caches the computed milk bank per household. The cache row
// records the ledger version it was computed at; triggers bump that version
// on any write that can change a ledger (an activity of a ledger type, before
// or after the write, or any baby moving between households). A cache row is
// only used while its version, SQLite's schema version and its time window
// all still match (see src/lib/milk-ledger-cache.ts). Triggers live in the
// database so no write path (API route, import, admin script) can forget them.
//
// Neither table has dashboard_version triggers on purpose: the cache is a pure
// function of activities and babies, which already bump dashboard_version,
// and writing the cache on a read must not make every device reload.
export const MILK_LEDGER_TYPES = ["bottlefeed", "pump", "bankadjust", "bankfreeze", "bankthaw", "bankdiscard"] as const;

const typeList = MILK_LEDGER_TYPES.map((type) => `'${type}'`).join(", ");
const bump = "UPDATE milk_ledger_version SET version = version + 1 WHERE id = 1;";

const TRIGGERS = [
  { name: "trg_milk_ledger_activities_insert", on: "INSERT ON activities", when: `WHEN NEW.type IN (${typeList})` },
  { name: "trg_milk_ledger_activities_update", on: "UPDATE ON activities", when: `WHEN OLD.type IN (${typeList}) OR NEW.type IN (${typeList})` },
  { name: "trg_milk_ledger_activities_delete", on: "DELETE ON activities", when: `WHEN OLD.type IN (${typeList})` },
  { name: "trg_milk_ledger_babies_insert", on: "INSERT ON babies", when: "" },
  { name: "trg_milk_ledger_babies_update", on: "UPDATE ON babies", when: "" },
  { name: "trg_milk_ledger_babies_delete", on: "DELETE ON babies", when: "" },
] as const;

export const MILK_LEDGER_TRIGGERS = TRIGGERS.map((trigger) => trigger.name);

export const MILK_LEDGER_SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS milk_ledger_version (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    version INTEGER NOT NULL
  )`,
  "INSERT OR IGNORE INTO milk_ledger_version (id, version) VALUES (1, 0)",
  `CREATE TABLE IF NOT EXISTS milk_ledger_cache (
    household_id TEXT PRIMARY KEY,
    ledger_version INTEGER NOT NULL,
    schema_version INTEGER NOT NULL,
    format TEXT NOT NULL,
    computed_at INTEGER NOT NULL,
    valid_until INTEGER NOT NULL,
    payload TEXT NOT NULL
  )`,
  ...TRIGGERS.map((trigger) => `CREATE TRIGGER IF NOT EXISTS ${trigger.name}
    AFTER ${trigger.on}
    ${trigger.when}
    BEGIN
      ${bump}
    END`),
  // Schema changes don't fire triggers; drop anything cached by older code.
  "DELETE FROM milk_ledger_cache",
  "UPDATE milk_ledger_version SET version = version + 1 WHERE id = 1",
] as const;

type SchemaExecutor = Pick<Client, "execute">;

export async function applyMilkLedgerCacheSchema(db: SchemaExecutor): Promise<void> {
  for (const sql of MILK_LEDGER_SCHEMA_STATEMENTS) {
    await db.execute(sql);
  }
}

const READY_NAMES = ["milk_ledger_version", "milk_ledger_cache", ...MILK_LEDGER_TRIGGERS];

/** One statement that returns the names present; ready when all READY_NAMES come back. */
export const MILK_LEDGER_READY_QUERY = {
  sql: `SELECT name FROM sqlite_master WHERE name IN (${READY_NAMES.map(() => "?").join(", ")})`,
  args: READY_NAMES,
};

export function milkLedgerSchemaReadyFrom(rows: ReadonlyArray<Record<string, unknown>>): boolean {
  const found = new Set(rows.map((row) => String(row.name)));
  return READY_NAMES.every((name) => found.has(name));
}
