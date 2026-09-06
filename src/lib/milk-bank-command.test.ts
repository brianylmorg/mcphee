import assert from "node:assert/strict";
import test from "node:test";

import { parseMilkBankCommand } from "./milk-bank-command";

const now = 1_800_000_000_000;

test("freeze commands require a finite positive amount and valid timestamp", () => {
  assert.deepEqual(parseMilkBankCommand({ action: "freeze", amountMl: 80, at: now }, now), {
    action: "freeze", amountMl: 80, at: now, confirmExpired: false,
  });
  assert.throws(() => parseMilkBankCommand({ action: "freeze", amountMl: Number.NaN, at: now }, now));
  assert.throws(() => parseMilkBankCommand({ action: "freeze", amountMl: 0, at: now }, now));
  assert.throws(() => parseMilkBankCommand({ action: "freeze", amountMl: 20, at: now + 120_001 }, now));
});

test("packet commands require a non-empty packet identity", () => {
  assert.deepEqual(parseMilkBankCommand({ action: "thaw", packetId: "packet-1", at: now }, now), {
    action: "thaw", packetId: "packet-1", at: now,
  });
  assert.throws(() => parseMilkBankCommand({ action: "thaw", packetId: "", at: now }, now));
  assert.throws(() => parseMilkBankCommand({ action: "discard", at: now }, now));
});

test("frozen reconciliation additions are explicit and positive", () => {
  assert.deepEqual(parseMilkBankCommand({ action: "addPacket", amountMl: 55.5, at: now }, now), {
    action: "addPacket", amountMl: 55.5, at: now,
  });
  assert.throws(() => parseMilkBankCommand({ action: "adjustFrozen", amountMl: 50, at: now }, now));
});
