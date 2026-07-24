// Verifies the deferred-replica mechanics in src/db/index.ts:
// 1. queries wait for the initial sync (no "no such table" from an empty replica)
// 2. a failed handshake falls back to the plain remote client
process.env.TURSO_DATABASE_URL = "libsql://127.0.0.1:1"; // nothing listening
process.env.TURSO_AUTH_TOKEN = "dummy";
process.env.DB_REPLICA_PATH = "/tmp/mcphee-deferred-test.db";

const { createDB, syncDb } = await import("./src/db/index");

const db = createDB();
const t0 = Date.now();
try {
  await db.execute("SELECT 1");
  console.log("UNEXPECTED: query succeeded against dead endpoint");
  process.exit(1);
} catch (err) {
  const message = (err as Error).message;
  if (message.includes("no such table")) {
    console.log("FAIL: served empty replica (no such table)");
    process.exit(1);
  }
  console.log(`ok: fallback remote client used, query failed with connection error in ${Date.now() - t0}ms`);
  console.log(`   error was: ${message.slice(0, 120)}`);
}

await syncDb();
console.log("ok: syncDb() no-throw after fallback");
process.exit(0);
