import assert from "node:assert/strict";
import test from "node:test";

import {
  buildBaselinePreview,
  episodeOverlapsSgtDate,
  parsePeeUnits,
} from "./sick-mode";

const day = (date: string, hour = 12) => Date.parse(`${date}T${String(hour).padStart(2, "0")}:00:00+08:00`);

test("baseline uses only positive consumed feeds from the seven completed SGT days", () => {
  const preview = buildBaselinePreview(day("2026-10-08"), [
    { id: "old", type: "bottlefeed", started_at: day("2026-09-30"), details: { amount: 999 } },
    { id: "one", type: "bottlefeed", started_at: day("2026-10-01"), details: { milkType: "formula", amount: 700 } },
    { id: "mixed", type: "bottlefeed", started_at: day("2026-10-02"), details: { breastmilkAmount: 400, formulaAmount: 400 } },
    { id: "waste", type: "bottlefeed", started_at: day("2026-10-03"), details: { amount: 0, wastedAmount: 90 } },
    { id: "pump", type: "pump", started_at: day("2026-10-04"), details: { amount: 900 } },
    { id: "sick", type: "bottlefeed", started_at: day("2026-10-05"), details: { amount: 600 } },
    { id: "six", type: "bottlefeed", started_at: day("2026-10-06"), details: { amount: 900 } },
    { id: "partial", type: "bottlefeed", started_at: day("2026-10-08", 1), details: { amount: 300 } },
  ], [{ startedAt: day("2026-10-05", 1), endedAt: day("2026-10-05", 23) }]);

  assert.deepEqual(preview.sourceDays, [
    { date: "2026-10-01", totalMl: 700 },
    { date: "2026-10-02", totalMl: 800 },
    { date: "2026-10-06", totalMl: 900 },
  ]);
  assert.equal(preview.medianDailyMl, 800);
  assert.equal(preview.availableDayCount, 3);
  assert.equal(preview.requiresIncompleteConfirmation, true);
  assert.equal(preview.requiresManualBaseline, false);
});

test("empty baseline requires a manual value and missing days are not zeros", () => {
  const preview = buildBaselinePreview(day("2026-10-08"), [], []);
  assert.equal(preview.medianDailyMl, null);
  assert.equal(preview.availableDayCount, 0);
  assert.equal(preview.requiresManualBaseline, true);
  assert.equal(preview.requiresIncompleteConfirmation, false);
});

test("SGT calendar overlap and pee-unit compatibility are explicit", () => {
  const episode = { startedAt: day("2026-10-02", 23), endedAt: day("2026-10-03", 1) };
  assert.equal(episodeOverlapsSgtDate(episode, "2026-10-02"), true);
  assert.equal(episodeOverlapsSgtDate(episode, "2026-10-03"), true);
  assert.equal(episodeOverlapsSgtDate(episode, "2026-10-04"), false);
  assert.equal(parsePeeUnits({ peeUnits: "1" }), 1);
  assert.equal(parsePeeUnits({ peeSize: "M" }), 3);
  assert.equal(parsePeeUnits({ peeSize: "L" }), 5);
  assert.equal(parsePeeUnits({ peeSize: "No" }), 0);
  assert.equal(parsePeeUnits({ peeUnits: "unknown" }), null);
});
