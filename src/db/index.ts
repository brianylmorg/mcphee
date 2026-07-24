import { createClient, type Client } from "@libsql/client";

let client: Client | null = null;
let clientUrl: string | undefined;
let clientAuthToken: string | undefined;
let replicaMode = false;

// Replica-only state. The replica starts empty, so queries must wait for the
// first successful sync; if that sync fails we fall back to a plain remote
// client and the app behaves exactly as it would without a replica.
let replicaClient: Client | null = null;
let replicaReady: Promise<void> | null = null;
let resolvedClient: Client | null = null;

function makeRemoteClient(url: string, authToken?: string): Client {
  return createClient({ url, authToken });
}

// Defers every query until the initial replica sync resolves (or falls back to
// the remote client on failure), so callers never touch an empty replica file.
function deferredClient(): Client {
  const defer = (method: "execute" | "batch" | "transaction" | "executeMultiple") =>
    ((...args: unknown[]) =>
      (replicaReady ?? Promise.resolve()).then(() =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (resolvedClient as any)[method](...args)
      )) as never;

  return {
    execute: defer("execute"),
    batch: defer("batch"),
    transaction: defer("transaction"),
    executeMultiple: defer("executeMultiple"),
    sync: async () => {
      await replicaReady;
      if (replicaClient) return replicaClient.sync();
      return { frames_synced: 0, frame_no: null };
    },
    close: () => {
      resolvedClient?.close();
    },
    get closed() {
      return resolvedClient?.closed ?? false;
    },
  } as unknown as Client;
}

export function createDB(): Client {
  const url = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;

  if (!url) {
    throw new Error("TURSO_DATABASE_URL is required");
  }

  if (client && clientUrl === url && clientAuthToken === authToken) {
    return client;
  }

  if (client && !client.closed) {
    try {
      client.close();
    } catch {}
  }

  const isRemote = url.startsWith("libsql://") || url.startsWith("https://");
  replicaMode = isRemote && process.env.DB_REPLICA !== "off";

  if (replicaMode) {
    const replicaPath = process.env.DB_REPLICA_PATH || "/tmp/mcphee-replica.db";
    replicaClient = createClient({
      url: "file:" + replicaPath,
      syncUrl: url,
      authToken,
      syncInterval: 30,
    });
    resolvedClient = null;
    replicaReady = replicaClient
      .sync()
      .then(() => {
        resolvedClient = replicaClient;
      })
      .catch((error) => {
        console.error("DB replica initial sync failed; falling back to remote client:", error);
        replicaMode = false;
        try {
          replicaClient?.close();
        } catch {}
        replicaClient = null;
        resolvedClient = makeRemoteClient(url, authToken);
      });
    client = deferredClient();
  } else {
    replicaClient = null;
    replicaReady = null;
    resolvedClient = null;
    client = makeRemoteClient(url, authToken);
  }

  clientUrl = url;
  clientAuthToken = authToken;

  return client;
}

// Pulls the local embedded replica up to date (read-your-writes after mutations).
// No-op outside replica mode; sync failures are logged, never thrown.
export async function syncDb() {
  try {
    await replicaReady;
    if (replicaMode && replicaClient && !replicaClient.closed) {
      await replicaClient.sync();
    }
  } catch (error) {
    console.error("DB replica sync error:", error);
  }
}
