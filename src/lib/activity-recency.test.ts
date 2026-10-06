import assert from "node:assert/strict";
import test from "node:test";

import { formatElapsedSince } from "./activity-recency";

const START = 1_700_000_000_000;
const MINUTE = 60 * 1000;

test("formatElapsedSince clamps to zero minutes for a fresh timestamp", () => {
  assert.equal(formatElapsedSince(START, START), "0h 0m ago");
});

test("formatElapsedSince keeps sub-hour ages in the minutes field", () => {
  assert.equal(formatElapsedSince(START, START + 59 * MINUTE), "0h 59m ago");
});

test("formatElapsedSince rolls minutes over into hours", () => {
  assert.equal(formatElapsedSince(START, START + 60 * MINUTE), "1h 0m ago");
});

test("formatElapsedSince keeps minutes unpadded", () => {
  assert.equal(formatElapsedSince(START, START + (2 * 60 + 5) * MINUTE), "2h 5m ago");
});

test("formatElapsedSince does not cap hours across multiple days", () => {
  assert.equal(formatElapsedSince(START, START + (26 * 60) * MINUTE), "26h 0m ago");
  assert.equal(formatElapsedSince(START, START + (49 * 60 + 30) * MINUTE), "49h 30m ago");
});

test("formatElapsedSince clamps future timestamps to zero", () => {
  assert.equal(formatElapsedSince(START + 10 * MINUTE, START), "0h 0m ago");
});

test("formatElapsedSince returns null for invalid timestamps", () => {
  assert.equal(formatElapsedSince(Number.NaN, START), null);
  assert.equal(formatElapsedSince(Number.POSITIVE_INFINITY, START), null);
});
