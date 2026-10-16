/** The release this copy of the app was built from (baked in at build time). */
export const BUILD_ID = process.env.NEXT_PUBLIC_BUILD_ID ?? "dev";

/** True when a different release is live than the one running here. */
export function isDifferentRelease(running: string, live: string | null | undefined): boolean {
  if (!live || running === "dev" || live === "dev") return false;
  return running !== live;
}

/**
 * Asks the server which release is live. Network errors count as "no update"
 * so an offline or flaky phone never reloads into an error page.
 */
export async function isNewReleaseLive(): Promise<boolean> {
  try {
    const response = await fetch("/api/version", { cache: "no-store" });
    if (!response.ok) return false;
    const data = (await response.json()) as { version?: string };
    return isDifferentRelease(BUILD_ID, data.version);
  } catch {
    return false;
  }
}
