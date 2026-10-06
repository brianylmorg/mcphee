import assert from "node:assert/strict";
import test from "node:test";

import { formatElapsedDuration, formatElapsedSince } from "./elapsed-time";

const START = 1_700_000_000_000;
const MINUTE = 60 * 1000;

test("elapsed labels always include unpadded hours and minutes", () => {
  assert.equal(formatElapsedSince(START, START), "0h 0m ago");
  assert.equal(formatElapsedSince(START, START + 8 * MINUTE), "0h 8m ago");
  assert.equal(formatElapsedSince(START, START + 60 * MINUTE), "1h 0m ago");
  assert.equal(formatElapsedSince(START, START + (49 * 60 + 3) * MINUTE), "49h 3m ago");
});

test("elapsed duration omits ago but keeps the same shape", () => {
  assert.equal(formatElapsedDuration((2 * 60 + 3) * MINUTE), "2h 3m");
});

test("elapsed helpers clamp future values and reject invalid input", () => {
  assert.equal(formatElapsedSince(START + 10 * MINUTE, START), "0h 0m ago");
  assert.equal(formatElapsedDuration(-MINUTE), "0h 0m");
  assert.equal(formatElapsedSince(Number.NaN, START), null);
  assert.equal(formatElapsedSince(START, Number.POSITIVE_INFINITY), null);
  assert.equal(formatElapsedDuration(Number.NaN), null);
});
