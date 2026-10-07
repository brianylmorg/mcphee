import assert from "node:assert/strict";
import test from "node:test";

import { formatElapsedDuration, formatElapsedSince } from "./elapsed-time";

const START = 1_700_000_000_000;
const MINUTE = 60 * 1000;

test("elapsed labels always include unpadded hours and minutes", () => {
  assert.equal(formatElapsedSince(START, START), "0h 0m ago");
  assert.equal(formatElapsedSince(START, START + 8 * MINUTE), "0h 8m ago");
  assert.equal(formatElapsedSince(START, START + 60 * MINUTE), "1h 0m ago");
  assert.equal(formatElapsedSince(START, START + (23 * 60 + 59) * MINUTE), "23h 59m ago");
});

test("elapsed duration omits ago but keeps the same shape", () => {
  assert.equal(formatElapsedDuration((2 * 60 + 3) * MINUTE), "2h 3m");
});

test("day-scale durations switch to days, hours, and padded minutes", () => {
  assert.equal(formatElapsedDuration(24 * 60 * MINUTE), "1d, 0h, 00m");
  assert.equal(formatElapsedDuration(25 * 60 * MINUTE), "1d, 1h, 00m");
  assert.equal(formatElapsedDuration(48 * 60 * MINUTE), "2d, 0h, 00m");
  assert.equal(formatElapsedDuration((49 * 60 + 3) * MINUTE), "2d, 1h, 03m");
  assert.equal(formatElapsedDuration((24 * 60 + 1) * MINUTE), "1d, 0h, 01m");
});

test("elapsed since appends ago to day-scale durations", () => {
  assert.equal(formatElapsedSince(START, START + 25 * 60 * MINUTE), "1d, 1h, 00m ago");
  assert.equal(
    formatElapsedSince(START, START + (49 * 60 + 3) * MINUTE),
    "2d, 1h, 03m ago",
  );
});

test("elapsed helpers clamp future values and reject invalid input", () => {
  assert.equal(formatElapsedSince(START + 10 * MINUTE, START), "0h 0m ago");
  assert.equal(formatElapsedDuration(-MINUTE), "0h 0m");
  assert.equal(formatElapsedSince(Number.NaN, START), null);
  assert.equal(formatElapsedSince(START, Number.POSITIVE_INFINITY), null);
  assert.equal(formatElapsedDuration(Number.NaN), null);
});
