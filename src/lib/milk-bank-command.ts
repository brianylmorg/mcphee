export type MilkBankCommand =
  | { action: "freeze"; amountMl: number; at: number; confirmExpired: boolean }
  | { action: "thaw" | "discard"; packetId: string; at: number }
  | { action: "addPacket"; amountMl: number; at: number };

function positiveAmount(value: unknown): number {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("amountMl must be a finite positive number");
  return Math.round(amount * 100) / 100;
}

function timestamp(value: unknown, now: number): number {
  const at = value == null ? now : Number(value);
  if (!Number.isFinite(at) || at <= 0 || at > now + 2 * 60 * 1000) {
    throw new Error("at must be a valid timestamp that is not in the future");
  }
  return at;
}

export function parseMilkBankCommand(value: unknown, now = Date.now()): MilkBankCommand {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid milk bank command");
  const body = value as Record<string, unknown>;
  const at = timestamp(body.at, now);
  if (body.action === "freeze") {
    return { action: "freeze", amountMl: positiveAmount(body.amountMl), at, confirmExpired: body.confirmExpired === true };
  }
  if (body.action === "addPacket") {
    return { action: "addPacket", amountMl: positiveAmount(body.amountMl), at };
  }
  if (body.action === "thaw" || body.action === "discard") {
    if (typeof body.packetId !== "string" || !body.packetId.trim()) throw new Error("packetId is required");
    return { action: body.action, packetId: body.packetId, at };
  }
  throw new Error("Invalid milk bank action");
}
