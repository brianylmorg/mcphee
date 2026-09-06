import assert from "node:assert/strict";
import test from "node:test";

import { addSingaporeCalendarMonths, MilkLedgerError, previewAvailableUse, replayMilkLedger, replayMilkLedgerEdit } from "./milk-bank-ledger";

test("frozen expiry is three Singapore calendar months, clamped at month end", () => {
  const january31 = Date.parse("2026-01-31T21:15:00+08:00");
  assert.equal(
    new Date(addSingaporeCalendarMonths(january31, 3)).toISOString(),
    "2026-04-30T13:15:00.000Z",
  );

  const november30LeapYear = Date.parse("2023-11-30T08:45:00+08:00");
  assert.equal(
    new Date(addSingaporeCalendarMonths(november30LeapYear, 3)).toISOString(),
    "2024-02-29T00:45:00.000Z",
  );
});

test("Available milk is allocated FIFO and expired milk remains visible", () => {
  const hour = 60 * 60 * 1000;
  const result = replayMilkLedger([
    { id: "pump-old", type: "pump", startedAt: 1 * hour, createdAt: 1, details: { amount: 60 } },
    { id: "pump-new", type: "pump", startedAt: 2 * hour, createdAt: 2, details: { amount: 40 } },
    { id: "feed", type: "bottlefeed", startedAt: 3 * hour, createdAt: 3, details: { milkType: "breastmilk", amount: 70 } },
  ], 7 * hour);

  assert.equal(result.availableMl, 30);
  assert.equal(result.expiredAvailableMl, 30);
  assert.deepEqual(
    result.availableBatches.map(({ id, remainingMl }) => ({ id, remainingMl })),
    [{ id: "pump-new", remainingMl: 30 }],
  );
});

test("Available reconciliation additions persist without retroactive expiry", () => {
  const result = replayMilkLedger([
    { id: "legacy", type: "bankadjust", startedAt: 100, details: { amount: 45 } },
  ], 99_999_999);

  assert.equal(result.availableMl, 45);
  assert.equal(result.expiredAvailableMl, 0);
  assert.equal(result.availableBatches[0]?.expiresAt, null);
});

test("legacy pump logs without a positive amount do not break the bank", () => {
  const result = replayMilkLedger([
    { id: "empty", type: "pump", startedAt: 100, details: { amount: null } },
    { id: "valid", type: "pump", startedAt: 200, details: { amount: 45 } },
  ], 300);

  assert.equal(result.availableMl, 45);
  assert.deepEqual(result.availableBatches.map((batch) => batch.id), ["valid"]);
});

test("an impossible Available deduction is rejected and never clamped", () => {
  assert.throws(
    () => replayMilkLedger([
      { id: "pump", type: "pump", startedAt: 100, details: { amount: 30 } },
      { id: "feed", type: "bottlefeed", startedAt: 200, details: { milkType: "breastmilk", amount: 31 } },
    ], 300),
    (error) => error instanceof MilkLedgerError && error.code === "INSUFFICIENT_AVAILABLE",
  );
});

test("freeze moves Available FIFO into one indivisible frozen packet", () => {
  const hour = 60 * 60 * 1000;
  const result = replayMilkLedger([
    { id: "pump-a", type: "pump", startedAt: hour, details: { amount: 40 } },
    { id: "pump-b", type: "pump", startedAt: 2 * hour, details: { amount: 50 } },
    { id: "packet", type: "bankfreeze", startedAt: 3 * hour, details: { amount: 60 } },
  ], 3 * hour);

  assert.equal(result.availableMl, 30);
  assert.equal(result.frozenMl, 60);
  assert.deepEqual(result.availableBatches.map((batch) => [batch.id, batch.remainingMl]), [["pump-b", 30]]);
  assert.deepEqual(result.frozenPackets.map((packet) => [packet.id, packet.amountMl]), [["packet", 60]]);
});

