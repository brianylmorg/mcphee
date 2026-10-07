import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import MedicationDoseEditModal from "./MedicationDoseEditModal";
import type { MedicationDoseReference } from "@/lib/activity-timeline";
import type { HistoricalMedicationReference } from "@/lib/historical-medication";

const onClose = () => undefined;
const onRefresh = async () => undefined;

function canonicalDose(overrides: Partial<MedicationDoseReference> = {}): MedicationDoseReference {
  const startedAt = Date.now() - 3_600_000;
  return {
    doseId: "dose-1",
    medicationId: "med-1",
    episodeId: "episode-1",
    revision: 7,
    medicationName: "Amoxicillin",
    doseText: "3.5 ml",
    episodeStartedAt: startedAt - 60_000,
    episodeEndedAt: null,
    ...overrides,
  };
}

function historicalReference(overrides: Partial<HistoricalMedicationReference> = {}): HistoricalMedicationReference {
  return {
    activityId: "act-1",
    revision: 3,
    medicationName: "Paracetamol",
    doseText: "2.5 ml",
    eventKind: "medication",
    originalNote: "Gave 2.5 ml from the old paper log.",
    sourceActivityId: "src-1",
    sourceStartedAt: Date.parse("2026-09-01T10:00:00+08:00"),
    sourceDetailsSha256: "a".repeat(64),
    matchOrdinal: 0,
    importKey: "import-1",
    ...overrides,
  };
}

test("canonical dose editing stays unchanged", () => {
  const activity = { id: "dose-1", type: "medication", started_at: Date.now() - 3_600_000, medicationDose: canonicalDose() };
  const html = renderToStaticMarkup(createElement(MedicationDoseEditModal, { babyId: "baby-1", activity, onClose, onRefresh }));

  assert.match(html, /data-medication-entry-form="edit"/);
  assert.match(html, />Edit medication dose</);
  assert.match(html, /Amount given/);
  assert.match(html, /Time given \(Singapore\)/);
  assert.match(html, /does not calculate or recommend a dose/);
  assert.match(html, /Save dose/);
  // The canonical path never shows the historical provenance panel.
  assert.doesNotMatch(html, /Imported historical record/);
  assert.doesNotMatch(html, /Save activity/);
});

test("canonical dose still enforces the sick-mode episode window", () => {
  const startedAt = Date.now() - 3_600_000;
  const activity = {
    id: "dose-1",
    type: "medication",
    started_at: startedAt,
    medicationDose: canonicalDose({ episodeStartedAt: Date.now() + 60_000 }),
  };
  const html = renderToStaticMarkup(createElement(MedicationDoseEditModal, { babyId: "baby-1", activity, onClose, onRefresh }));

  assert.match(html, /Choose a time within this sick-mode episode, not in the future\./);
  assert.match(html, /disabled=""[^>]*>Save dose/);
});

test("historical medication edits the dose without an episode warning", () => {
  const reference = historicalReference();
  const activity = { id: "act-1", type: "medication", started_at: reference.sourceStartedAt, historicalMedication: reference };
  const html = renderToStaticMarkup(createElement(MedicationDoseEditModal, { babyId: "baby-1", activity, onClose, onRefresh }));

  assert.match(html, />Edit historical activity</);
  assert.match(html, /Amount given/);
  assert.match(html, /value="2.5 ml"/);
  assert.match(html, /Time given \(Singapore\)/);
  assert.match(html, /Save activity/);
  // No sick-mode episode bounds apply to imported records.
  assert.doesNotMatch(html, /sick-mode episode/);
  // Quiet import provenance with the untouched source note.
  assert.match(html, /Imported historical record/);
  assert.match(html, /Original note: Gave 2\.5 ml from the old paper log\./);
});

test("historical procedure has no amount input but keeps time and provenance", () => {
  const reference = historicalReference({
    activityId: "act-2",
    medicationName: "Suction",
    doseText: "",
    eventKind: "procedure",
    originalNote: "Suctioned nose before bed.",
  });
  const activity = { id: "act-2", type: "medication", started_at: reference.sourceStartedAt, historicalMedication: reference };
  const html = renderToStaticMarkup(createElement(MedicationDoseEditModal, { babyId: "baby-1", activity, onClose, onRefresh }));

  assert.match(html, />Edit historical activity</);
  assert.match(html, />Suction</);
  assert.doesNotMatch(html, /Amount given/);
  assert.match(html, /Time given \(Singapore\)/);
  assert.match(html, /Save activity/);
  assert.match(html, /Imported historical record/);
  assert.match(html, /Original note: Suctioned nose before bed\./);
});
