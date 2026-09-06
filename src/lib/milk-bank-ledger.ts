import { bottleBreastmilkLibraryDeduction } from "./milk-calculation";

const SINGAPORE_OFFSET_MS = 8 * 60 * 60 * 1000;
export const AVAILABLE_EXPIRY_MS = 4 * 60 * 60 * 1000;

export type MilkLedgerActivity = {
  id: string;
  type: string;
  startedAt: number;
  createdAt?: number;
  details: Record<string, unknown>;
};

export type AvailableMilkBatch = {
  id: string;
  addedAt: number;
  amountMl: number;
  remainingMl: number;
  expiresAt: number | null;
  source: "pump" | "adjustment" | "thaw";
};

export type FrozenMilkPacket = {
  id: string;
  amountMl: number;
  frozenAt: number;
  expiresAt: number;
  status: "frozen" | "thawed" | "discarded";
  closedAt: number | null;
  isExpired: boolean;
};

export type MilkBankHistoryItem = {
  id: string;
  eventType: "Freeze" | "Thaw" | "Discard" | "Packet added";
  amountMl: number;
  at: number;
  packetId: string;
};

export class MilkLedgerError extends Error {
  constructor(
    public readonly code: "INVALID_EVENT" | "INSUFFICIENT_AVAILABLE" | "PACKET_NOT_FOUND" | "PACKET_CLOSED" | "PACKET_EXPIRED" | "PACKET_AMOUNT_MISMATCH",
    message: string,
    public readonly eventId?: string,
  ) {
    super(message);
    this.name = "MilkLedgerError";
  }
}

function positiveAmount(value: unknown, eventId: string): number {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new MilkLedgerError("INVALID_EVENT", "Milk amounts must be finite and positive", eventId);
  }
  return Math.round(amount * 100) / 100;
}

export function allocateAvailable(
  batches: AvailableMilkBatch[],
  amountMl: number,
  at: number,
  eventId?: string,
  allowShortfall = false,
): { allocations: Array<{ batchId: string; amountMl: number; expired: boolean }>; expiredMl: number } {
  if (!Number.isFinite(amountMl) || amountMl < 0) {
    throw new MilkLedgerError("INVALID_EVENT", "Milk amounts must be finite and non-negative", eventId);
  }
  let remaining = Math.round(amountMl * 100) / 100;
  const allocations: Array<{ batchId: string; amountMl: number; expired: boolean }> = [];
  for (const batch of batches) {
    if (remaining <= 0) break;
    const used = Math.min(batch.remainingMl, remaining);
    if (used <= 0) continue;
    const expired = batch.expiresAt != null && batch.expiresAt <= at;
    batch.remainingMl = Math.round((batch.remainingMl - used) * 100) / 100;
    remaining = Math.round((remaining - used) * 100) / 100;
    allocations.push({ batchId: batch.id, amountMl: used, expired });
  }
  if (remaining > 0 && !allowShortfall) {
    throw new MilkLedgerError("INSUFFICIENT_AVAILABLE", "Not enough Available milk for this event", eventId);
  }
  return {
    allocations,
    expiredMl: allocations.reduce((sum, item) => sum + (item.expired ? item.amountMl : 0), 0),
  };
}

