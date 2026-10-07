import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import SickModePanel, { buildMedicationUpdatePayload, buildOnboardingMedicationAddPayload, buildUpdateStartPayload, isSickModeConflict } from "./SickModePanel";
import type { SickMedication, SickModeResponse } from "@/lib/sick-mode";

const NOW = Date.now();

function medication(index: number, overrides: Partial<SickMedication> = {}): SickMedication {
  return {
    id: `med-${index}`,
    episodeId: "episode-1",
    name: `Medication ${index}`,
    doseText: "3.5ml",
    asNeeded: true,
    minIntervalHours: 4,
    maxIntervalHours: 6,
    createdAt: NOW - 10_000,
    createdBy: "Caregiver",
    revision: 1,
    latestDose: null,
    doses: [],
    ...overrides,
  };
}

function activeResponse(): SickModeResponse {
  return {
    schemaReady: true,
    asOfTimestamp: NOW,
    activeEpisode: {
      id: "episode-1",
      babyId: "baby-1",
      startedAt: NOW - 3 * 60 * 60 * 1000,
      endedAt: null,
      baselineDailyMl: 800,
      baselineKind: "calculated",
      baselineAvailableDayCount: 7,
      baselineSourceDays: [],
      createdAt: NOW,
      createdBy: "Caregiver",
      endedBy: null,
    },
    episodes: [],
    baselinePreview: null,
    medicationSuggestions: [],
    medications: [
      medication(1, {
        name: "A very long prescribed medication name that must remain visible",
        latestDose: {
          id: "dose-1",
          medicationId: "med-1",
          givenAt: NOW - 2 * 60 * 60 * 1000,
          doseText: "3.5ml",
          givenBy: "Caregiver",
          createdAt: NOW,
          updatedAt: NOW,
          revision: 1,
        },
      }),
      medication(2),
      medication(3, { asNeeded: false }),
      medication(4),
    ],
    archivedEpisode: null,
    archivedMedications: [],
    summary: {
      date: "2026-10-06",
      todayConsumedMl: 240,
      todayBreastmilkMl: 180,
      todayFormulaMl: 60,
      todayFeedDataAvailable: true,
      expectedDailyMl: 800,
      thresholdMl: 400,
      latestFeeds: [],
      lastCompletedDayConcern: null,
      peeUnitsToday: 4,
      wetDiaperCountToday: 2,
      lastWetAt: NOW - 60 * 60 * 1000,
      latestDiapers: [],
      latestTemperature: {
        id: "temp-1",
        measuredAt: NOW - 2 * 60 * 60 * 1000,
        celsius: 38.1,
        method: "ear",
      },
    },
  };
}

