import assert from "node:assert/strict";
import test from "node:test";
import { milkHint, MILK_DUE_FROM_MS, MILK_PAST_FROM_MS } from "./milk-hint";

const feedAt = 1_000_000;

test("waits until 2h45m and rejects missing or non-finite feed times", () => {
  assert.equal(milkHint(feedAt, feedAt + MILK_DUE_FROM_MS - 1), null);
  assert.equal(milkHint(null, feedAt + MILK_DUE_FROM_MS), null);
  assert.equal(milkHint(Number.NaN, feedAt + MILK_DUE_FROM_MS), null);
});

test("shows due at 2h45m and 3h, then past at 3h30m", () => {
  assert.deepEqual(milkHint(feedAt, feedAt + MILK_DUE_FROM_MS), { status: "due", text: "Milk time" });
  assert.deepEqual(milkHint(feedAt, feedAt + 3 * 60 * 60 * 1000), { status: "due", text: "Milk time" });
  assert.deepEqual(milkHint(feedAt, feedAt + MILK_PAST_FROM_MS), { status: "past", text: "Past milk time" });
});

test("uses wake wording while asleep in both hint states", () => {
  assert.deepEqual(milkHint(feedAt, feedAt + MILK_DUE_FROM_MS, true), { status: "due", text: "Milk when he wakes" });
  assert.deepEqual(milkHint(feedAt, feedAt + MILK_PAST_FROM_MS, true), { status: "past", text: "Milk when he wakes" });
});

test("no hint once the last logged feed is 8 hours old (the log is probably behind)", () => {
  const now = Date.parse("2026-10-19T12:00:00+08:00");
  assert.equal(milkHint(now - 8 * 60 * 60 * 1000, now), null);
  assert.equal(milkHint(now - 7.9 * 60 * 60 * 1000, now)?.status, "past");
});