export function replayMilkLedger(events: MilkLedgerActivity[], now: number, persistedEventIds: ReadonlySet<string> = new Set()) {
  const availableBatches: AvailableMilkBatch[] = [];
  const frozenPackets: FrozenMilkPacket[] = [];
  const history: MilkBankHistoryItem[] = [];
  const ordered = [...events].sort((a, b) =>
    a.startedAt - b.startedAt || (a.createdAt ?? 0) - (b.createdAt ?? 0) || a.id.localeCompare(b.id),
  );

  for (const event of ordered) {
    if (!Number.isFinite(event.startedAt) || event.startedAt <= 0) {
      throw new MilkLedgerError("INVALID_EVENT", "Event time must be a positive timestamp", event.id);
    }
    if (event.type === "pump") {
      const rawAmount = Number(event.details.amount);
      // Historical pump logs were allowed without a measured amount. They are
      // valid activity records but contribute no inventory to the bank.
      if (!Number.isFinite(rawAmount) || rawAmount <= 0) continue;
      const amountMl = Math.round(rawAmount * 100) / 100;
      availableBatches.push({
        id: event.id,
        addedAt: event.startedAt,
        amountMl,
        remainingMl: amountMl,
        expiresAt: event.startedAt + AVAILABLE_EXPIRY_MS,
        source: "pump",
      });
    } else if (event.type === "bankadjust") {
      const amount = Number(event.details.amount);
      if (!Number.isFinite(amount) || amount === 0) continue;
      const amountMl = Math.round(Math.abs(amount) * 100) / 100;
      if (amount > 0) {
        availableBatches.push({
          id: event.id,
          addedAt: event.startedAt,
          amountMl,
          remainingMl: amountMl,
          expiresAt: null,
          source: "adjustment",
        });
      } else {
        allocateAvailable(availableBatches, amountMl, event.startedAt, event.id, persistedEventIds.has(event.id));
      }
    } else if (event.type === "bottlefeed") {
      const amountMl = Math.round(bottleBreastmilkLibraryDeduction(event.details) * 100) / 100;
      if (amountMl > 0) allocateAvailable(availableBatches, amountMl, event.startedAt, event.id, persistedEventIds.has(event.id));
    } else if (event.type === "bankfreeze") {
      const amountMl = positiveAmount(event.details.amount, event.id);
      const source = event.details.source === "reconcile" ? "reconcile" : "available";
      if (source === "available") {
        allocateAvailable(availableBatches, amountMl, event.startedAt, event.id);
      }
      if (frozenPackets.some((packet) => packet.id === event.id)) {
        throw new MilkLedgerError("INVALID_EVENT", "Frozen packet identity must be unique", event.id);
      }
      frozenPackets.push({
        id: event.id,
        amountMl,
        frozenAt: event.startedAt,
        expiresAt: addSingaporeCalendarMonths(event.startedAt, 3),
        status: "frozen",
        closedAt: null,
        isExpired: addSingaporeCalendarMonths(event.startedAt, 3) <= now,
      });
      history.push({
        id: event.id,
        eventType: source === "reconcile" ? "Packet added" : "Freeze",
        amountMl,
        at: event.startedAt,
        packetId: event.id,
      });
    } else if (event.type === "bankthaw" || event.type === "bankdiscard") {
      const packetId = String(event.details.packetId ?? "");
      const packet = frozenPackets.find((item) => item.id === packetId);
      if (!packet) {
        throw new MilkLedgerError("PACKET_NOT_FOUND", "Frozen packet was not found", event.id);
      }
      if (packet.status !== "frozen") {
        throw new MilkLedgerError("PACKET_CLOSED", "Frozen packet was already thawed or discarded", event.id);
      }
      const amountMl = positiveAmount(event.details.amount, event.id);
      if (amountMl !== packet.amountMl) {
        throw new MilkLedgerError("PACKET_AMOUNT_MISMATCH", "Frozen packets must be handled whole", event.id);
      }
      if (event.type === "bankthaw" && packet.expiresAt <= event.startedAt) {
        throw new MilkLedgerError("PACKET_EXPIRED", "Expired frozen milk cannot be thawed", event.id);
      }

      packet.status = event.type === "bankthaw" ? "thawed" : "discarded";
      packet.closedAt = event.startedAt;
      history.push({
        id: event.id,
        eventType: event.type === "bankthaw" ? "Thaw" : "Discard",
        amountMl,
        at: event.startedAt,
        packetId,
      });
      if (event.type === "bankthaw") {
        availableBatches.push({
          id: event.id,
          addedAt: event.startedAt,
          amountMl,
          remainingMl: amountMl,
          expiresAt: event.startedAt + AVAILABLE_EXPIRY_MS,
          source: "thaw",
        });
      }
    }
  }

  const remainingBatches = availableBatches.filter((batch) => batch.remainingMl > 0);
  const availableMl = remainingBatches.reduce((sum, batch) => sum + batch.remainingMl, 0);
  const expiredAvailableMl = remainingBatches.reduce(
    (sum, batch) => sum + (batch.expiresAt != null && batch.expiresAt <= now ? batch.remainingMl : 0),
    0,
  );

  const activeFrozenPackets = frozenPackets
    .filter((packet) => packet.status === "frozen")
    .sort((a, b) => a.frozenAt - b.frozenAt || a.id.localeCompare(b.id));
  const frozenMl = activeFrozenPackets.reduce((sum, packet) => sum + packet.amountMl, 0);

  return {
    availableMl: Math.round(availableMl * 100) / 100,
    expiredAvailableMl: Math.round(expiredAvailableMl * 100) / 100,
    frozenMl: Math.round(frozenMl * 100) / 100,
    availableBatches: remainingBatches,
    frozenPackets: activeFrozenPackets,
    history,
  };
}

export function previewAvailableUse(
  events: MilkLedgerActivity[],
  amountMl: number,
  at: number,
): { availableMl: number; expiredMl: number } {
  const relevantEvents = events.filter((event) => event.startedAt <= at);
  const state = replayMilkLedger(relevantEvents, at, new Set(relevantEvents.map((event) => event.id)));
  const batches = state.availableBatches.map((batch) => ({ ...batch }));
  const allocation = allocateAvailable(batches, amountMl, at);
  return { availableMl: state.availableMl, expiredMl: allocation.expiredMl };
}

export function replayMilkLedgerEdit(
  events: MilkLedgerActivity[],
  eventId: string,
  edit: { amountMl: number; at: number },
  now = Date.now(),
) {
  let found = false;
  const edited = events.map((event) => {
    if (event.id !== eventId) return event;
    found = true;
    return {
      ...event,
      startedAt: edit.at,
      details: { ...event.details, amount: edit.amountMl },
    };
  });
  if (!found) throw new MilkLedgerError("INVALID_EVENT", "Bank transfer was not found", eventId);
  return replayMilkLedger(edited, now, new Set(events.map((event) => event.id)));
}

/**
 * Adds calendar months in Singapore local time. If the source day does not
 * exist in the target month, it is clamped to that month's final day.
 */
export function addSingaporeCalendarMonths(timestamp: number, months: number): number {
  if (!Number.isFinite(timestamp) || !Number.isInteger(months)) {
    throw new TypeError("A finite timestamp and whole calendar-month count are required");
  }

  const local = new Date(timestamp + SINGAPORE_OFFSET_MS);
  const year = local.getUTCFullYear();
  const month = local.getUTCMonth();
  const day = local.getUTCDate();
  const targetMonthStart = new Date(Date.UTC(year, month + months, 1));
  const targetYear = targetMonthStart.getUTCFullYear();
  const targetMonth = targetMonthStart.getUTCMonth();
  const lastTargetDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();

  return Date.UTC(
    targetYear,
    targetMonth,
    Math.min(day, lastTargetDay),
    local.getUTCHours(),
    local.getUTCMinutes(),
    local.getUTCSeconds(),
    local.getUTCMilliseconds(),
  ) - SINGAPORE_OFFSET_MS;
}
