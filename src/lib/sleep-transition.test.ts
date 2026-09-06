import assert from "node:assert/strict";
import test from "node:test";

import { canUndoSleepTransition, type SleepUndoToken } from "./sleep-transition";

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

test("the server rejects an otherwise current undo after ten seconds", () => {
  const token: SleepUndoToken = { kind: "woke", activityId: "sleep-1", changedAt: 1_000 };
  assert.equal(canUndoSleepTransition(token, [
    { id: "sleep-1", startedAt: 100, endedAt: 1_000 },
  ], 11_001), false);
});

test("a token cannot target a fabricated or mismatched transition", () => {
  assert.equal(canUndoSleepTransition(
    { kind: "woke", activityId: "sleep-1", changedAt: 119 },
    [{ id: "sleep-1", startedAt: 100, endedAt: 120 }],
    121,
  ), false);
});
