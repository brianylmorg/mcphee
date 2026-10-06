import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import SickModePanel, { buildMedicationUpdatePayload, isSickModeConflict } from "./SickModePanel";
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

test("schema-not-ready response keeps sick mode compact and disabled", () => {
  const response = activeResponse();
  response.schemaReady = false;
  const html = renderToStaticMarkup(createElement(SickModePanel, {
    babyId: "baby-1",
    data: response,
    onRefresh: () => undefined,
  }));
  assert.match(html, /Sick mode unavailable/);
  assert.match(html, /Database setup is required/);
  assert.match(html, /disabled=""/);
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

test("isSickModeConflict only matches a 409 error carrying the expected code", () => {
  assert.equal(isSickModeConflict(Object.assign(new Error("stale"), { status: 409, code: "STALE_DOSE" }), "STALE_DOSE"), true);
  assert.equal(isSickModeConflict(Object.assign(new Error("stale"), { status: 409, code: "STALE_MEDICATION" }), "STALE_DOSE"), false);
  assert.equal(isSickModeConflict(Object.assign(new Error("server"), { status: 500, code: "STALE_DOSE" }), "STALE_DOSE"), false);
  assert.equal(isSickModeConflict(Object.assign(new Error("transport"), {}), "STALE_DOSE"), false);
  assert.equal(isSickModeConflict(null, "STALE_DOSE"), false);
  assert.equal(isSickModeConflict(undefined, "STALE_DOSE"), false);
  assert.equal(isSickModeConflict("STALE_DOSE", "STALE_DOSE"), false);
});
