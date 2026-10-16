import assert from "node:assert/strict";
import test from "node:test";

import type { ChildcareSessionSummary } from "./childcare-mode-contract";
import { resolveCaretakerCareWindow } from "./caretaker-care-window";

test("linked care window preserves exact session seconds and milliseconds", () => {
  const session: ChildcareSessionSummary = {
    id: "session-fixture",
    babyId: "baby-fixture",
    checkedInAt: Date.parse("2026-10-16T01:15:42.123Z"),
    checkedOutAt: Date.parse("2026-10-16T09:30:58.789Z"),
    pendingImport: true,
    importBatchId: "batch-fixture",
    importCompletedAt: null,
    removedAt: null,
  };

  const window = resolveCaretakerCareWindow(
    session,
    Date.parse("2026-10-16T01:15:00.000Z"),
    Date.parse("2026-10-16T09:30:00.000Z"),
  );

  assert.deepEqual(window, {
    startedAt: session.checkedInAt,
    endedAt: session.checkedOutAt,
    linked: true,
  });
});

test("unlinked care window uses the reviewed times", () => {
  const startedAt = Date.parse("2026-10-16T01:15:00.000Z");
  const endedAt = Date.parse("2026-10-16T09:30:00.000Z");

  assert.deepEqual(resolveCaretakerCareWindow(null, startedAt, endedAt), {
    startedAt,
    endedAt,
    linked: false,
  });
});
