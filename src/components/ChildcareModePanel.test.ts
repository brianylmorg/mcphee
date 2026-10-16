import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { ChildcareSessionSummary } from "@/lib/childcare-mode-contract";

import ChildcareModePanel, {
  ChildcareTimesEditor,
  validateSessionTimes,
  type ChildcareModePanelProps,
} from "./ChildcareModePanel";

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
    removedAt: null,
    reviewedCareWindow: null,
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

// Closed and already imported: 10 Oct 2026, 09:00 - 17:00 SGT.
const imported = session({
  id: "session-imported",
  checkedInAt: Date.parse("2026-10-10T01:00:00Z"),
  checkedOutAt: Date.parse("2026-10-10T09:00:00Z"),
  pendingImport: false,
  importBatchId: "batch-fixture",
  importCompletedAt: Date.parse("2026-10-11T00:00:00Z"),
});

// Closed, never flagged for a screenshot import: 5 Oct 2026, 09:00 - 17:00 SGT.
const noImportNeeded = session({
  id: "session-plain",
  checkedInAt: Date.parse("2026-10-05T01:00:00Z"),
  checkedOutAt: Date.parse("2026-10-05T09:00:00Z"),
  pendingImport: false,
});

const historyCallbacks = {
  onEditSession: async () => true,
  onDismissImport: async () => true,
  onRemoveSession: async () => true,
};

test("idle state says 'Not in childcare' and offers a check in that records now", () => {
  const html = render();

  assert.match(html, /aria-label="Childcare"/);
  assert.match(html, />Childcare</);
  assert.ok(html.includes("Not in childcare"));
  assert.match(html, /Check in</);
  assert.doesNotMatch(html, /Check out/);
  assert.equal((html.match(/<button/g) ?? []).length, 1);
  // The custom-time details block is gone: no picker until a session exists.
  assert.doesNotMatch(
    html,
    /Set check-in time|Set check-out time|datetime-local|Previous sessions|Care logs to import/,
  );
});

test("active stay shows the SGT start stamp, latest editor wording and check out", () => {
  const html = render({ activeSession: session({ id: "session-active" }) });

  assert.ok(html.includes("Aria is in childcare"));
  assert.ok(html.includes("Checked in 16 Oct 2026 at 08:00 SGT"));
  assert.ok(html.includes("Adding an activity will ask for confirmation."));
  assert.match(html, /aria-label="Edit start time"/);
  assert.match(html, /Edit start time</);
  assert.match(html, /Check out</);
  assert.doesNotMatch(html, /Check in</);
  // The start-time editor stays closed until the caretaker asks for it.
  assert.match(html, /aria-expanded="false"/);
  assert.doesNotMatch(html, /datetime-local|Save start time/);
});

test("previous sessions merge history and pending, dedupe by id and read newest first", () => {
  const html = render({
    activeSession: session({ id: "session-active" }),
    pendingSessions: [daytime, overnight, { ...daytime }],
    historySessions: [
      daytime,
      imported,
      noImportNeeded,
      session({ id: "session-removed", removedAt: Date.parse("2026-11-02T00:00:00Z"), checkedInAt: Date.parse("2026-11-01T01:00:00Z"), checkedOutAt: Date.parse("2026-11-01T09:00:00Z") }),
      session({ id: "session-open", checkedInAt: Date.parse("2026-09-01T01:00:00Z"), checkedOutAt: null }),
      session({ id: "session-active", checkedInAt: Date.parse("2026-05-01T01:00:00Z") }),
    ],
  });

  // One combined list: no second "Care logs to import" section.
  assert.equal((html.match(/Previous sessions/g) ?? []).length, 1);
  assert.doesNotMatch(html, /Care logs to import/);
  // Four closed sessions: the duplicated id and the active stay collapse away.
  assert.equal((html.match(/<li /g) ?? []).length, 4);

  // Measured from the list heading: the active-stay stamp also prints that date.
  const listStart = html.indexOf("Previous sessions");
  assert.ok(listStart > -1);
  const positions = ["17 Oct 2026", "16 Oct 2026", "10 Oct 2026", "5 Oct 2026"].map((label) =>
    html.indexOf(label, listStart),
  );
  assert.ok(positions.every((position) => position > -1));
  assert.deepEqual([...positions].sort((first, second) => first - second), positions);

  // Genuine rows keep their SGT windows; an overnight stay spells out the end date.
  assert.ok(html.includes("09:15 - 17:30 SGT"));
  assert.ok(html.includes("23:40 - 18 Oct 2026, 06:15 SGT"));
  // Removed, still-open and active sessions never reach the list.
  assert.doesNotMatch(html, /(1 Nov|1 Sep|1 May) 2026/);
  assert.doesNotMatch(html, /session-[a-z-]+/);
});

