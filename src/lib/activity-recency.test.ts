import assert from "node:assert/strict";
import test from "node:test";

import { formatElapsedSince } from "./activity-recency";

const START = 1_700_000_000_000;
const MINUTE = 60 * 1000;

test("formatElapsedSince clamps to zero minutes for a fresh timestamp", () => {
  assert.equal(formatElapsedSince(START, START), "0h 00mins ago");
});

test("formatElapsedSince keeps sub-hour ages in the minutes field", () => {
  assert.equal(formatElapsedSince(START, START + 59 * MINUTE), "0h 59mins ago");
});

test("formatElapsedSince rolls minutes over into hours", () => {
  assert.equal(formatElapsedSince(START, START + 60 * MINUTE), "1h 00mins ago");
});

test("formatElapsedSince pads minutes to two digits", () => {
  assert.equal(formatElapsedSince(START, START + (2 * 60 + 5) * MINUTE), "2h 05mins ago");
});

test("formatElapsedSince does not cap hours across multiple days", () => {
  assert.equal(formatElapsedSince(START, START + (26 * 60) * MINUTE), "26h 00mins ago");
  assert.equal(formatElapsedSince(START, START + (49 * 60 + 30) * MINUTE), "49h 30mins ago");
});

test("formatElapsedSince clamps future timestamps to zero", () => {
  assert.equal(formatElapsedSince(START + 10 * MINUTE, START), "0h 00mins ago");
});

test("formatElapsedSince returns null for invalid timestamps", () => {
  assert.equal(formatElapsedSince(Number.NaN, START), null);
  assert.equal(formatElapsedSince(Number.POSITIVE_INFINITY, START), null);
});
