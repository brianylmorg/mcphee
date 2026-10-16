import assert from "node:assert/strict";
import test from "node:test";

import {
  applyMilkActivityChangeToTotals,
  sameTimeMilkMedianReference,
  shouldHoldDashboardForSickMode,
  updateRecentMilkFeedList,
  updateSickLatestMilkFeeds,
  type MilkActivitySnapshot,
  type SameTimeMilkHistoryDay,
} from "./dashboard-milk-state";

const today = "2026-10-08";
const todayAtNoon = Date.parse(`${today}T12:00:00+08:00`);

function feed(id: string, startedAt: number, feeds: Array<{ milkType: string; amount: number }>): MilkActivitySnapshot {
  return { id, type: "bottlefeed", startedAt, details: { feeds } };
}

function historyDay(
  date: string,
  asOfNowMl: number,
  overrides: Partial<SameTimeMilkHistoryDay> = {},
): SameTimeMilkHistoryDay {
  return { date, totalMl: Math.max(1, asOfNowMl), asOfNowMl, ...overrides };
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

test("a long-running illness keeps the same pre-sickness source dates as today advances", () => {
  const sourceDates = [
    "2026-09-24", "2026-09-25", "2026-09-26", "2026-09-27", "2026-09-28", "2026-09-29", "2026-09-30",
  ];
  const history = [
    ...sourceDates.map((date, index) => historyDay(date, (index + 1) * 10, { totalMl: 500 + index })),
    ...["2026-10-08", "2026-10-09", "2026-10-10", "2026-10-11", "2026-10-12", "2026-10-13", "2026-10-14"]
      .map((date) => historyDay(date, 999)),
  ];
  const episode = {
    startedAt: Date.parse("2026-10-01T09:00:00+08:00"),
    baselineSourceDays: sourceDates.map((date) => ({ date, totalMl: 700 })),
  };

  const first = sameTimeMilkMedianReference(history, "2026-10-15", episode);
  const nextDay = sameTimeMilkMedianReference(history, "2026-10-16", episode);

  assert.equal(first.kind, "pre-sickness");
  assert.deepEqual(first.days.map((day) => day.date), sourceDates);
  assert.equal(first.medianMl, 40);
  assert.deepEqual(nextDay.days.map((day) => day.date), sourceDates);
  assert.equal(nextDay.medianMl, 40);
});

test("sick feeds never enter either pre-sickness or normal same-time references", () => {
  const history = [
    historyDay("2026-09-29", 200),
    historyDay("2026-09-30", 900, { isSickDay: true }),
    historyDay("2026-10-08", 300),
    historyDay("2026-10-09", 800, { isSickDay: true }),
  ];
  const sick = sameTimeMilkMedianReference(history, "2026-10-10", {
    startedAt: Date.parse("2026-10-01T08:00:00+08:00"),
    baselineSourceDays: [
      { date: "2026-09-29", totalMl: 600 },
      { date: "2026-09-30", totalMl: 600 },
    ],
  });
  const normal = sameTimeMilkMedianReference(history, "2026-10-10");

  assert.deepEqual(sick.days.map((day) => day.date), ["2026-09-29"]);
  assert.equal(sick.medianMl, 200);
  assert.deepEqual(normal.days.map((day) => day.date), ["2026-09-29", "2026-10-08"]);
  assert.equal(normal.medianMl, 250);
});

test("normal mode uses the latest seven completed non-sick SGT days with milk logs", () => {
  const history = [
    historyDay("2026-10-01", 1),
    historyDay("2026-10-02", 20),
    historyDay("2026-10-04", 40),
    historyDay("2026-10-06", 60, { totalMl: 0 }),
    historyDay("2026-10-07", 70),
    historyDay("2026-10-08", 80, { isSickDay: true }),
    historyDay("2026-10-09", 900),
  ];

  const reference = sameTimeMilkMedianReference(history, "2026-10-09");

  assert.equal(reference.kind, "rolling");
  assert.equal(reference.anchorDate, "2026-10-09");
  assert.deepEqual(
    reference.days.map((day) => day.date),
    ["2026-10-01", "2026-10-02", "2026-10-04", "2026-10-07"],
  );
  assert.equal(reference.medianMl, 30);
});

test("active episodes without usable saved history do not fall back to rolling dates", () => {
  const history = [historyDay("2026-10-08", 800), historyDay("2026-09-30", 300, { totalMl: 0 })];
  const startedAt = Date.parse("2026-10-01T09:00:00+08:00");

  const missingMetadata = sameTimeMilkMedianReference(history, "2026-10-10", { startedAt });
  const manualEmpty = sameTimeMilkMedianReference(history, "2026-10-10", { startedAt, baselineSourceDays: [] });
  const missingHistory = sameTimeMilkMedianReference(history, "2026-10-10", {
    startedAt,
    baselineSourceDays: [{ date: "2026-09-29", totalMl: 700 }],
  });
  const zeroFullDay = sameTimeMilkMedianReference(history, "2026-10-10", {
    startedAt,
    baselineSourceDays: [{ date: "2026-09-30", totalMl: 700 }],
  });

  for (const reference of [missingMetadata, manualEmpty, missingHistory, zeroFullDay]) {
    assert.deepEqual(reference.days, []);
    assert.equal(reference.medianMl, null);
  }
});

test("pre-sickness source dates are canonical, bounded, and deduplicated", () => {
  const history = [
    historyDay("2026-09-23", 10),
    historyDay("2026-09-24", 20),
    historyDay("2026-09-30", 30),
    historyDay("2026-10-01", 40),
  ];
  const reference = sameTimeMilkMedianReference(history, "2026-10-15", {
    startedAt: Date.parse("2026-10-01T09:00:00+08:00"),
    baselineSourceDays: [
      { date: "2026-09-24", totalMl: 700 },
      { date: "2026-09-24", totalMl: 700 },
      { date: "2026-09-30", totalMl: 700 },
      { date: "2026-09-31", totalMl: 700 },
      { date: "2026-09-23", totalMl: 700 },
      { date: "2026-10-01", totalMl: 700 },
      { date: "2026-10-02", totalMl: 700 },
    ],
  });

  assert.deepEqual(reference.days.map((day) => day.date), ["2026-09-24", "2026-09-30"]);
  assert.equal(reference.medianMl, 25);
});

test("an onset timestamp at the UTC-to-SGT boundary uses the previous SGT date", () => {
  const reference = sameTimeMilkMedianReference([
    historyDay("2026-10-04", 140),
    historyDay("2026-10-05", 999),
  ], "2026-10-12", {
    startedAt: Date.parse("2026-10-04T16:00:00.000Z"),
    baselineSourceDays: [
      { date: "2026-10-04", totalMl: 600 },
      { date: "2026-10-05", totalMl: 600 },
    ],
  });

  assert.equal(reference.anchorDate, "2026-10-05");
  assert.deepEqual(reference.days.map((day) => day.date), ["2026-10-04"]);
});

test("an invalid active episode timestamp fails closed without reading rolling history", () => {
  const reference = sameTimeMilkMedianReference([historyDay("2026-10-08", 800)], "2026-10-09", {
    startedAt: Number.MAX_VALUE,
    baselineSourceDays: [{ date: "2026-10-08", totalMl: 800 }],
  });

  assert.equal(reference.kind, "pre-sickness");
  assert.equal(reference.anchorDate, "");
  assert.deepEqual(reference.days, []);
  assert.equal(reference.medianMl, null);
});

test("a valid positive full-day source preserves a zero same-time amount", () => {
  const reference = sameTimeMilkMedianReference([
    historyDay("2026-09-29", 0, { totalMl: 500 }),
    historyDay("2026-09-30", 100, { totalMl: 600 }),
  ], "2026-10-08", {
    startedAt: Date.parse("2026-10-01T09:00:00+08:00"),
    baselineSourceDays: [
      { date: "2026-09-29", totalMl: 500 },
      { date: "2026-09-30", totalMl: 600 },
    ],
  });

  assert.equal(reference.days.length, 2);
  assert.equal(reference.days[0].asOfNowMl, 0);
  assert.equal(reference.medianMl, 50);
});

test("same-time median selection does not mutate history or episode metadata", () => {
  const history = [historyDay("2026-09-30", 100, { totalMl: 600 })];
  const episode = {
    startedAt: Date.parse("2026-10-01T09:00:00+08:00"),
    baselineSourceDays: [{ date: "2026-09-30", totalMl: 600 }],
  };
  const originalHistory = structuredClone(history);
  const originalEpisode = structuredClone(episode);

  sameTimeMilkMedianReference(history, "2026-10-08", episode);

  assert.deepEqual(history, originalHistory);
  assert.deepEqual(episode, originalEpisode);
});

test("normal mode picks exactly the latest seven eligible non-sick logged days from unordered history", () => {
  const history = [
    historyDay("2026-10-16", 60),
    historyDay("2026-10-05", 30),
    historyDay("2026-10-30", 999),
    historyDay("2026-11-03", 888),
    historyDay("2026-10-13", 90, { isSickDay: true }),
    historyDay("2026-10-10", 70, { totalMl: 0 }),
    historyDay("2026-10-14", Number.NaN),
    historyDay("2026-10-19", 10),
    historyDay("2026-10-3", 77),
    historyDay("2026-10-09", 50),
    historyDay("2026-10-12", 40),
    historyDay("2026-10-01", 1),
    historyDay("2026-10-15", 70),
    historyDay("2026-10-08", 20),
    historyDay("2026-13-01", 66),
    historyDay("2026-10-03", 2),
    historyDay("2026-10-06", 95, { isSickDay: true }),
  ];
  const original = structuredClone(history);

  const reference = sameTimeMilkMedianReference(history, "2026-10-30");

  assert.equal(reference.kind, "rolling");
  assert.equal(reference.anchorDate, "2026-10-30");
  assert.deepEqual(reference.days.map((day) => day.date), [
    "2026-10-05", "2026-10-08", "2026-10-09", "2026-10-12", "2026-10-15", "2026-10-16", "2026-10-19",
  ]);
  assert.equal(reference.medianMl, 40);
  assert.deepEqual(history, original);
});

test("normal mode backfills pre-sickness days after an episode ends, then replaces them as healthy days accrue", () => {
  const preSickDates = ["2026-09-25", "2026-09-26", "2026-09-27", "2026-09-28", "2026-09-29", "2026-09-30"];
  const history = [
    ...preSickDates.map((date, index) => historyDay(date, 100 + index * 10)),
    historyDay("2026-10-05", 700, { isSickDay: true }),
    historyDay("2026-10-11", 700, { isSickDay: true }),
    historyDay("2026-10-20", 700, { isSickDay: true }),
    historyDay("2026-10-21", 200),
    historyDay("2026-10-22", 210),
    historyDay("2026-10-23", 220),
    historyDay("2026-10-24", 230),
  ];
  const activeEpisode = {
    startedAt: Date.parse("2026-10-02T09:00:00+08:00"),
    baselineSourceDays: preSickDates.map((date) => ({ date, totalMl: 700 })),
  };

  const duringEpisode = sameTimeMilkMedianReference(history, "2026-10-25", activeEpisode);
  const firstHealthyDay = sameTimeMilkMedianReference(history, "2026-10-21");
  const seventhDay = sameTimeMilkMedianReference(history, "2026-10-22");
  const replaced = sameTimeMilkMedianReference(history, "2026-10-25");

  assert.deepEqual(duringEpisode.days.map((day) => day.date), preSickDates);
  assert.equal(duringEpisode.medianMl, 125);
  assert.deepEqual(firstHealthyDay.days.map((day) => day.date), preSickDates);
  assert.deepEqual(seventhDay.days.map((day) => day.date), [...preSickDates, "2026-10-21"]);
  assert.deepEqual(replaced.days.map((day) => day.date), [
    "2026-09-28", "2026-09-29", "2026-09-30", "2026-10-21", "2026-10-22", "2026-10-23", "2026-10-24",
  ]);
});

test("normal mode handles missing and insufficient eligible history without inventing days", () => {
  const empty = sameTimeMilkMedianReference([], "2026-10-08");
  const onlyToday = sameTimeMilkMedianReference([historyDay("2026-10-08", 900)], "2026-10-08");
  const twoDays = sameTimeMilkMedianReference([
    historyDay("2026-10-05", 100),
    historyDay("2026-10-07", 300, { totalMl: 0 }),
    historyDay("2026-10-06", 200),
  ], "2026-10-08");

  assert.deepEqual(empty, { anchorDate: "2026-10-08", kind: "rolling", days: [], medianMl: null });
  assert.deepEqual(onlyToday.days, []);
  assert.equal(onlyToday.medianMl, null);
  assert.deepEqual(twoDays.days.map((day) => day.date), ["2026-10-05", "2026-10-06"]);
  assert.equal(twoDays.medianMl, 150);
});

test("normal mode counts each calendar day once when history repeats a date", () => {
  const history = [
    historyDay("2026-10-06", 100),
    historyDay("2026-10-01", 10),
    historyDay("2026-10-06", 900),
    historyDay("2026-10-02", 20),
    historyDay("2026-10-03", 30),
    historyDay("2026-10-04", 40),
    historyDay("2026-10-05", 50),
    historyDay("2026-10-07", 70, { isSickDay: true }),
  ];

  const reference = sameTimeMilkMedianReference(history, "2026-10-08");

  assert.deepEqual(reference.days.map((day) => day.date), [
    "2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05", "2026-10-06",
  ]);
  assert.equal(reference.days[5].asOfNowMl, 100);
  assert.equal(reference.medianMl, 35);
});