test("active sick mode renders every medication as a compact row", () => {
  const html = renderToStaticMarkup(createElement(SickModePanel, {
    babyId: "baby-1",
    data: activeResponse(),
    onRefresh: () => undefined,
  }));

  assert.match(html, /A very long prescribed medication name that must remain visible/);
  assert.match(html, /Medication 2/);
  assert.match(html, /Medication 3/);
  assert.match(html, /Medication 4/);
  assert.match(html, /As needed/);
  assert.match(html, /Last given/);
  assert.match(html, /No doses logged/);
  assert.equal((html.match(/class="medication-row-control /g) ?? []).length, 8);
});

test("temperature absence and overdue states are explicit", () => {
  const overdueHtml = renderToStaticMarkup(createElement(SickModePanel, {
    babyId: "baby-1",
    data: activeResponse(),
    onRefresh: () => undefined,
  }));
  assert.match(overdueHtml, /Overdue/);
  assert.match(overdueHtml, /text-danger/);

  const noTemperature = activeResponse();
  if (noTemperature.summary) noTemperature.summary.latestTemperature = null;
  const emptyHtml = renderToStaticMarkup(createElement(SickModePanel, {
    babyId: "baby-1",
    data: noTemperature,
    onRefresh: () => undefined,
  }));
  assert.match(emptyHtml, /No temperature recorded/);
});

test("compact health overview retains readings, all three diapers, all medications and intake warnings", () => {
  const data = activeResponse();
  assert.ok(data.summary);
  data.summary.latestDiapers = [1, 2, 3].map(index => ({ id: `diaper-${index}`, startedAt: NOW - index * 60 * 60 * 1000, peeUnits: index, isWet: true, poop: "small" }));
  data.summary.lastCompletedDayConcern = { date: "2026-10-05", totalMl: 300, thresholdMl: 400 };
  const html = renderToStaticMarkup(createElement(SickModePanel, { babyId: "baby-1", data, onRefresh: () => undefined, onLogActivity: () => undefined, onLogMedication: () => undefined }));
  assert.match(html, /health-readings.*grid-cols-2/);
  assert.match(html, />38.1 °C/);
  assert.match(html, /Last measured/);
  assert.match(html, /Overdue/);
  assert.match(html, /ear/);
  assert.match(html, /4 units/);
  assert.match(html, /2 wet diapers/);
  assert.equal((html.match(/data-diaper-row=/g) ?? []).length, 3);
  assert.equal((html.match(/data-medication-row=/g) ?? []).length, 4);
  assert.match(html, /Poo small/);
  assert.equal((html.match(/aria-hidden="true">· <\/span>/g) ?? []).length, 3);
  assert.match(html, /health-log-action[^"<>]*"[^>]*>Latest diapers<\/button>/);
  assert.match(html, /medication-dose-elapsed/);
  assert.match(html, /below the episode’s 400 ml 50% full-day intake threshold/);
  assert.doesNotMatch(html, /Sick mode active/);
});

test("schema-not-ready response keeps sick mode compact and disabled", () => {
  const response = activeResponse();
  response.schemaReady = false;
  const html = renderToStaticMarkup(createElement(SickModePanel, {
    babyId: "baby-1",
    data: response,
    display: "controls",
    onRefresh: () => undefined,
  }));
  assert.match(html, /Sick mode unavailable/);
  assert.match(html, /Database setup is required/);
  assert.match(html, /disabled=""/);
});

test("inactive sick mode lives in baby settings, not a dashboard start card", () => {
  const data = activeResponse();
  data.activeEpisode = null;
  data.summary = null;
  const dashboard = renderToStaticMarkup(createElement(SickModePanel, { babyId: "baby-1", data, onRefresh: () => undefined }));
  assert.equal(dashboard, "");
  const controls = renderToStaticMarkup(createElement(SickModePanel, { babyId: "baby-1", data, display: "controls", onRefresh: () => undefined }));
  assert.match(controls, /Track fever, medication, feeds and pee/);
  assert.match(controls, />Start<\/button>/);
});

test("active episode lifecycle is in settings while health and medication editing stay on dashboard", () => {
  const data = activeResponse();
  const controls = renderToStaticMarkup(createElement(SickModePanel, { babyId: "baby-1", data, display: "controls", onRefresh: () => undefined }));
  assert.match(controls, /End mode/);
  assert.match(controls, /until you end this episode/);
  assert.doesNotMatch(controls, /Health check-in/);
  const dashboard = renderToStaticMarkup(createElement(SickModePanel, { babyId: "baby-1", data, onRefresh: () => undefined }));
  assert.match(dashboard, /Health check-in/);
  assert.doesNotMatch(dashboard, />End mode<\/button>/);
  assert.equal((dashboard.match(/title="Edit medication"/g) ?? []).length, 4);
  assert.match(dashboard, /aria-label="Edit medication Medication 2"/);
});

test("medication edits carry the captured optimistic-concurrency revision", () => {
  assert.deepEqual(buildMedicationUpdatePayload({
    babyId: "baby-1",
    episodeId: "episode-1",
    medicationId: "med-1",
    expectedRevision: 7,
    draft: {
      key: "med-1",
      name: " Paracetamol ",
      doseText: " 3.5ml ",
      asNeeded: true,
      minIntervalHours: "4",
      maxIntervalHours: "6",
    },
  }), {
    action: "updateMedication",
    babyId: "baby-1",
    episodeId: "episode-1",
    medicationId: "med-1",
    expectedRevision: 7,
    name: "Paracetamol",
    doseText: "3.5ml",
    asNeeded: true,
    minIntervalHours: 4,
    maxIntervalHours: 6,
  });
});

test("onboarding medication retries preserve the handed-off request identity", () => {
  assert.deepEqual(buildOnboardingMedicationAddPayload({
    babyId: "baby-1",
    episodeId: "episode-1",
    medication: {
      requestId: "stable-onboarding-attempt",
      name: " Paracetamol ",
      doseText: " 3.5ml ",
      asNeeded: true,
      minIntervalHours: "4",
      maxIntervalHours: "6",
    },
  }), {
    action: "addMedication",
    babyId: "baby-1",
    episodeId: "episode-1",
    requestId: "stable-onboarding-attempt",
    name: "Paracetamol",
    doseText: "3.5ml",
    asNeeded: true,
    minIntervalHours: 4,
    maxIntervalHours: 6,
  });
});

test("isSickModeConflict only matches a 409 error carrying the expected code", () => {
  assert.equal(isSickModeConflict(Object.assign(new Error("stale"), { status: 409, code: "STALE_DOSE" }), "STALE_DOSE"), true);
  assert.equal(isSickModeConflict(Object.assign(new Error("stale"), { status: 409, code: "STALE_MEDICATION" }), "STALE_DOSE"), false);
  assert.equal(isSickModeConflict(Object.assign(new Error("server"), { status: 500, code: "STALE_DOSE" }), "STALE_DOSE"), false);
  assert.equal(isSickModeConflict(Object.assign(new Error("transport"), {}), "STALE_DOSE"), false);
  assert.equal(isSickModeConflict(null, "STALE_DOSE"), false);
  assert.equal(isSickModeConflict(undefined, "STALE_DOSE"), false);
  assert.equal(isSickModeConflict("STALE_DOSE", "STALE_DOSE"), false);
});

test("health-check labels and medication names expose distinct logging shortcuts", () => {
  const html = renderToStaticMarkup(createElement(SickModePanel, { babyId: "baby-1", data: activeResponse(), onRefresh: () => undefined, onLogActivity: () => undefined, onLogMedication: () => undefined, onAddMedication: () => undefined }));
  for (const label of ["Log temperature", "Log diaper", "Log a new diaper", "Log medication", "Log Medication 2", "Edit medication Medication 2", "Dose history for Medication 2", "Add medication prescription"]) assert.ok(html.includes(`aria-label="${label}"`));
  assert.match(html, /aria-expanded="false" aria-controls="medication-history-med-2"/);
  assert.doesNotMatch(html, /Time Medication 2 was given|Dose of Medication 2 given|>Actual dose</);
});

test("health-check logging shortcuts pause while sick-mode data is stale", () => {
  const html = renderToStaticMarkup(createElement(SickModePanel, { babyId: "baby-1", data: activeResponse(), isStale: true, onRefresh: () => undefined, onLogActivity: () => undefined, onLogMedication: () => undefined }));
  for (const label of ["Log temperature", "Log diaper", "Log medication", "Log Medication 2"]) assert.ok(html.includes(`aria-label="${label}" disabled=""`));
});

test("update-start payload keeps the frozen baseline unless the Singapore day changes", () => {
  const expected = Date.parse("2026-10-04T10:00:00+08:00");
  const base = { babyId: "baby-1", episodeId: "episode-1", expectedStartedAt: expected };

  // Same Singapore day: no baseline fields travel, so the frozen snapshot is preserved.
  assert.deepEqual(buildUpdateStartPayload({
    ...base,
    startedAt: Date.parse("2026-10-04T06:00:00+08:00"),
    baselineKind: "calculated",
    confirmIncomplete: true,
  }), {
    action: "updateStart",
    ...base,
    startedAt: Date.parse("2026-10-04T06:00:00+08:00"),
  });

  // Changed day with a calculated baseline carries the incomplete confirmation.
  assert.deepEqual(buildUpdateStartPayload({
    ...base,
    startedAt: Date.parse("2026-10-05T10:00:00+08:00"),
    baselineKind: "calculated",
    confirmIncomplete: true,
  }), {
    action: "updateStart",
    ...base,
    startedAt: Date.parse("2026-10-05T10:00:00+08:00"),
    confirmIncomplete: true,
  });

  // A manual fallback is sent instead of the confirmation.
  assert.deepEqual(buildUpdateStartPayload({
    ...base,
    startedAt: Date.parse("2026-10-05T10:00:00+08:00"),
    baselineKind: "calculated",
    manualBaseline: " 900 ",
  }), {
    action: "updateStart",
    ...base,
    startedAt: Date.parse("2026-10-05T10:00:00+08:00"),
    manualBaselineMl: 900,
  });

  // An originally manual baseline travels with no baseline fields at all.
  assert.deepEqual(buildUpdateStartPayload({
    ...base,
    startedAt: Date.parse("2026-10-05T10:00:00+08:00"),
    baselineKind: "manual",
  }), {
    action: "updateStart",
    ...base,
    startedAt: Date.parse("2026-10-05T10:00:00+08:00"),
  });
});

test("active settings expose an inline edit sick-mode start time control while the dashboard does not", () => {
  const controls = renderToStaticMarkup(createElement(SickModePanel, { babyId: "baby-1", data: activeResponse(), display: "controls", onRefresh: () => undefined }));
  assert.match(controls, /aria-label="Edit sick-mode start time"/);
  assert.match(controls, /Since /);
  assert.match(controls, /End mode/);

  const dashboard = renderToStaticMarkup(createElement(SickModePanel, { babyId: "baby-1", data: activeResponse(), onRefresh: () => undefined }));
  assert.doesNotMatch(dashboard, /Edit sick-mode start time/);
});
