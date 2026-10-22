import assert from "node:assert/strict";
import test from "node:test";

import { clampNearFutureActivityTimes, clampNearFutureToNow, FUTURE_CLOCK_SKEW_MS, minuteOptionsIncluding } from "./activity-time";

const NOW = 1_792_634_059_000;
const MINUTE = 60 * 1000;

test("a time up to the clock-skew window ahead becomes now", () => {
  assert.equal(clampNearFutureToNow(NOW + 41_000, NOW), NOW);
  assert.equal(clampNearFutureToNow(NOW + FUTURE_CLOCK_SKEW_MS, NOW), NOW);
});

test("past times, now, and times beyond the window are unchanged", () => {
  assert.equal(clampNearFutureToNow(NOW - 5 * MINUTE, NOW), NOW - 5 * MINUTE);
  assert.equal(clampNearFutureToNow(NOW, NOW), NOW);
  assert.equal(clampNearFutureToNow(NOW + FUTURE_CLOCK_SKEW_MS + 1, NOW), NOW + FUTURE_CLOCK_SKEW_MS + 1);
});

test("minute options keep 5-minute steps and add the opening minute", () => {
  assert.deepEqual(minuteOptionsIncluding(10), [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55]);
  assert.deepEqual(minuteOptionsIncluding(4), [0, 4, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55]);
  assert.deepEqual(minuteOptionsIncluding(59).slice(-2), [55, 59]);
});

test("activity requests have a near-future start and end pulled back to now", () => {
  const sleep = { startedAt: NOW + 30_000, endedAt: NOW + 90_000 };
  clampNearFutureActivityTimes(sleep, NOW);
  assert.deepEqual(sleep, { startedAt: NOW, endedAt: NOW });

  const bottle: { startedAt: number; endedAt?: unknown } = { startedAt: NOW - MINUTE, endedAt: null };
  clampNearFutureActivityTimes(bottle, NOW);
  assert.deepEqual(bottle, { startedAt: NOW - MINUTE, endedAt: null });
});
