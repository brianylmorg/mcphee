import assert from "node:assert/strict";
import test from "node:test";

import { canUndoSleepTransition, isSleepUndoToken, type SleepUndoToken } from "./sleep-transition";

test("the latest untouched sleep start can be undone", () => {
  const token: SleepUndoToken = { kind: "started-sleep", activityId: "sleep-1", changedAt: 100 };
  assert.equal(canUndoSleepTransition(token, [
    { id: "sleep-1", startedAt: 100, endedAt: null },
  ], 101), true);
});

test("undoing sleep start is stale after another caregiver wakes the baby", () => {
  const token: SleepUndoToken = { kind: "started-sleep", activityId: "sleep-1", changedAt: 100 };
  assert.equal(canUndoSleepTransition(token, [
    { id: "sleep-1", startedAt: 100, endedAt: 120 },
  ], 121), false);
});

test("the latest untouched wake can be undone", () => {
  const token: SleepUndoToken = { kind: "woke", activityId: "sleep-1", changedAt: 120 };
  assert.equal(canUndoSleepTransition(token, [
    { id: "sleep-1", startedAt: 100, endedAt: 120 },
  ], 121), true);
});

test("undoing wake is stale after a newer sleep transition on another device", () => {
  const token: SleepUndoToken = { kind: "woke", activityId: "sleep-1", changedAt: 120 };
  assert.equal(canUndoSleepTransition(token, [
    { id: "sleep-1", startedAt: 100, endedAt: 120 },
    { id: "sleep-2", startedAt: 130, endedAt: null },
  ], 131), false);
});

test("undoing wake is stale when a newer sleep starts in the same millisecond", () => {
  const token: SleepUndoToken = { kind: "woke", activityId: "sleep-1", changedAt: 120 };
  assert.equal(canUndoSleepTransition(token, [
    { id: "sleep-1", startedAt: 100, endedAt: 120 },
    { id: "sleep-2", startedAt: 120, endedAt: null },
  ], 125), false);
});

test("the server rejects an otherwise current undo after thirty seconds", () => {
  const token: SleepUndoToken = { kind: "woke", activityId: "sleep-1", changedAt: 1_000 };
  assert.equal(canUndoSleepTransition(token, [
    { id: "sleep-1", startedAt: 100, endedAt: 1_000 },
  ], 31_001), false);
});

test("a token cannot target a fabricated or mismatched transition", () => {
  assert.equal(canUndoSleepTransition(
    { kind: "woke", activityId: "sleep-1", changedAt: 119 },
    [{ id: "sleep-1", startedAt: 100, endedAt: 120 }],
    121,
  ), false);
});

const backdatedRows = [{ id: "sleep-1", startedAt: 1_000, endedAt: null }];
const issuedToken: SleepUndoToken = {
  kind: "started-sleep", activityId: "sleep-1", changedAt: 1_000, issuedAt: 1_801_000,
};

test("a backdated transition is undoable for thirty seconds from issue", () => {
  assert.equal(canUndoSleepTransition(issuedToken, backdatedRows, 1_831_000), true);
  assert.equal(canUndoSleepTransition(issuedToken, backdatedRows, 1_831_001), false);
});

test("legacy tokens measure the thirty-second window from changedAt", () => {
  const { issuedAt, ...legacy } = issuedToken;
  assert.equal(canUndoSleepTransition(legacy, backdatedRows, 31_000), true);
  assert.equal(canUndoSleepTransition(legacy, backdatedRows, 31_001), false);
});

test("issuedAt must be a valid timestamp, not too far ahead or before the transition", () => {
  for (const issuedAt of [null, "1801000", 0, -1, NaN, Infinity]) {
    assert.equal(isSleepUndoToken({ ...issuedToken, issuedAt }), false);
  }
  assert.equal(isSleepUndoToken(issuedToken), true);
  const { issuedAt, ...legacy } = issuedToken;
  assert.equal(isSleepUndoToken(legacy), true);
  assert.equal(canUndoSleepTransition({ ...issuedToken, issuedAt: 1_801_001 }, backdatedRows, 1_681_000), false);
  assert.equal(canUndoSleepTransition({ ...issuedToken, issuedAt: 999 }, backdatedRows, 1_001), false);
});
