import assert from "node:assert/strict";
import test from "node:test";

import {
  fingerprintCaretakerSleepActivities,
  planCaretakerSleepReconciliation,
  type ExistingSleepActivity,
} from "./caretaker-sleep-reconciliation";

const coverage = { startedAt: 800, endedAt: 1_600 };
const sleep = (id: string, startedAt: number, endedAt: number | null): ExistingSleepActivity => ({
  id, startedAt, endedAt, details: "{}", createdAt: startedAt, createdBy: "Parent",
});

test("sleep reconciliation trims, splits and removes closed sleeps inside the care window", () => {
  const plan = planCaretakerSleepReconciliation(coverage, [], [
    sleep("left", 700, 900),
    sleep("inside", 900, 1_000),
    sleep("right", 1_500, 1_700),
    sleep("straddler", 600, 1_800),
  ]);

  assert.deepEqual(plan.removedActivityIds, ["inside"]);
  assert.deepEqual(plan.updates, [
    { activityId: "straddler", startedAt: 600, endedAt: 800 },
    { activityId: "left", startedAt: 700, endedAt: 800 },
    { activityId: "right", startedAt: 1_600, endedAt: 1_700 },
  ]);
  assert.deepEqual(plan.splits.map(({ sourceActivityId, startedAt, endedAt }) => ({ sourceActivityId, startedAt, endedAt })), [
    { sourceActivityId: "straddler", startedAt: 1_600, endedAt: 1_800 },
  ]);
});

test("an overlapping open sleep keeps only its prefix and is never resurrected after care", () => {
  const before = planCaretakerSleepReconciliation(coverage, [], [sleep("open-before", 700, null)]);
  assert.deepEqual(before.updates, [{ activityId: "open-before", startedAt: 700, endedAt: 800 }]);
  assert.equal(before.splits.length, 0);

  const inside = planCaretakerSleepReconciliation(coverage, [], [sleep("open-inside", 900, null)]);
  assert.deepEqual(inside.removedActivityIds, ["open-inside"]);
  assert.equal(inside.splits.length, 0);
});

test("exact authoritative naps are retained once while nonmatching naps are inserted", () => {
  const plan = planCaretakerSleepReconciliation(coverage, [
    { rowId: "row-exact", startedAt: 900, endedAt: 1_000 },
    { rowId: "row-new", startedAt: 1_200, endedAt: 1_300 },
  ], [sleep("existing-exact", 900, 1_000)]);

  assert.deepEqual(plan.retainedExact, [{
    rowId: "row-exact", activityId: "existing-exact", startedAt: 900, endedAt: 1_000,
  }]);
  assert.deepEqual(plan.inserts, [{ rowId: "row-new", startedAt: 1_200, endedAt: 1_300 }]);
  assert.equal(plan.removedCount, 0);
});

test("the fingerprint is stable by content and changes with relevant sleep state", () => {
  const first = sleep("one", 900, 1_000);
  const second = sleep("two", 1_200, 1_300);
  assert.equal(
    fingerprintCaretakerSleepActivities([first, second]),
    fingerprintCaretakerSleepActivities([second, first]),
  );
  assert.notEqual(
    fingerprintCaretakerSleepActivities([first, second]),
    fingerprintCaretakerSleepActivities([first, { ...second, endedAt: 1_301 }]),
  );
});

test("authoritative naps must be integral, non-overlapping, and inside coverage", () => {
  assert.throws(() => planCaretakerSleepReconciliation(coverage, [
    { rowId: "one", startedAt: 900, endedAt: 1_000 },
    { rowId: "duplicate", startedAt: 900, endedAt: 1_000 },
  ], []), /INVALID_AUTHORITATIVE_NAPS/);
  assert.throws(() => planCaretakerSleepReconciliation(coverage, [
    { rowId: "outside", startedAt: 700, endedAt: 900 },
  ], []), /INVALID_AUTHORITATIVE_NAPS/);
  assert.throws(() => planCaretakerSleepReconciliation(coverage, [
    { rowId: "fractional", startedAt: 900.5, endedAt: 1_000 },
  ], []), /INVALID_AUTHORITATIVE_NAPS/);
  assert.doesNotThrow(() => planCaretakerSleepReconciliation(coverage, [
    { rowId: "one", startedAt: 900, endedAt: 1_000 },
    { rowId: "adjacent", startedAt: 1_000, endedAt: 1_100 },
  ], []));
});

test("existing sleeps must be unique, valid and actually overlap the care window", () => {
  assert.throws(() => planCaretakerSleepReconciliation(coverage, [], [
    sleep("boundary-left", 700, 800),
  ]), /INVALID_EXISTING_SLEEP/);
  assert.throws(() => planCaretakerSleepReconciliation(coverage, [], [
    sleep("boundary-right", 1_600, null),
  ]), /INVALID_EXISTING_SLEEP/);
  assert.throws(() => planCaretakerSleepReconciliation(coverage, [], [
    sleep("same", 900, 1_000), sleep("same", 1_100, 1_200),
  ]), /INVALID_EXISTING_SLEEP/);
  assert.throws(() => planCaretakerSleepReconciliation(coverage, [], [
    sleep("reversed", 1_000, 900),
  ]), /INVALID_EXISTING_SLEEP/);
});

test("the plan owns copies of mutable coverage and nap inputs", () => {
  const mutableCoverage = {
    startedAt: 800, endedAt: 1_600,
    napsChecked: true, rawSource: "must-not-survive-in-audit",
  };
  const mutableNap = { rowId: "nap", startedAt: 900, endedAt: 1_000 };
  const plan = planCaretakerSleepReconciliation(mutableCoverage, [mutableNap], []);
  mutableCoverage.startedAt = 700;
  mutableNap.startedAt = 950;
  assert.deepEqual(plan.coverage, coverage);
  assert.deepEqual(plan.inserts, [{ rowId: "nap", startedAt: 900, endedAt: 1_000 }]);
});
