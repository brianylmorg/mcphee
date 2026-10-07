import assert from "node:assert/strict";
import test from "node:test";

import {
  historicalMedicationReference,
  parseHistoricalMedicationDetails,
} from "./historical-medication";

const valid = {
  medicationName: "Ibuprofen",
  doseText: "3 ml",
  notes: "Ibuprofen 3ml",
  historicalMedication: {
    version: 1,
    eventKind: "medication",
    sourceActivityId: "note-1",
    sourceStartedAt: 1_700_000_000_000,
    sourceDetailsSha256: "a".repeat(64),
    matchOrdinal: 0,
    importKey: "hm1:test",
    revision: 1,
  },
};

test("strictly parses a versioned standalone medication and builds its timeline reference", () => {
  assert.deepEqual(parseHistoricalMedicationDetails(JSON.stringify(valid)), valid);
  assert.deepEqual(historicalMedicationReference("activity-1", valid), {
    activityId: "activity-1",
    revision: 1,
    medicationName: "Ibuprofen",
    doseText: "3 ml",
    eventKind: "medication",
    originalNote: "Ibuprofen 3ml",
    sourceActivityId: "note-1",
    sourceStartedAt: 1_700_000_000_000,
    sourceDetailsSha256: "a".repeat(64),
    matchOrdinal: 0,
    importKey: "hm1:test",
  });
});

test("accepts a dose-free procedure but rejects medicine without a literal dose", () => {
  const procedure = {
    ...valid,
    medicationName: "Suction",
    doseText: "",
    historicalMedication: { ...valid.historicalMedication, eventKind: "procedure" },
  };
  assert.ok(parseHistoricalMedicationDetails(procedure));
  assert.equal(parseHistoricalMedicationDetails({ ...valid, doseText: "" }), null);
  assert.equal(parseHistoricalMedicationDetails({ ...procedure, doseText: "5 ml" }), null);
});

test("rejects unversioned, malformed, and soft-deleted records as editable timeline references", () => {
  assert.equal(parseHistoricalMedicationDetails({ medicationName: "Ibuprofen", doseText: "3 ml" }), null);
  assert.equal(parseHistoricalMedicationDetails("not json"), null);
  assert.equal(parseHistoricalMedicationDetails({
    ...valid,
    historicalMedication: { ...valid.historicalMedication, sourceDetailsSha256: "unsafe" },
  }), null);

  const deleted = {
    ...valid,
    historicalMedication: { ...valid.historicalMedication, revision: 2, deletedAt: 1_700_000_100_000 },
  };
  assert.ok(parseHistoricalMedicationDetails(deleted));
  assert.equal(historicalMedicationReference("activity-1", deleted), null);
});