test("thaw requires the whole packet and gives milk a fresh four-hour Available expiry", () => {
  const frozenAt = Date.parse("2026-02-01T10:00:00+08:00");
  const thawedAt = Date.parse("2026-02-02T09:30:00+08:00");
  const base = [
    { id: "packet", type: "bankfreeze", startedAt: frozenAt, details: { amount: 75, source: "reconcile" } },
  ];

  assert.throws(
    () => replayMilkLedger([
      ...base,
      { id: "bad-thaw", type: "bankthaw", startedAt: thawedAt, details: { packetId: "packet", amount: 50 } },
    ], thawedAt),
    (error) => error instanceof MilkLedgerError && error.code === "PACKET_AMOUNT_MISMATCH",
  );

  const result = replayMilkLedger([
    ...base,
    { id: "thaw", type: "bankthaw", startedAt: thawedAt, details: { packetId: "packet", amount: 75 } },
  ], thawedAt);
  assert.equal(result.frozenMl, 0);
  assert.equal(result.availableMl, 75);
  assert.equal(result.availableBatches[0]?.source, "thaw");
  assert.equal(result.availableBatches[0]?.expiresAt, thawedAt + 4 * 60 * 60 * 1000);
});

test("expired frozen packets cannot thaw but can be discarded", () => {
  const frozenAt = Date.parse("2026-01-31T10:00:00+08:00");
  const expiredAt = addSingaporeCalendarMonths(frozenAt, 3);
  const packet = { id: "packet", type: "bankfreeze", startedAt: frozenAt, details: { amount: 80, source: "reconcile" } };

  assert.throws(
    () => replayMilkLedger([
      packet,
      { id: "thaw", type: "bankthaw", startedAt: expiredAt, details: { packetId: "packet", amount: 80 } },
    ], expiredAt),
    (error) => error instanceof MilkLedgerError && error.code === "PACKET_EXPIRED",
  );

  const discarded = replayMilkLedger([
    packet,
    { id: "discard", type: "bankdiscard", startedAt: expiredAt, details: { packetId: "packet", amount: 80 } },
  ], expiredAt);
  assert.equal(discarded.frozenMl, 0);
  assert.deepEqual(discarded.history.map((item) => item.eventType), ["Packet added", "Discard"]);
});

test("later packet events make an edited ledger impossible instead of silently clamping", () => {
  assert.throws(
    () => replayMilkLedger([
      { id: "packet", type: "bankfreeze", startedAt: 100, details: { amount: 90, source: "reconcile" } },
      { id: "thaw", type: "bankthaw", startedAt: 200, details: { packetId: "packet", amount: 90 } },
      { id: "discard", type: "bankdiscard", startedAt: 300, details: { packetId: "packet", amount: 90 } },
    ], 300),
    (error) => error instanceof MilkLedgerError && error.code === "PACKET_CLOSED",
  );
});

test("Available-use preview reports the expired FIFO portion requiring confirmation", () => {
  const hour = 60 * 60 * 1000;
  const events = [
    { id: "old", type: "pump", startedAt: hour, details: { amount: 50 } },
    { id: "fresh", type: "pump", startedAt: 6 * hour, details: { amount: 60 } },
  ];

  assert.deepEqual(previewAvailableUse(events, 80, 7 * hour), {
    availableMl: 110,
    expiredMl: 50,
  });
  assert.deepEqual(previewAvailableUse(events, 40, 4 * hour), {
    availableMl: 50,
    expiredMl: 0,
  });
});

test("historical bottle calculations deduct consumed plus wasted milk", () => {
  const result = replayMilkLedger([
    { id: "pump", type: "pump", startedAt: 100, details: { amount: 120 } },
    {
      id: "feed",
      type: "bottlefeed",
      startedAt: 200,
      details: { milkType: "breastmilk", amount: 40, amountExpression: "90-50" },
    },
  ], 300);

  assert.equal(result.availableMl, 30);
});

test("editing a transfer replays later packet state and rejects impossible amount or date", () => {
  const frozenAt = Date.parse("2026-01-10T10:00:00+08:00");
  const thawedAt = Date.parse("2026-02-10T10:00:00+08:00");
  const events = [
    { id: "packet", type: "bankfreeze", startedAt: frozenAt, details: { amount: 90, source: "reconcile" } },
    { id: "thaw", type: "bankthaw", startedAt: thawedAt, details: { packetId: "packet", amount: 90 } },
  ];

  assert.throws(
    () => replayMilkLedgerEdit(events, "packet", { amountMl: 80, at: frozenAt }, thawedAt),
    (error) => error instanceof MilkLedgerError && error.code === "PACKET_AMOUNT_MISMATCH",
  );
  assert.throws(
    () => replayMilkLedgerEdit(events, "packet", {
      amountMl: 90,
      at: Date.parse("2025-10-01T10:00:00+08:00"),
    }, thawedAt),
    (error) => error instanceof MilkLedgerError && error.code === "PACKET_EXPIRED",
  );
});
