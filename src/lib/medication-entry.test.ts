import assert from "node:assert/strict";
import test from "node:test";
import { entryForActiveEpisode, medicationAddEntry, medicationLogEntry } from "./medication-entry";

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
