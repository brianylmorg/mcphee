import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { ChildcareSessionSummary } from "@/lib/childcare-mode-contract";

import ChildcareModePanel, { type ChildcareModePanelProps } from "./ChildcareModePanel";

// 2026-10-16T00:00:00Z is 08:00 on 16 Oct 2026 in Singapore.
const CHECKED_IN_AT = Date.parse("2026-10-16T00:00:00Z");

function session(overrides: Partial<ChildcareSessionSummary> = {}): ChildcareSessionSummary {
  return {
    id: "session-fixture",
    babyId: "baby-fixture",
    checkedInAt: CHECKED_IN_AT,
    checkedOutAt: CHECKED_IN_AT + 8 * 60 * 60 * 1000,
    pendingImport: true,
    importBatchId: null,
    importCompletedAt: null,
    ...overrides,
  };
}

function render(props: Partial<ChildcareModePanelProps> = {}): string {
  return renderToStaticMarkup(
    createElement(ChildcareModePanel, {
      babyName: "Aria",
      activeSession: null,
      pendingSessions: [],
      busy: false,
      error: null,
      onCheckIn: () => {}, onCheckOut: () => {}, onEditCheckIn: async () => true, onImport: () => {},
      ...props,
    }),
  );
}

// Closed, pending, same-day window: 16 Oct 2026, 09:15 - 17:30 SGT.
const daytime = session({
  id: "session-daytime",
  checkedInAt: Date.parse("2026-10-16T01:15:00Z"),
  checkedOutAt: Date.parse("2026-10-16T09:30:00Z"),
});

// Closed, pending, crosses midnight: 23:40 SGT - 18 Oct 2026, 06:15 SGT.
const overnight = session({
  id: "session-overnight",
  checkedInAt: Date.parse("2026-10-17T15:40:00Z"),
  checkedOutAt: Date.parse("2026-10-17T22:15:00Z"),
});

test("idle panel shows the not-checked-in state and check in only", () => {
  const html = render();
  assert.match(html, /aria-label="Childcare"/);
  assert.match(html, />Childcare</);
  assert.ok(html.includes("Not checked in"));
  assert.match(html, /Check in</);
  assert.equal((html.match(/<button/g) ?? []).length, 1);
  assert.doesNotMatch(html, /Check out/);
  assert.doesNotMatch(html, /Care logs to import/);
});

test("active session shows the SGT check-in stamp, confirmation note and check out", () => {
  const html = render({ activeSession: session({ id: "session-active" }) });
  assert.ok(html.includes("Aria is in childcare"));
  assert.ok(html.includes("Checked in 16 Oct 2026 at 08:00 SGT"));
  assert.ok(html.includes("Adding an activity will ask for confirmation."));
  assert.match(html, /Check out</);
  assert.doesNotMatch(html, /Check in</);
});

test("import list keeps only unseen closed pending sessions and prints no raw ids", () => {
  const html = render({
    activeSession: session({ id: "session-active" }),
    pendingSessions: [
      daytime,
      { ...daytime, checkedInAt: Date.parse("2026-07-04T03:00:00Z") },
      overnight,
      session({ id: "session-done", checkedInAt: Date.parse("2026-09-01T01:00:00Z"), importCompletedAt: Date.parse("2026-09-02T00:00:00Z") }),
      session({ id: "session-flagged", checkedInAt: Date.parse("2026-08-01T01:00:00Z"), pendingImport: false }),
      session({ id: "session-open", checkedInAt: Date.parse("2026-06-01T01:00:00Z"), checkedOutAt: null }),
      session({ id: "session-active", checkedInAt: Date.parse("2026-05-01T01:00:00Z") }),
    ],
  });

  assert.match(html, /Care logs to import/);
  assert.equal((html.match(/<li /g) ?? []).length, 2);
  assert.equal((html.match(/Import screenshot/g) ?? []).length, 2);
  // Genuine rows keep their SGT dates; the overnight stay spells out the end date.
  assert.ok(html.includes("16 Oct 2026"));
  assert.ok(html.includes("09:15 - 17:30 SGT"));
  assert.ok(html.includes("23:40 - 18 Oct 2026, 06:15 SGT"));
  // Completed, unflagged, still-open, active and duplicate-id rows are dropped.
  assert.doesNotMatch(html, /(1 Sep|1 Aug|1 Jun|1 May|4 Jul) 2026/);
  assert.doesNotMatch(html, /session-[a-z-]+/);
});

test("busy disables every visible check-in and import control and shows the escaped error", () => {
  const html = render({ busy: true, error: "Couldn't check in <twice>", pendingSessions: [daytime, overnight] });

  const buttonTags = html.match(/<button[^>]*>/g) ?? [];
  assert.equal(buttonTags.length, 3);
  assert.equal(buttonTags.filter((tag) => tag.includes('disabled=""')).length, buttonTags.length);
  // The optional custom-time field is disabled alongside the buttons.
  const customTimeField = /<input[^>]*type="datetime-local"[^>]*>/.exec(html)?.[0] ?? "";
  assert.ok(customTimeField.includes('disabled=""'));
  assert.match(html, /Check in</);
  assert.match(html, /role="alert"/);
  assert.ok(html.includes("Couldn&#x27;t check in &lt;twice&gt;"));
});

test("custom time field is a labelled native datetime-local input in both states", () => {
  const idle = render();
  const active = render({ activeSession: session({ id: "session-active" }) });

  const idleField = /<input[^>]*type="datetime-local"[^>]*>/.exec(idle)?.[0] ?? "";
  const activeField = /<input[^>]*type="datetime-local"[^>]*>/.exec(active)?.[0] ?? "";
  assert.ok(idleField.length > 0);
  assert.ok(activeField.length > 0);

  const fieldId = / id="([^"]+)"/.exec(idleField)?.[1] ?? "";
  assert.ok(fieldId.length > 0);
  assert.ok(idle.includes(`<label for="${fieldId}"`));
  assert.ok(active.includes(`<label for="${fieldId}"`));
  assert.match(idle, /Check-in time \(Singapore\)/);
  assert.match(active, /Check-out time \(Singapore\)/);
});
