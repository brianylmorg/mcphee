export function sgtDateTimeInput(timestamp = Date.now(), includeSeconds = false): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Singapore", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", ...(includeSeconds ? { second: "2-digit" as const } : {}), hourCycle: "h23",
  }).formatToParts(new Date(timestamp));
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "00";
  return `${value("year")}-${value("month")}-${value("day")}T${value("hour")}:${value("minute")}${includeSeconds ? `:${value("second")}` : ""}`;
}

export function parseSgtDateTime(value: string): number | null {
  const timestamp = Date.parse(`${value.length === 16 ? `${value}:00` : value}+08:00`);
  return Number.isFinite(timestamp) ? timestamp : null;
}

export async function mutateSickMode(payload: Record<string, unknown>): Promise<{ ok: boolean; data: Record<string, unknown> }> {
  const response = await fetch("/api/sick-mode", {
    method: "POST", headers: { "Content-Type": "application/json" }, cache: "no-store",
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    const error = new Error(typeof data.error === "string" ? data.error : "Could not update sick mode.");
    Object.assign(error, { status: response.status, code: data.code });
    throw error;
  }
  return { ok: true, data };
}
