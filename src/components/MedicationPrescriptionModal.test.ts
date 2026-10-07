import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import MedicationPrescriptionModal, {
  buildMedicationPrescriptionAddPayload,
  hasUnsavedMedicationPrescription,
  prepareMedicationPrescriptionDraft,
} from "./MedicationPrescriptionModal";

const props = {
  babyId: "baby-1",
  episodeId: "episode-1",
  suggestions: ["Paracetamol"],
  isStale: false,
  onClose: () => undefined,
  onRefresh: async () => undefined,
};

test("add-prescription modal is an accessible, exclusive medication entry form", () => {
  const html = renderToStaticMarkup(createElement(MedicationPrescriptionModal, props));
  assert.match(html, /<dialog[^>]+data-medication-entry-form="add"[^>]+aria-labelledby="medication-prescription-title"/);
  assert.match(html, /aria-label="Close medication prescription"/);
  assert.match(html, /Medication name/);
  assert.match(html, /Prescribed dose/);
  assert.doesNotMatch(html, /Amount given/);
});

test("stale add-prescription modal preserves fields while disabling save", () => {
  const html = renderToStaticMarkup(createElement(MedicationPrescriptionModal, {
    ...props,
    isStale: true,
    initialDrafts: [{ name: "Paracetamol", doseText: "3.5 ml", asNeeded: true, minIntervalHours: "4", maxIntervalHours: "6" }],
  }));
  assert.match(html, /value="Paracetamol"/);
  assert.match(html, /your entries are preserved/);
  assert.match(html, /disabled=""[^>]*>Save medication/);
});

test("dirty prescription detection protects every editable field", () => {
  const empty = { name: "", doseText: "", asNeeded: true, minIntervalHours: "", maxIntervalHours: "" };
  assert.equal(hasUnsavedMedicationPrescription([empty]), false);
  assert.equal(hasUnsavedMedicationPrescription([{ ...empty, doseText: " 3.5 ml " }]), true);
  assert.equal(hasUnsavedMedicationPrescription([{ ...empty, asNeeded: false }]), true);
});

test("prescription retries retain a cryptographic request identity across handoff", () => {
  const initial = prepareMedicationPrescriptionDraft({
    name: "Paracetamol",
    doseText: "3.5 ml",
    asNeeded: true,
    minIntervalHours: "4",
    maxIntervalHours: "6",
  });
  assert.match(initial.requestId, /^[0-9a-f-]{36}$/i);

  const handedOff = prepareMedicationPrescriptionDraft(initial);
  assert.equal(handedOff.requestId, initial.requestId);
  assert.equal(handedOff.key, initial.requestId);
  assert.deepEqual(buildMedicationPrescriptionAddPayload({
    babyId: "baby-1",
    episodeId: "episode-1",
    draft: handedOff,
  }), {
    action: "addMedication",
    babyId: "baby-1",
    episodeId: "episode-1",
    requestId: initial.requestId,
    name: "Paracetamol",
    doseText: "3.5 ml",
    asNeeded: true,
    minIntervalHours: 4,
    maxIntervalHours: 6,
  });
});