test("every row carries its own import status", () => {
  const html = render({
    pendingSessions: [daytime],
    historySessions: [daytime, imported, noImportNeeded],
  });

  assert.equal((html.match(/>Imported</g) ?? []).length, 1);
  assert.equal((html.match(/>Screenshot pending</g) ?? []).length, 1);
  assert.equal((html.match(/>No import needed</g) ?? []).length, 1);
});

test("collapsed history rows show only the add-screenshot icon and the edit button", () => {
  const html = render({
    pendingSessions: [daytime],
    historySessions: [daytime, imported, noImportNeeded],
    ...historyCallbacks,
  });

  // Only the screenshot-pending row offers the add-screenshot icon.
  assert.equal((html.match(/aria-label="Import screenshot"/g) ?? []).length, 1);
  // Every closed row has one edit button; skip and remove stay inside it.
  assert.equal((html.match(/aria-label="Edit session"/g) ?? []).length, 3);
  assert.doesNotMatch(html, /Skip screenshot|Dismiss import|Remove session/);
  assert.equal((html.match(/>Screenshot pending</g) ?? []).length, 1);
});

test("history rows still render for SSR callers that omit the optional callbacks", () => {
  const html = render({ pendingSessions: [daytime], historySessions: [imported, noImportNeeded] });

  assert.ok(html.includes("16 Oct 2026"));
  assert.ok(html.includes("Import screenshot"));
  assert.doesNotMatch(html, /Edit session|Skip screenshot|Remove session/);
});

test("approved sleep window is never shown on history rows", () => {
  const sameAsAttendance = render({
    historySessions: [
      session({
        id: "session-reviewed-same",
        checkedInAt: Date.parse("2026-10-16T01:15:00Z"),
        checkedOutAt: Date.parse("2026-10-16T09:30:00Z"),
        reviewedCareWindow: {
          startedAt: Date.parse("2026-10-16T01:15:00Z"),
          endedAt: Date.parse("2026-10-16T09:30:00Z"),
        },
      }),
    ],
  });
  assert.doesNotMatch(sameAsAttendance, /Approved sleep/);

  const reviewedDifferently = render({
    historySessions: [
      session({
        id: "session-reviewed-different",
        checkedInAt: Date.parse("2026-10-16T01:15:00Z"),
        checkedOutAt: Date.parse("2026-10-16T09:30:00Z"),
        reviewedCareWindow: {
          startedAt: Date.parse("2026-10-16T05:00:00Z"),
          endedAt: Date.parse("2026-10-16T07:30:00Z"),
        },
      }),
    ],
  });
  assert.doesNotMatch(reviewedDifferently, /Approved sleep|13:00 - 15:30/);
});

test("busy disables every visible control and shows the escaped parent error", () => {
  const html = render({
    busy: true,
    error: "Couldn't check in <twice>",
    pendingSessions: [daytime],
    historySessions: [imported],
    ...historyCallbacks,
  });

  const buttonTags = html.match(/<button[^>]*>/g) ?? [];
  // Check in, plus the pending import shortcut and an edit button per listed row.
  assert.equal(buttonTags.length, 4);
  assert.equal(buttonTags.filter((tag) => tag.includes('disabled=""')).length, buttonTags.length);
  assert.match(html, /Check in</);
  assert.match(html, /role="alert"/);
  assert.ok(html.includes("Couldn&#x27;t check in &lt;twice&gt;"));
});

