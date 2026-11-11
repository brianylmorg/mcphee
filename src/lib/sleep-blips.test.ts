import assert from "node:assert/strict";
import test from "node:test";

import {
  blipEndingFromDetails,
  blipsInSleep,
  canUndoBlip,
  formatBlipDuration,
  isSleepBlipUndoToken,
  nightBlipSummaries,
  openBlip,
  totalBlipMs,
  type SleepBlipUndoToken,
} from "./sleep-blips";

const MIN = 60_000;
/** Epoch ms for an SGT wall-clock time. */
const sgt = (iso: string) => Date.parse(iso + "+08:00");

test("blips belong to the sleep whose window holds their start", () => {
  const sleep = { startedAt: sgt("2026-11-09T19:00:00"), endedAt: sgt("2026-11-10T06:00:00") };
  const inside = { startedAt: sgt("2026-11-09T23:00:00"), endedAt: sgt("2026-11-09T23:04:00") };
  const before = { startedAt: sgt("2026-11-09T18:00:00"), endedAt: sgt("2026-11-09T18:05:00") };
  assert.deepEqual(blipsInSleep([before, inside], sleep), [inside]);
});

test("an ongoing blip counts through now and is the open blip", () => {
  const now = sgt("2026-11-10T02:10:00");
  const done = { startedAt: sgt("2026-11-10T01:00:00"), endedAt: sgt("2026-11-10T01:03:00") };
  const live = { startedAt: sgt("2026-11-10T02:00:00"), endedAt: null };
  assert.equal(totalBlipMs([done, live], now), 13 * MIN);
  assert.equal(openBlip([done, live]), live);
  assert.equal(openBlip([done]), null);
});

test("night summary counts blips, endings, wakes and the longest quiet stretch", () => {
  const now = sgt("2026-11-10T12:00:00");
  const sleeps = [
    { startedAt: sgt("2026-11-09T19:00:00"), endedAt: sgt("2026-11-10T01:00:00") },
    { startedAt: sgt("2026-11-10T01:30:00"), endedAt: sgt("2026-11-10T06:30:00") },
    { startedAt: sgt("2026-11-10T09:00:00"), endedAt: sgt("2026-11-10T10:00:00") }, // nap, not night
  ];
  const blips = [
    { startedAt: sgt("2026-11-09T22:00:00"), endedAt: sgt("2026-11-09T22:05:00"), ending: "self" as const },
    { startedAt: sgt("2026-11-10T00:50:00"), endedAt: sgt("2026-11-10T01:00:00"), ending: "woke" as const },
    { startedAt: sgt("2026-11-10T03:00:00"), endedAt: sgt("2026-11-10T03:10:00"), ending: "us" as const },
    { startedAt: sgt("2026-11-10T09:30:00"), endedAt: sgt("2026-11-10T09:32:00"), ending: "self" as const },
  ];
  const [night] = nightBlipSummaries(sleeps, blips, now);
  assert.equal(night.date, "2026-11-09");
  assert.equal(night.blipCount, 3);
  assert.equal(night.blipMs, 25 * MIN);
  assert.equal(night.selfSettled, 1);
  assert.equal(night.settledByUs, 1);
  assert.equal(night.becameWake, 1);
  assert.equal(night.wakeCount, 1);
  // 03:10 → 06:30 is the longest unbroken stretch (3h20m).
  assert.equal(night.longestStretchMs, 200 * MIN);
  assert.equal(night.endedAt, sgt("2026-11-10T06:30:00"));
});

test("a night with no blips reports its longest sleep as the stretch", () => {
  const now = sgt("2026-11-10T12:00:00");
  const [night] = nightBlipSummaries([
    { startedAt: sgt("2026-11-09T19:00:00"), endedAt: sgt("2026-11-10T06:00:00") },
  ], [], now);
  assert.equal(night.blipCount, 0);
  assert.equal(night.longestStretchMs, 11 * 60 * MIN);
});

test("an ongoing night has no end yet and short gaps merge into one sleep", () => {
  const now = sgt("2026-11-10T02:00:00");
  const [night] = nightBlipSummaries([
    { startedAt: sgt("2026-11-09T19:00:00"), endedAt: sgt("2026-11-09T23:00:00") },
    { startedAt: sgt("2026-11-09T23:03:00"), endedAt: null },
  ], [], now);
  assert.equal(night.endedAt, null);
  assert.equal(night.wakeCount, 0);
});

