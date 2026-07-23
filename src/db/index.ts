import { createClient, type Client } from "@libsql/client";

let client: Client | null = null;
let clientUrl: string | undefined;
let clientAuthToken: string | undefined;

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

  client = createClient({ url, authToken });
  clientUrl = url;
  clientAuthToken = authToken;

  return client;
}
