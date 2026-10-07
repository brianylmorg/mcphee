import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import MedicationLogModal, { buildLogDosePayload, initialDoseTime } from "./MedicationLogModal";
import { parseSgtDateTime, sgtDateTimeInput } from "@/lib/sick-mode-client";
import type { SickMedication } from "@/lib/sick-mode";

const medication: SickMedication = { id: "med-1", episodeId: "episode-1", name: "Medication A", doseText: "Entered prescription", asNeeded: true, minIntervalHours: 4, maxIntervalHours: 6, createdAt: 1, createdBy: null, revision: 1, latestDose: null, doses: [] };
const props = { babyId: "baby-1", episodeId: "episode-1", episodeStartedAt: Date.now() - 60_000, medications: [medication], isStale: false, onClose: () => undefined, onRefresh: async () => undefined };

test("dose modal provides medication selection, explicit actual amount and Singapore time", () => {
  const html = renderToStaticMarkup(createElement(MedicationLogModal, props));
  assert.match(html, /<dialog[^>]+aria-labelledby="medication-log-title"/);
  assert.match(html, /Choose medication/);
  assert.match(html, /Medication A · As needed/);
  assert.match(html, /Amount given/);
  assert.match(html, /Time given \(Singapore\)/);
  assert.match(html, /does not calculate or recommend a dose/);
  assert.doesNotMatch(html, /value="Entered prescription"/);
  assert.match(html, /disabled=""[^>]*>Save dose/);
});

test("individual medication shortcut preselects without pre-filling an actual dose", () => {
  const html = renderToStaticMarkup(createElement(MedicationLogModal, { ...props, initialMedicationId: "med-1" }));
  assert.match(html, /value="med-1" selected=""/);
  assert.match(html, /Entered prescription/);
  assert.match(html, /No doses logged/);
  assert.doesNotMatch(html, /value="Entered prescription"/);
});

test("empty medications and stale mode cannot save a dose", () => {
  const empty = renderToStaticMarkup(createElement(MedicationLogModal, { ...props, medications: [] }));
  assert.match(empty, /Add a medication in Health check-in first/);
  assert.match(empty, /disabled=""[^>]*>Save dose/);
  const stale = renderToStaticMarkup(createElement(MedicationLogModal, { ...props, isStale: true }));
  assert.match(stale, /Logging is paused/);
  assert.match(stale, /disabled=""[^>]*>Save dose/);
});

test("dose payload retains the captured latest-history id and retry request id", () => {
  const draft = { babyId: "baby-1", episodeId: "episode-1", medicationId: "med-1", givenAt: 1234, doseText: " 2.5 ml ", requestId: "retry-id", expectedLatestDoseId: "old-dose" };
  assert.deepEqual(buildLogDosePayload(draft), { ...draft, action: "logDose", doseText: "2.5 ml" });
  assert.equal(buildLogDosePayload({ ...draft, expectedLatestDoseId: null }).expectedLatestDoseId, null);
});

test("Singapore inputs preserve second precision and new-episode dose times", () => {
  const startedAt = Date.parse("2026-10-07T10:00:30.500+08:00");
  const now = startedAt + 3_000;
  const time = initialDoseTime(startedAt, now);
  assert.equal(time, "2026-10-07T10:00:33");
  assert.ok(parseSgtDateTime(time)! >= startedAt);
  assert.ok(parseSgtDateTime(time)! <= now);
  assert.equal(parseSgtDateTime("2026-10-07T10:00"), Date.parse("2026-10-07T10:00:00+08:00"));
  assert.equal(sgtDateTimeInput(now), "2026-10-07T10:00");
  assert.equal(parseSgtDateTime(""), null);
});