test("nights come newest first and are capped", () => {
  const now = sgt("2026-11-12T12:00:00");
  const sleeps = ["2026-11-09", "2026-11-10", "2026-11-11"].map((day) => ({
    startedAt: sgt(day + "T19:00:00"),
    endedAt: sgt(day + "T19:00:00") + 10 * 60 * MIN,
  }));
  assert.deepEqual(nightBlipSummaries(sleeps, [], now, 2).map((night) => night.date), ["2026-11-11", "2026-11-10"]);
});

test("undo works only for a fresh token whose row is unchanged", () => {
  const start: SleepBlipUndoToken = { kind: "started-blip", activityId: "b1", changedAt: 1000, issuedAt: 1000 };
  assert.equal(canUndoBlip(start, { startedAt: 1000, endedAt: null }, 2000), true);
  assert.equal(canUndoBlip(start, { startedAt: 1000, endedAt: 1500 }, 2000), false);
  assert.equal(canUndoBlip(start, { startedAt: 1000, endedAt: null }, 40_000), false);
  assert.equal(canUndoBlip(start, null, 2000), false);
  const end: SleepBlipUndoToken = { kind: "ended-blip", activityId: "b1", changedAt: 1500, issuedAt: 1500 };
  assert.equal(canUndoBlip(end, { startedAt: 1000, endedAt: 1500 }, 2000), true);
  assert.equal(canUndoBlip(end, { startedAt: 1000, endedAt: 1600 }, 2000), false);
});

test("token and detail parsing reject junk", () => {
  assert.equal(isSleepBlipUndoToken({ kind: "started-blip", activityId: "x", changedAt: 1, issuedAt: 1 }), true);
  assert.equal(isSleepBlipUndoToken({ kind: "woke", activityId: "x", changedAt: 1, issuedAt: 1 }), false);
  assert.equal(isSleepBlipUndoToken({ kind: "started-blip", activityId: "x", changedAt: 1 }), false);
  assert.equal(blipEndingFromDetails('{"ending":"self"}'), "self");
  assert.equal(blipEndingFromDetails({ ending: "woke" }), "woke");
  assert.equal(blipEndingFromDetails("not json"), null);
  assert.equal(blipEndingFromDetails({ ending: "other" }), null);
});

test("durations read as minutes", () => {
  assert.equal(formatBlipDuration(20_000), "<1m");
  assert.equal(formatBlipDuration(4 * MIN), "4m");
  assert.equal(formatBlipDuration(65 * MIN), "1h 05m");
});


test("finding 5: longest stretch clips every intersecting blip across sleep intervals", () => {
  const now = sgt("2026-11-10T12:00:00");
  const sleeps = [
    { startedAt: sgt("2026-11-09T19:00:00"), endedAt: sgt("2026-11-09T23:00:00") },
    { startedAt: sgt("2026-11-09T23:30:00"), endedAt: sgt("2026-11-10T06:00:00") },
  ];
  const [night] = nightBlipSummaries(sleeps, [
    { startedAt: sgt("2026-11-09T22:00:00"), endedAt: sgt("2026-11-10T00:30:00") },
  ], now);
  assert.equal(night.longestStretchMs, 330 * MIN);
  assert.equal(night.blipCount, 1);
  const [outsideStart] = nightBlipSummaries([sleeps[1]], [
    { startedAt: sgt("2026-11-09T22:00:00"), endedAt: sgt("2026-11-10T00:30:00") },
    { startedAt: sgt("2026-11-09T23:00:00"), endedAt: sgt("2026-11-10T01:00:00") },
  ], now);
  assert.equal(outsideStart.longestStretchMs, 300 * MIN);
  assert.equal(outsideStart.blipCount, 0, "intersection affects quiet stretches, not start-based counts");
});

test("finding 6: since drops old logged nights and whole nights spanning the cutoff", () => {
  const now = sgt("2026-11-10T12:00:00");
  const since = now - 14 * 86400_000;
  const sleeps = [
    { startedAt: sgt("2026-10-01T19:00:00"), endedAt: sgt("2026-10-02T06:00:00") },
    { startedAt: sgt("2026-10-26T19:00:00"), endedAt: sgt("2026-10-27T13:00:00") },
    { startedAt: sgt("2026-10-27T19:00:00"), endedAt: sgt("2026-10-28T06:00:00") },
    { startedAt: sgt("2026-11-09T19:00:00"), endedAt: sgt("2026-11-10T06:00:00") },
  ];
  assert.deepEqual(nightBlipSummaries(sleeps, [], now, 14, since).map(night => night.date), ["2026-11-09", "2026-10-27"]);
  assert.equal(nightBlipSummaries(sleeps, [], now, 14, sleeps[3].startedAt).length, 1, "since is inclusive");
  assert.equal(nightBlipSummaries(sleeps, [], now).length, 4, "since is optional");
});
