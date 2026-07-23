import { createClient, type Client } from "@libsql/client";

let client: Client | null = null;
let clientUrl: string | undefined;
let clientAuthToken: string | undefined;
let replicaMode = false;

export function createDB() {
  const url = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;

  if (!url) {
    throw new Error("TURSO_DATABASE_URL is required");
  }

  if (client && !client.closed && clientUrl === url && clientAuthToken === authToken) {
    return client;
  }

  if (client && !client.closed) {
    client.close();
  }

  const isRemote = url.startsWith("libsql://") || url.startsWith("https://");
  replicaMode = isRemote && process.env.DB_REPLICA !== "off";

  if (replicaMode) {
    const replicaPath = process.env.DB_REPLICA_PATH || "/tmp/mcphee-replica.db";
    client = createClient({
      url: "file:" + replicaPath,
      syncUrl: url,
      authToken,
      syncInterval: 30,
    });
  } else {
    client = createClient({ url, authToken });
  }
  clientUrl = url;
  clientAuthToken = authToken;

  return client;
}

// Pulls the local embedded replica up to date (read-your-writes after mutations).
// No-op outside replica mode; sync failures are logged, never thrown.
export async function syncDb() {
  if (!replicaMode || !client || client.closed) return;
  try {
    await client.sync();
  } catch (error) {
    console.error("DB replica sync error:", error);
  }
}
