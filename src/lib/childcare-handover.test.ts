import assert from "node:assert/strict";
import test from "node:test";

import { childcareHandover, type HandoverActivity } from "./childcare-handover";

// 2026-10-21T00:00:00Z is 08:00 on 21 Oct 2026 in Singapore.
const NOW = Date.parse("2026-10-21T02:00:00Z");
const MINUTE = 60 * 1000;

function activity(type: string, minutesAgo: number, details: HandoverActivity["details"]): HandoverActivity {
  return { type, started_at: NOW - minutesAgo * MINUTE, details };
}

test("picks the latest bottle feed and diaper, whatever the list order", () => {
  const summary = childcareHandover([
    activity("bottlefeed", 300, { milkType: "formula", amount: 90 }),
    activity("sleep", 10, null),
    activity("diaper", 200, { peeUnits: "2", poop: "no" }),
    activity("bottlefeed", 120, JSON.stringify({ milkType: "breastmilk", amount: "120", notes: " Drank slowly " })),
    activity("diaper", 45, { peeUnits: "3", poop: "M" }),
  ], NOW);

  assert.deepEqual(summary.bottle, { at: NOW - 120 * MINUTE, milk: "Breast milk", volume: "120 ml", note: "Drank slowly" });
  assert.deepEqual(summary.diaper, { at: NOW - 45 * MINUTE, pee: "Pee 3 units", poo: "Poo M", note: "" });
});

test("a mixed bottle spells out each milk", () => {
  const { bottle } = childcareHandover([
    activity("bottlefeed", 30, { milkType: "mixed", feeds: [
      { milkType: "breastmilk", amount: "60" },
      { milkType: "formula", amount: "40" },
    ] }),
  ], NOW);

  assert.equal(bottle?.milk, "Breast milk + formula");
  assert.equal(bottle?.volume, "60 ml breast milk · 40 ml formula");
});

test("diaper labels cover no pee, caretaker poo and older pee sizes", () => {
  assert.deepEqual(
    childcareHandover([activity("diaper", 5, { peeUnits: "no", poop: "L", note: "Bit runny" })], NOW).diaper,
    { at: NOW - 5 * MINUTE, pee: "No pee", poo: "Poo L", note: "Bit runny" },
  );
  assert.equal(childcareHandover([activity("diaper", 5, { peeUnits: 1, poop: "yes" })], NOW).diaper?.poo, "Poo");
  assert.equal(childcareHandover([activity("diaper", 5, { peeUnits: 1 })], NOW).diaper?.pee, "Pee 1 unit");
  assert.equal(childcareHandover([activity("diaper", 5, { peeSize: "L" })], NOW).diaper?.pee, "Pee 5 units");
});

test("nothing logged yet, or only future-dated entries, gives empty rows", () => {
  assert.deepEqual(childcareHandover([], NOW), { bottle: null, diaper: null });
  assert.deepEqual(
    childcareHandover([activity("bottlefeed", -60, { amount: 100 }), activity("diaper", 0, "not json")], NOW),
    { bottle: null, diaper: { at: NOW, pee: "No pee", poo: "No poo", note: "" } },
  );
});
