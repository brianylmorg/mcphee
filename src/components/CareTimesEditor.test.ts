import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { ChildcareSessionSummary } from "@/lib/childcare-mode-contract";

import CareTimesEditor, { validateCareEnd, validateCareTimes } from "./CareTimesEditor";

// 2026-10-21T00:30:00Z is 08:30 on 21 Oct 2026 in Singapore.
const CHECKED_IN_AT = Date.parse("2026-10-21T00:30:00Z");
const CHECKED_OUT_AT = Date.parse("2026-10-21T09:15:00Z"); // 17:15 SGT
const NOW = Date.parse("2026-10-21T12:00:00Z"); // 20:00 SGT

const session: ChildcareSessionSummary & { checkedOutAt: number } = {
  id: "session-fixture",
  babyId: "baby-fixture",
  checkedInAt: CHECKED_IN_AT,
  checkedOutAt: CHECKED_OUT_AT,
  pendingImport: true,
  importBatchId: null,
  importCompletedAt: null,
  removedAt: null,
  reviewedCareWindow: null,
};

test("a corrected check-out lands on the check-in day in Singapore time", () => {
  assert.deepEqual(validateCareEnd(CHECKED_IN_AT, "17:45", NOW), {
    ok: true,
    checkedOutAt: Date.parse("2026-10-21T09:45:00Z"),
  });
});

test("check-out must be after check-in, not in the future, and filled in", () => {
  assert.deepEqual(validateCareEnd(CHECKED_IN_AT, "08:30", NOW), { ok: false, message: "Check-out must be after check-in (08:30)." });
  assert.deepEqual(validateCareEnd(CHECKED_IN_AT, "21:00", NOW), { ok: false, message: "Check-out can't be later than now." });
  assert.deepEqual(validateCareEnd(CHECKED_IN_AT, "", NOW), { ok: false, message: "Enter the check-out time." });
});

test("corrected check-in and check-out both land on the stay's day", () => {
  assert.deepEqual(validateCareTimes(CHECKED_IN_AT, "08:05", "17:45", NOW), {
    ok: true,
    checkedInAt: Date.parse("2026-10-21T00:05:00Z"),
    checkedOutAt: Date.parse("2026-10-21T09:45:00Z"),
  });
  assert.deepEqual(validateCareTimes(CHECKED_IN_AT, "18:00", "17:45", NOW), { ok: false, message: "Check-out must be after check-in (18:00)." });
  assert.deepEqual(validateCareTimes(CHECKED_IN_AT, "", "17:45", NOW), { ok: false, message: "Enter the check-in time." });
});

test("shows the recorded check-in and check-out with an edit button", () => {
  const html = renderToStaticMarkup(createElement(CareTimesEditor, { session, onSave: async () => ({ session }) }));
  assert.match(html, /Care start <span[^>]*>08:30<\/span> · From check-in/);
  assert.match(html, /Care end <span[^>]*>17:15<\/span> · From check-out/);
  assert.match(html, /aria-label="Edit check-in and check-out times"/);
  assert.doesNotMatch(html, /disabled=""/);
});

test("explains why editing is unavailable", () => {
  const html = renderToStaticMarkup(createElement(CareTimesEditor, {
    session,
    disabledReason: "Save your review changes first, then you can edit the times.",
    onSave: async () => ({ session }),
  }));
  assert.match(html, /disabled=""/);
  assert.match(html, /Save your review changes first/);
});
