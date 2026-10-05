import assert from "node:assert/strict";
import test from "node:test";

import { selectRecentMilkFeeds, type RecentMilkFeedActivity } from "./recent-milk-feeds";

test("recent milk feeds total modern and legacy bottle amounts without counting waste", () => {
  const rows: RecentMilkFeedActivity[] = [
    {
      id: "modern",
      baby_id: "baby-1",
      type: "bottlefeed",
      started_at: 300,
      created_at: 300,
      details: JSON.stringify({
        feeds: [
          { milkType: "breastmilk", amount: 45, wastedAmount: 15, libraryDeductionAmount: 60 },
          { milkType: "formula", amount: 25 },
        ],
      }),
    },
    {
      id: "legacy",
      baby_id: "baby-1",
      type: "bottlefeed",
      started_at: 200,
      created_at: 200,
      details: { milkType: "breastmilk", amount: 55, wastedAmount: 20 },
    },
  ];

  assert.deepEqual(selectRecentMilkFeeds(rows, "baby-1", 400), [
    { id: "modern", startedAt: 300, amountMl: 70 },
    { id: "legacy", startedAt: 200, amountMl: 55 },
  ]);
});

test("recent milk feeds filter by baby and time before applying a deterministic newest-two limit", () => {
  const noise = Array.from({ length: 60 }, (_, index): RecentMilkFeedActivity => ({
    id: `note-${index}`,
    baby_id: "baby-1",
    type: "note",
    started_at: 1_000 - index,
    created_at: index,
    details: {},
  }));
  const rows: RecentMilkFeedActivity[] = [
    ...noise,
    { id: "older", baby_id: "baby-1", type: "bottlefeed", started_at: 100, created_at: 10, details: { milkType: "formula", amount: 30 } },
    { id: "tie-a", baby_id: "baby-1", type: "bottlefeed", started_at: 200, created_at: 20, details: { milkType: "formula", amount: 40 } },
    { id: "tie-b", baby_id: "baby-1", type: "bottlefeed", started_at: 200, created_at: 21, details: { milkType: "breastmilk", amount: 50 } },
    { id: "other-baby", baby_id: "baby-2", type: "bottlefeed", started_at: 250, created_at: 25, details: { amount: 90 } },
    { id: "future", baby_id: "baby-1", type: "bottlefeed", started_at: 301, created_at: 30, details: { amount: 100 } },
  ];

  assert.deepEqual(selectRecentMilkFeeds(rows, "baby-1", 300), [
    { id: "tie-b", startedAt: 200, amountMl: 50 },
    { id: "tie-a", startedAt: 200, amountMl: 40 },
  ]);
});

test("recent milk feeds handle empty and single-feed histories", () => {
  assert.deepEqual(selectRecentMilkFeeds([], "baby-1", 300), []);
  assert.deepEqual(selectRecentMilkFeeds([
    { id: "invalid-date", baby_id: "baby-1", type: "bottlefeed", started_at: null, details: { amount: 80 } },
    { id: "only-feed", baby_id: "baby-1", type: "bottlefeed", started_at: 200, details: { breastmilkAmount: 0.1, formulaAmount: 0.2 } },
  ], "baby-1", 300), [
    { id: "only-feed", startedAt: 200, amountMl: 0.3 },
  ]);
});
