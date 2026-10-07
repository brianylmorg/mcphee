import assert from "node:assert/strict";
import test from "node:test";
import {
  entryForActiveEpisode,
  medicationAddEntry,
  medicationLogEntry,
  medicationScheduleValidationError,
} from "./medication-entry";

test("medication entry is a single discriminated owner when flows switch", () => {
  let entry = medicationAddEntry("episode-1");
  assert.equal(entry.kind, "add");

  entry = medicationLogEntry("episode-1", "med-1");
  assert.deepEqual(entry, { kind: "log", episodeId: "episode-1", medicationId: "med-1" });

  entry = medicationAddEntry("episode-1", [{
    requestId: "stable-onboarding-attempt",
    name: "Paracetamol",
    doseText: "3.5 ml",
    asNeeded: true,
    minIntervalHours: "4",
    maxIntervalHours: "6",
  }]);
  assert.equal(entry.kind, "add");
  assert.equal(entry.initialDrafts?.length, 1);
  assert.equal(entry.initialDrafts?.[0].requestId, "stable-onboarding-attempt");
});

test("medication entry survives refreshes for its episode and closes on episode change", () => {
  const entry = medicationLogEntry("episode-1");
  assert.equal(entryForActiveEpisode(entry, "episode-1"), entry);
  assert.equal(entryForActiveEpisode(entry, "episode-2"), null);
  assert.equal(entryForActiveEpisode(entry, undefined), null);
});

test("scheduled medication drafts require a valid positive interval", () => {
  assert.equal(medicationScheduleValidationError({
    asNeeded: false,
    minIntervalHours: "",
    maxIntervalHours: "",
  }), "Enter how often this medication should be given.");
  assert.equal(medicationScheduleValidationError({
    asNeeded: false,
    minIntervalHours: "6",
    maxIntervalHours: "",
  }), null);
  assert.equal(medicationScheduleValidationError({
    asNeeded: false,
    minIntervalHours: String(1 / 60),
    maxIntervalHours: "168",
  }), null);
  assert.match(medicationScheduleValidationError({
    asNeeded: false,
    minIntervalHours: "0",
    maxIntervalHours: "",
  }) ?? "", /must be between/);
  assert.match(medicationScheduleValidationError({
    asNeeded: false,
    minIntervalHours: "Infinity",
    maxIntervalHours: "",
  }) ?? "", /must be between/);
  assert.match(medicationScheduleValidationError({
    asNeeded: false,
    minIntervalHours: "168.01",
    maxIntervalHours: "",
  }) ?? "", /must be between/);
});

test("as-needed medication drafts allow blank or valid optional intervals", () => {
  assert.equal(medicationScheduleValidationError({
    asNeeded: true,
    minIntervalHours: "",
    maxIntervalHours: "",
  }), null);
  assert.equal(medicationScheduleValidationError({
    asNeeded: true,
    minIntervalHours: "",
    maxIntervalHours: "6",
  }), null);
  assert.match(medicationScheduleValidationError({
    asNeeded: true,
    minIntervalHours: "6",
    maxIntervalHours: "4",
  }) ?? "", /cannot be earlier/);
  assert.match(medicationScheduleValidationError({
    asNeeded: true,
    minIntervalHours: "-1",
    maxIntervalHours: "",
  }) ?? "", /must be between/);
});
