import { createClient } from "@libsql/client";

import { applyCaretakerImportSchema, isCaretakerImportSchemaReady } from "./caretaker-import-schema";

async function migrateCaretakerImport() {
  const url = process.env.TURSO_DATABASE_URL;
  if (!url) throw new Error("TURSO_DATABASE_URL is required");
  const client = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });
  try {
    await applyCaretakerImportSchema(client);
    if (!(await isCaretakerImportSchemaReady(client))) {
      throw new Error("Caretaker import schema did not pass its readiness check");
    }
    console.log("Caretaker import additive migration completed.");
  } finally {
    client.close();
  }
}

migrateCaretakerImport().catch((error) => {
  console.error("Caretaker import migration failed:", error);
  process.exitCode = 1;
});
