import assert from "node:assert/strict";
import test from "node:test";

import {
  applyMilkActivityChangeToTotals,
  shouldHoldDashboardForSickMode,
  updateRecentMilkFeedList,
  updateSickLatestMilkFeeds,
  type MilkActivitySnapshot,
} from "./dashboard-milk-state";

const today = "2026-10-08";
const todayAtNoon = Date.parse(`${today}T12:00:00+08:00`);

function feed(id: string, startedAt: number, feeds: Array<{ milkType: string; amount: number }>): MilkActivitySnapshot {
  return { id, type: "bottlefeed", startedAt, details: { feeds } };
}

test("a newly logged mixed feed immediately updates today's consumed totals", () => {
  assert.deepEqual(applyMilkActivityChangeToTotals(
    { totalMl: 300, breastmilkMl: 180, formulaMl: 120 },
    null,
    feed("new", todayAtNoon, [{ milkType: "breastmilk", amount: 45 }, { milkType: "formula", amount: 30 }]),
    today,
  ), { totalMl: 375, breastmilkMl: 225, formulaMl: 150 });
});

test("successive optimistic feed saves build on the latest total instead of a stale render", () => {
  const first = applyMilkActivityChangeToTotals(
    { totalMl: 0, breastmilkMl: 0, formulaMl: 0 }, null,
    feed("first", todayAtNoon, [{ milkType: "breastmilk", amount: 60 }]), today,
  );
  const second = applyMilkActivityChangeToTotals(
    first, null, feed("second", todayAtNoon + 1_000, [{ milkType: "formula", amount: 40 }]), today,
  );
  assert.deepEqual(second, { totalMl: 100, breastmilkMl: 60, formulaMl: 40 });
});

test("editing a feed accounts for same-day and cross-day changes", () => {
  const previous = feed("old", todayAtNoon - 60_000, [{ milkType: "formula", amount: 90 }]);
  const next = feed("old", todayAtNoon, [{ milkType: "breastmilk", amount: 60 }]);
  assert.deepEqual(applyMilkActivityChangeToTotals(
    { totalMl: 400, breastmilkMl: 200, formulaMl: 200 }, previous, next, today,
  ), { totalMl: 370, breastmilkMl: 260, formulaMl: 110 });

  const yesterday = todayAtNoon - 24 * 60 * 60 * 1000;
  assert.deepEqual(applyMilkActivityChangeToTotals(
    { totalMl: 400, breastmilkMl: 200, formulaMl: 200 },
    feed("yesterday", yesterday, [{ milkType: "formula", amount: 90 }]),
    feed("yesterday", todayAtNoon, [{ milkType: "formula", amount: 50 }]),
    today,
  ), { totalMl: 450, breastmilkMl: 200, formulaMl: 250 });
});

test("a pump or a feed on another date cannot change today's consumption", () => {
  const current = { totalMl: 400, breastmilkMl: 200, formulaMl: 200 };
  const pump = { id: "pump", type: "pump", startedAt: todayAtNoon, details: { amount: 120 } };
  const otherDay = feed("old", todayAtNoon - 24 * 60 * 60 * 1000, [{ milkType: "formula", amount: 60 }]);
  assert.deepEqual(applyMilkActivityChangeToTotals(current, null, pump, today), current);
  assert.deepEqual(applyMilkActivityChangeToTotals(current, null, otherDay, today), current);
});

test("recent feed summaries replace edited entries and cap at three", () => {
  const current = [
    { id: "a", startedAt: 3, amountMl: 1 },
    { id: "b", startedAt: 2, amountMl: 2 },
    { id: "c", startedAt: 1, amountMl: 3 },
  ];
  const next = feed("b", todayAtNoon, [{ milkType: "formula", amount: 75 }]);
  const updated = updateRecentMilkFeedList(current, "b", next, todayAtNoon + 1);
  assert.deepEqual(updated, [
    { id: "b", startedAt: todayAtNoon, amountMl: 75 },
    { id: "a", startedAt: 3, amountMl: 1 },
    { id: "c", startedAt: 1, amountMl: 3 },
  ]);
  assert.deepEqual(updateSickLatestMilkFeeds([], null, next, todayAtNoon + 1), [
    { id: "b", startedAt: todayAtNoon, totalMl: 75, breastmilkMl: 0, formulaMl: 75 },
  ]);
});

test("the first dashboard render waits for sick mode to resolve for its baby", () => {
  assert.equal(shouldHoldDashboardForSickMode(true, "baby-1", null), true);
  assert.equal(shouldHoldDashboardForSickMode(false, "baby-1", null), true);
  assert.equal(shouldHoldDashboardForSickMode(false, "baby-1", "baby-2"), true);
  assert.equal(shouldHoldDashboardForSickMode(false, "baby-1", "baby-1"), false);
  assert.equal(shouldHoldDashboardForSickMode(false, null, null), false);
});
