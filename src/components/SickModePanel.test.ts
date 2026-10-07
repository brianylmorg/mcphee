import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import SickModePanel, { buildMedicationUpdatePayload, buildOnboardingMedicationAddPayload, buildResumePayload, buildUpdateStartPayload, evaluateResumeEligibility, isSickModeConflict, selectResumeCapture } from "./SickModePanel";
import type { SickEpisode, SickMedication, SickModeResponse } from "@/lib/sick-mode";
import { formatDate, formatTime } from "@/lib/utils";

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
  // Medication hierarchy is exposed through semantic hooks, not CSS chains.
  assert.equal((html.match(/class="medication-name /g) ?? []).length, 4);
  assert.equal((html.match(/medication-prescription/g) ?? []).length, 4);
});

test("recorded dose history keeps its detail in lean semantic rows", () => {
  const givenAt = NOW - 90 * 60 * 1000;
  const dose = {
    id: "dose-1",
    medicationId: "med-1",
    givenAt,
    doseText: "3.5ml",
    givenBy: "Caregiver",
    createdAt: NOW,
    updatedAt: NOW,
    revision: 1,
  };
  const data = activeResponse();
  data.medications = [medication(1, { name: "Paracetamol", latestDose: dose, doses: [dose] })];
  const html = renderToStaticMarkup(createElement(SickModePanel, {
    babyId: "baby-1",
    data,
    onRefresh: () => undefined,
  }));

  assert.match(html, /class="medication-name /);
  assert.match(html, /class="medication-prescription /);
  assert.match(html, /class="medication-dose-history /);
  assert.match(html, /class="medication-history-row /);
  assert.match(html, /class="medication-history-meta /);
  // The recorded detail survives verbatim: date/time, amount, caregiver and the
  // entered-next-window disclaimer.
  assert.ok(html.includes(formatDate(givenAt)));
  assert.ok(html.includes(formatTime(givenAt)));
  assert.match(html, /3\.5ml/);
  assert.match(html, /Given by Caregiver/);
  assert.match(html, /Entered next window:/);
  assert.match(html, /This is not a safe-to-dose recommendation\./);
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
  // Newest diaper summary + three history rows carry an elapsed separator each.
  assert.equal((html.match(/aria-hidden="true">· <\/span>/g) ?? []).length, 4);
  // Latest diapers now render as a closed native disclosure, not a log button.
  assert.match(html, /<details[^>]*data-latest-entries="true"/);
  assert.doesNotMatch(html, /<details[^>]*\bopen/);
  assert.match(html, /<summary[^>]*>[\s\S]*Latest diapers[\s\S]*<\/summary>/);
  assert.match(html, /data-latest-entries-content="true"[\s\S]*data-diaper-row="diaper-1"/);
  assert.match(html, />Log a new diaper<\/button>/);
  assert.match(html, /medication-dose-elapsed/);
  assert.match(html, /below the episode’s 400 ml 50% full-day intake threshold/);
  assert.doesNotMatch(html, /Sick mode active/);
});

test("latest diapers keep the newest summary closed and bound history at three", () => {
  const build = (count: number) => {
    const data = activeResponse();
    if (!data.summary) throw new Error("fixture summary missing");
    data.summary.latestDiapers = Array.from({ length: count }, (_, index) => ({
      id: `diaper-${index}`,
      startedAt: NOW - index * 60 * 60 * 1000,
      peeUnits: index,
      isWet: index > 0,
      poop: index === 0 ? "small" : "no",
    }));
    return renderToStaticMarkup(createElement(SickModePanel, {
      babyId: "baby-1",
      data,
      onRefresh: () => undefined,
      onLogActivity: () => undefined,
    }));
  };

  // Empty state is explicit and never claims zero pee.
  const empty = build(0);
  assert.match(empty, /No diapers logged yet/);
  assert.doesNotMatch(empty, /data-diaper-row=/);
  assert.doesNotMatch(empty, /data-latest-entries="true"/);

  for (const count of [1, 2, 3, 4]) {
    const html = build(count);
    assert.match(html, /<details[^>]*data-latest-entries="true"/);
    assert.doesNotMatch(html, /<details[^>]*\bopen/);
    assert.equal(
      (html.match(/data-diaper-row=/g) ?? []).length,
      Math.min(count, 3),
      `diaper history rows for ${count} diapers`,
    );
    assert.match(html, />Log a new diaper<\/button>/);
    assert.match(html, /latest-entries-contents/);
  }
});

test("diapers from a previous day show their date and missing pee reads as not recorded", () => {
  const pastDay = NOW - 2 * 24 * 60 * 60 * 1000;
  const data = activeResponse();
  if (!data.summary) throw new Error("fixture summary missing");
  data.summary.latestDiapers = [{
    id: "diaper-past",
    startedAt: pastDay,
    peeUnits: null,
    isWet: null,
    poop: "no",
  }];
  const html = renderToStaticMarkup(createElement(SickModePanel, {
    babyId: "baby-1",
    data,
    onRefresh: () => undefined,
  }));
  assert.ok(html.includes(formatDate(pastDay)));
  assert.match(html, /Pee not recorded/);
  assert.doesNotMatch(html, /No diapers logged yet/);
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
  const data = activeResponse();
  if (!data.summary) throw new Error("fixture summary missing");
  // "Log a new diaper" lives in the expanded disclosure, so a diaper must exist.
  data.summary.latestDiapers = [{ id: "diaper-1", startedAt: NOW - 60 * 60 * 1000, peeUnits: 1, isWet: true, poop: "no" }];
  const html = renderToStaticMarkup(createElement(SickModePanel, { babyId: "baby-1", data, onRefresh: () => undefined, onLogActivity: () => undefined, onLogMedication: () => undefined, onAddMedication: () => undefined }));
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

function sickEpisode(overrides: Partial<SickEpisode> = {}): SickEpisode {
  return {
    id: "episode-1",
    babyId: "baby-1",
    startedAt: NOW - 3 * 60 * 60 * 1000,
    endedAt: NOW - 2 * 60 * 60 * 1000,
    baselineDailyMl: 800,
    baselineKind: "calculated",
    baselineAvailableDayCount: 7,
    baselineSourceDays: [],
    createdAt: NOW,
    createdBy: "Caregiver",
    endedBy: "Caregiver",
    ...overrides,
  };
}

function settingsData(episodes: SickEpisode[], activeEpisode: SickEpisode | null = null): SickModeResponse {
  const data = activeResponse();
  data.episodes = episodes;
  data.activeEpisode = activeEpisode;
  if (!activeEpisode) data.summary = null;
  return data;
}

function resumeButtonTag(html: string): string {
  return html.match(/<button[^>]*>(?:(?!<\/button>)[\s\S])*?Resume episode<\/button>/)?.[0] ?? "";
}

test("resume payload captures the archived episode's expected start and end", () => {
  const archived = sickEpisode({ id: "episode-old", startedAt: NOW - 48 * 60 * 60 * 1000, endedAt: NOW - 40 * 60 * 60 * 1000 });
  assert.deepEqual(buildResumePayload({ babyId: "baby-1", episode: archived }), {
    action: "resume",
    babyId: "baby-1",
    episodeId: "episode-old",
    expectedStartedAt: NOW - 48 * 60 * 60 * 1000,
    expectedEndedAt: NOW - 40 * 60 * 60 * 1000,
  });
  assert.throws(() => buildResumePayload({
    babyId: "baby-1",
    episode: sickEpisode({ id: "episode-live", endedAt: null }),
  }));
});

test("a retry reuses the frozen captured episode instead of refreshed timestamps", () => {
  const rendered = sickEpisode({ id: "episode-old", startedAt: NOW - 48 * 60 * 60 * 1000, endedAt: NOW - 40 * 60 * 60 * 1000 });
  // A background refresh has since changed the rendered end time.
  const captured = sickEpisode({ id: "episode-old", startedAt: NOW - 48 * 60 * 60 * 1000, endedAt: NOW - 39 * 60 * 60 * 1000 });

  const reused = selectResumeCapture(rendered, { episodeId: "episode-old", episode: captured });
  assert.equal(reused.reusedCapture, true);
  assert.equal(reused.episode.endedAt, captured.endedAt);
  assert.deepEqual(buildResumePayload({ babyId: "baby-1", episode: reused.episode }).expectedEndedAt, NOW - 39 * 60 * 60 * 1000);

  // Without a matching capture (e.g. after a 409 cleared it) the latest state is used.
  const fresh = selectResumeCapture(rendered, null);
  assert.equal(fresh.reusedCapture, false);
  assert.equal(fresh.episode, rendered);
  const other = selectResumeCapture(rendered, { episodeId: "episode-mid", episode: captured });
  assert.equal(other.reusedCapture, false);
  assert.equal(other.episode, rendered);
});

test("resume eligibility needs an ended episode clear of any later or active episode", () => {
  const candidate = sickEpisode({ id: "episode-old", startedAt: 1_000_000, endedAt: 2_000_000 });
  assert.deepEqual(evaluateResumeEligibility(candidate, [candidate]), { eligible: true });

  // An earlier episode that fully precedes the candidate does not block resuming.
  const earlier = sickEpisode({ id: "episode-earlier", startedAt: 0, endedAt: 1_000_000 });
  assert.deepEqual(evaluateResumeEligibility(candidate, [candidate, earlier]), { eligible: true });

  // Anything ending after the candidate began would overlap the reopened continuous span.
  const later = sickEpisode({ id: "episode-later", startedAt: 3_000_000, endedAt: 4_000_000 });
  assert.deepEqual(evaluateResumeEligibility(candidate, [candidate, later]), { eligible: false, reason: "overlap" });

  // An active episode blocks too, and cannot itself be a resume candidate.
  const active = sickEpisode({ id: "episode-live", startedAt: 3_000_000, endedAt: null });
  assert.deepEqual(evaluateResumeEligibility(candidate, [candidate, active]), { eligible: false, reason: "active-episode" });
  assert.deepEqual(evaluateResumeEligibility(active, [active]), { eligible: false, reason: "not-archived" });
});

test("an eligible archived episode offers a resume CTA in settings but never on the dashboard", () => {
  const archived = sickEpisode({ id: "episode-old", startedAt: NOW - 48 * 60 * 60 * 1000, endedAt: NOW - 40 * 60 * 60 * 1000 });

  const controls = renderToStaticMarkup(createElement(SickModePanel, {
    babyId: "baby-1",
    data: settingsData([archived]),
    display: "controls",
    onRefresh: () => undefined,
  }));
  assert.match(controls, />Resume episode</);
  assert.match(controls, /continuous sick mode\. Medications and recorded doses are kept/);
  assert.doesNotMatch(resumeButtonTag(controls), /disabled=""/);

  const activeDashboard = renderToStaticMarkup(createElement(SickModePanel, {
    babyId: "baby-1",
    data: settingsData([archived], sickEpisode({ id: "episode-live", endedAt: null })),
    onRefresh: () => undefined,
  }));
  assert.doesNotMatch(activeDashboard, /Resume episode/);
});

test("an overlapping or active episode explains why resuming is unavailable instead of offering a button", () => {
  const candidate = sickEpisode({ id: "episode-old", startedAt: NOW - 48 * 60 * 60 * 1000, endedAt: NOW - 40 * 60 * 60 * 1000 });
  const active = sickEpisode({ id: "episode-live", startedAt: NOW - 60 * 60 * 1000, endedAt: null });
  const controls = renderToStaticMarkup(createElement(SickModePanel, {
    babyId: "baby-1",
    data: settingsData([candidate, active], active),
    display: "controls",
    onRefresh: () => undefined,
  }));
  assert.match(controls, /resume while another sick-mode episode is active/);
  assert.equal(resumeButtonTag(controls), "");

  // Two mutually overlapping ended episodes each block the other, so no resume button appears.
  const later = sickEpisode({ id: "episode-mid", startedAt: NOW - 44 * 60 * 60 * 1000, endedAt: NOW - 42 * 60 * 60 * 1000 });
  const overlap = renderToStaticMarkup(createElement(SickModePanel, {
    babyId: "baby-1",
    data: settingsData([candidate, later]),
    display: "controls",
    onRefresh: () => undefined,
  }));
  assert.match(overlap, /a later episode would overlap this one/);
  assert.equal(resumeButtonTag(overlap), "");
});

test("stale sick-mode data disables the resume CTA", () => {
  const archived = sickEpisode({ id: "episode-old", startedAt: NOW - 48 * 60 * 60 * 1000, endedAt: NOW - 40 * 60 * 60 * 1000 });
  const controls = renderToStaticMarkup(createElement(SickModePanel, {
    babyId: "baby-1",
    data: settingsData([archived]),
    display: "controls",
    isStale: true,
    onRefresh: () => undefined,
  }));
  assert.match(resumeButtonTag(controls), /disabled=""/);
});
