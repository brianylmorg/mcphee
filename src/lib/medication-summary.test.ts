import assert from "node:assert/strict";
import test from "node:test";

import { medicationSummary, MEDICATION_COLLAPSE_FROM, type SummaryMedication } from "./medication-summary";

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const now = Date.parse("2026-11-26T12:00:00+08:00");

const med = (overrides: Partial<SummaryMedication> = {}): SummaryMedication => ({
  name: "Amoxicillin", asNeeded: false, minIntervalHours: 8, latestDose: { givenAt: now - 3 * HOUR }, ...overrides,
});

test("collapses from three medicines", () => {
  assert.equal(MEDICATION_COLLAPSE_FROM, 3);
});

test("labels the count", () => {
  assert.equal(medicationSummary([med()], now).label, "1 medicine");
  assert.equal(medicationSummary([med(), med(), med()], now).label, "3 medicines");
});

test("shows the scheduled medicine due soonest", () => {
  const summary = medicationSummary([
    med({ name: "Cetirizine", minIntervalHours: 24, latestDose: { givenAt: now - 9 * HOUR } }),
    med({ name: "Amoxicillin", latestDose: { givenAt: now - 3 * HOUR } }),
  ], now);
  assert.deepEqual(summary.headline, { name: "Amoxicillin", detail: "due 17:00 hrs · in 5h 0m", tone: "next" });
});

test("overdue and due-within-30-minutes use the warning tones", () => {
  assert.deepEqual(
    medicationSummary([med({ latestDose: { givenAt: now - 8 * HOUR - 20 * MIN } })], now).headline,
    { name: "Amoxicillin", detail: "overdue 0h 20m", tone: "overdue" },
  );
  assert.equal(medicationSummary([med({ latestDose: { givenAt: now - 8 * HOUR + 10 * MIN } })], now).headline?.tone, "due");
});

test("a scheduled medicine with no dose yet is due now and wins", () => {
  const summary = medicationSummary([med(), med({ name: "Cetirizine", latestDose: null })], now);
  assert.deepEqual(summary.headline, { name: "Cetirizine", detail: "no dose yet", tone: "due" });
});

test("as-needed medicines are never due; with no schedule the latest dose shows", () => {
  const summary = medicationSummary([
    med({ name: "Ibuprofen", asNeeded: true, minIntervalHours: 6, latestDose: { givenAt: now - 7 * HOUR } }),
    med({ name: "Saline drops", asNeeded: true, minIntervalHours: null, latestDose: { givenAt: now - 2 * HOUR } }),
  ], now);
  assert.deepEqual(summary.headline, { name: "Saline drops", detail: "given 2h 0m ago", tone: "last" });
});

test("nothing logged and nothing scheduled gives no headline", () => {
  assert.equal(medicationSummary([med({ asNeeded: true, latestDose: null })], now).headline, null);
  assert.equal(medicationSummary([], now).headline, null);
});