test("attendance validation keeps the window real, ordered and no later than now", () => {
  const now = Date.parse("2026-10-16T12:00:00Z"); // 20:00 SGT.
  const valid = validateSessionTimes("2026-10-16T09:15", "2026-10-16T17:30", now);
  assert.equal(valid.ok, true);
  if (valid.ok) {
    assert.equal(valid.startedAt, Date.parse("2026-10-16T09:15:00+08:00"));
    assert.equal(valid.endedAt, Date.parse("2026-10-16T17:30:00+08:00"));
  }

  const reversed = validateSessionTimes("2026-10-16T17:30", "2026-10-16T09:15", now);
  assert.equal(reversed.ok, false);
  if (!reversed.ok) assert.match(reversed.message, /after the start time/);

  const future = validateSessionTimes("2026-10-16T09:15", "2026-10-16T21:30", now);
  assert.equal(future.ok, false);
  if (!future.ok) assert.match(future.message, /not be later than now/);

  const impossibleDay = validateSessionTimes("2026-02-30T09:15", "2026-03-02T09:00", now);
  assert.equal(impossibleDay.ok, false);
  if (!impossibleDay.ok) assert.match(impossibleDay.message, /valid start time/);

  const missingEnd = validateSessionTimes("2026-10-16T09:15", "", now);
  assert.equal(missingEnd.ok, false);
  if (!missingEnd.ok) assert.match(missingEnd.message, /valid end time/);
});

test("attendance editor labels start and end and flags imported rows as attendance-only", () => {
  const html = renderToStaticMarkup(
    createElement(ChildcareTimesEditor, {
      isImported: true,
      startValue: "2026-10-16T09:15",
      endValue: "2026-10-16T17:30",
      maxValue: "2026-10-16T20:00",
      error: null,
      onStartChange: () => {},
      onEndChange: () => {},
      onSave: () => {},
      onCancel: () => {},
    }),
  );

  const fields = html.match(/<input[^>]*type="datetime-local"[^>]*>/g) ?? [];
  assert.equal(fields.length, 2);
  for (const field of fields) {
    const fieldId = / id="([^"]+)"/.exec(field)?.[1] ?? "";
    assert.ok(fieldId.length > 0);
    assert.ok(html.includes(`<label for="${fieldId}"`));
  }
  assert.match(html, /value="2026-10-16T09:15"/);
  assert.match(html, /value="2026-10-16T17:30"/);
  assert.match(html, /max="2026-10-16T20:00"/);
  assert.ok(html.includes("Start time (Singapore)"));
  assert.ok(html.includes("End time (Singapore)"));
  assert.ok(
    html.includes(
      "Changes check-in and check-out times only. Imported activities stay unchanged.",
    ),
  );
  assert.match(html, />Save times</);
  assert.match(html, />Cancel</);
  assert.doesNotMatch(html, /disabled=""/);
});

test("attendance editor keeps its failure message and locked state while saving", () => {
  const html = renderToStaticMarkup(
    createElement(ChildcareTimesEditor, {
      isImported: false,
      startValue: "",
      endValue: "",
      error: "Could not save the new times. Please try again.",
      disabled: true,
      onStartChange: () => {},
      onEndChange: () => {},
      onSave: () => {},
      onCancel: () => {},
    }),
  );

  assert.ok(html.includes("Updates the recorded care window for this session."));
  assert.ok(html.includes("Could not save the new times. Please try again."));
  assert.match(html, /role="alert"/);
  const buttonTags = html.match(/<button[^>]*>/g) ?? [];
  assert.equal(buttonTags.length, 2);
  assert.equal(buttonTags.filter((tag) => tag.includes('disabled=""')).length, 2);
});
