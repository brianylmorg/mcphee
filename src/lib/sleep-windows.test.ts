import assert from "node:assert/strict";
import test from "node:test";

import {
  ageWakeWindowGuide,
  averageSleepWindows,
  calculateNapLengthZones,
  calculateNapZones,
  calculateSleepWindowHistory,
  currentWakeWindow,
  medianNapMs,
  napHint,
  percentile,
  type DailySleepWindows,
  type SleepWindowSession,
  type WakeWindow,
} from "./sleep-windows";

const minute = 60 * 1000;
const sgt = (day: string, time: string) => Date.parse(`${day}T${time}+08:00`);

test("counts wake windows from morning wake to bedtime and completed naps", () => {
  const sessions: SleepWindowSession[] = [
    { startedAt: sgt("2026-10-04", "19:00:00"), endedAt: sgt("2026-10-05", "07:00:00") },
    { startedAt: sgt("2026-10-05", "09:00:00"), endedAt: sgt("2026-10-05", "10:00:00") },
    { startedAt: sgt("2026-10-05", "13:00:00"), endedAt: sgt("2026-10-05", "14:30:00") },
    { startedAt: sgt("2026-10-05", "19:00:00"), endedAt: sgt("2026-10-06", "06:30:00") },
  ];

  const days = calculateSleepWindowHistory(sessions, sgt("2026-10-06", "06:45:00"));
  assert.deepEqual(days.map((day) => day.date), ["2026-10-04", "2026-10-05", "2026-10-06"]);
  assert.deepEqual(days[1], {
    date: "2026-10-05",
    wakeWindowCount: 3,
    wakeWindowTotalMs: (120 + 180 + 270) * minute,
    napCount: 2,
    napTotalMs: (60 + 90) * minute,
    wakeWindows: [
      { index: 1, startedAt: sgt("2026-10-05", "07:00:00"), durationMs: 120 * minute, endsIn: "nap" },
      { index: 2, startedAt: sgt("2026-10-05", "10:00:00"), durationMs: 180 * minute, endsIn: "nap" },
      { index: 3, startedAt: sgt("2026-10-05", "14:30:00"), durationMs: 270 * minute, endsIn: "bedtime" },
    ],
    napDurationsMs: [60 * minute, 90 * minute],
    naps: [
      { index: 1, startedAt: sgt("2026-10-05", "09:00:00"), durationMs: 60 * minute },
      { index: 2, startedAt: sgt("2026-10-05", "13:00:00"), durationMs: 90 * minute },
    ],
  });
  // Today has a morning wake but nothing completed after it yet.
  assert.equal(days[2].wakeWindowCount, 0);
  assert.equal(days[2].napCount, 0);
});

test("excludes overnight wakings, the ongoing nap and the current awake stretch", () => {
  const sessions: SleepWindowSession[] = [
    { startedAt: sgt("2026-10-04", "19:00:00"), endedAt: sgt("2026-10-05", "02:00:00") },
    { startedAt: sgt("2026-10-05", "02:30:00"), endedAt: sgt("2026-10-05", "07:00:00") },
    { startedAt: sgt("2026-10-05", "09:00:00"), endedAt: sgt("2026-10-05", "10:00:00") },
    { startedAt: sgt("2026-10-05", "12:00:00") },
  ];

  const [, today] = calculateSleepWindowHistory(sessions, sgt("2026-10-05", "12:30:00"));
  assert.equal(today.wakeWindowCount, 2);
  assert.equal(today.wakeWindowTotalMs, (120 + 120) * minute);
  assert.equal(today.napCount, 1);
  assert.equal(today.napTotalMs, 60 * minute);
});

test("merges sleep records a few minutes apart into one nap", () => {
  const sessions: SleepWindowSession[] = [
    { startedAt: sgt("2026-10-04", "20:00:00"), endedAt: sgt("2026-10-05", "07:00:00") },
    { startedAt: sgt("2026-10-05", "09:00:00"), endedAt: sgt("2026-10-05", "09:40:00") },
    { startedAt: sgt("2026-10-05", "09:43:00"), endedAt: sgt("2026-10-05", "10:20:00") },
  ];

  const [, day] = calculateSleepWindowHistory(sessions, sgt("2026-10-05", "11:00:00"));
  assert.equal(day.napCount, 1);
  assert.equal(day.napTotalMs, 80 * minute);
  assert.equal(day.wakeWindowCount, 1);
});

test("treats an early sleep that runs past midnight as bedtime, not a nap", () => {
  const sessions: SleepWindowSession[] = [
    { startedAt: sgt("2026-10-04", "20:00:00"), endedAt: sgt("2026-10-05", "07:00:00") },
    { startedAt: sgt("2026-10-05", "17:30:00"), endedAt: sgt("2026-10-06", "06:00:00") },
  ];

  const [, day] = calculateSleepWindowHistory(sessions, sgt("2026-10-06", "08:00:00"));
  assert.equal(day.napCount, 0);
  assert.equal(day.wakeWindowCount, 1);
  assert.equal(day.wakeWindowTotalMs, (10 * 60 + 30) * minute);
});

test("days without a morning wake have no windows and the range is capped", () => {
  const sessions: SleepWindowSession[] = [
    { startedAt: sgt("2026-08-01", "09:00:00"), endedAt: sgt("2026-08-01", "10:00:00") },
    { startedAt: sgt("2026-10-05", "13:00:00"), endedAt: sgt("2026-10-05", "14:00:00") },
  ];

  const days = calculateSleepWindowHistory(sessions, sgt("2026-10-05", "15:00:00"), 7);
  assert.equal(days.length, 7);
  assert.equal(days[0].date, "2026-09-29");
  assert.ok(days.slice(0, 6).every((day) => day.wakeWindowCount === 0 && day.napCount === 0));
});

test("averages weight every window equally", () => {
  const avg = averageSleepWindows([
    { date: "a", wakeWindowCount: 1, wakeWindowTotalMs: 60 * minute, napCount: 0, napTotalMs: 0, wakeWindows: [], napDurationsMs: [], naps: [] },
    { date: "b", wakeWindowCount: 3, wakeWindowTotalMs: 300 * minute, napCount: 2, napTotalMs: 100 * minute, wakeWindows: [], napDurationsMs: [], naps: [] },
  ]);
  assert.equal(avg.wakeWindowMs, 90 * minute);
  assert.equal(avg.napMs, 50 * minute);
  assert.deepEqual(averageSleepWindows([]), { wakeWindowMs: null, napMs: null });
});

/** A day of wake windows (minutes) ending in naps, then one before bed. */
function day(date: string, napWindows: number[], bedtimeWindow?: number): DailySleepWindows {
  const wakeWindows: WakeWindow[] = napWindows.map((m, i) => ({ index: i + 1, startedAt: 0, durationMs: m * minute, endsIn: "nap" }));
  // Bedtime stretches start at 16:30 Singapore time.
  if (bedtimeWindow != null) wakeWindows.push({ index: napWindows.length + 1, startedAt: Date.parse(`2026-10-01T16:30:00+08:00`), durationMs: bedtimeWindow * minute, endsIn: "bedtime" });
  return {
    date, wakeWindows, napDurationsMs: [], naps: [],
    wakeWindowCount: wakeWindows.length, wakeWindowTotalMs: wakeWindows.reduce((t, w) => t + w.durationMs, 0), napCount: 0, napTotalMs: 0,
  };
}

test("percentile interpolates between ranks", () => {
  assert.equal(percentile([], 0.5), null);
  assert.equal(percentile([30, 10, 20], 0.5), 20);
  assert.equal(percentile([10, 20, 30, 40], 0.5), 25);
  assert.equal(percentile([10, 20, 30, 40, 50], 0.25), 20);
});

test("nap zones group wake windows by position and keep bedtime separate", () => {
  const days = [
    day("2026-10-01", [100, 150], 240),
    day("2026-10-02", [110, 160], 250),
    day("2026-10-03", [120, 140], 230),
    day("2026-10-04", [130, 170]),
  ];
  const zones = calculateNapZones(days);
  assert.equal(zones.dayCount, 4);
  // Fixture windows start at epoch 0 (08:00 Singapore).
  assert.deepEqual(zones.nap[1], { count: 4, medianMs: 115 * minute, fromMs: 107.5 * minute, toMs: 122.5 * minute, lookbackDays: 14, startMinute: 480, endMinute: 480 + 115 });
  assert.equal(zones.nap[2]?.medianMs, 155 * minute);
  assert.equal(zones.bedtime?.medianMs, 240 * minute);
  assert.equal(zones.nap[3], undefined);
});

test("nap zones skip excluded days, look back 14 days and need 3 samples", () => {
  const days = [
    day("2026-09-01", [500]), // older than the lookback
    ...Array.from({ length: 13 }, (_, i) => day(`2026-10-${String(i + 1).padStart(2, "0")}`, [120])),
    day("2026-10-14", [60]),
  ];
  const sickDates = new Set(["2026-10-14"]);
  const normal = calculateNapZones(days, { includeDate: (date) => !sickDates.has(date) });
  assert.equal(normal.nap[1]?.medianMs, 120 * minute);
  assert.equal(normal.nap[1]?.count, 13);
  const sick = calculateNapZones(days, { lookbackDays: 14, includeDate: (date) => sickDates.has(date) });
  assert.equal(sick.nap[1], undefined);
});

test("nap zones reach further back when the last 14 days are mostly sick", () => {
  // 20 well days, then 14 sick days: nothing usable in the last 14 well days.
  const days = Array.from({ length: 34 }, (_, i) => day(`d${String(i).padStart(2, "0")}`, [i < 20 ? 120 : 60]));
  const sickDates = new Set(days.slice(-14).map((d) => d.date));
  const zones = calculateNapZones(days, { includeDate: (date) => !sickDates.has(date) });
  assert.equal(zones.nap[1]?.lookbackDays, 28);
  assert.equal(zones.nap[1]?.medianMs, 120 * minute);
  assert.equal(zones.nap[1]?.count, 14);
});

test("windows from the 4th on are pooled", () => {
  const days = [day("a", [60, 60, 60, 90, 100]), day("b", [60, 60, 60, 95]), day("c", [60, 60, 60, 105])];
  assert.equal(calculateNapZones(days).nap[4]?.count, 4);
});

test("the current wake window counts naps since morning wake", () => {
  const sessions: SleepWindowSession[] = [
    { startedAt: sgt("2026-10-04", "19:00:00"), endedAt: sgt("2026-10-05", "07:00:00") },
    { startedAt: sgt("2026-10-05", "09:00:00"), endedAt: sgt("2026-10-05", "10:00:00") },
  ];
  assert.deepEqual(currentWakeWindow(sessions, sgt("2026-10-05", "11:00:00")), { index: 2, awakeSince: sgt("2026-10-05", "10:00:00") });
  assert.deepEqual(currentWakeWindow(sessions.slice(0, 1), sgt("2026-10-05", "08:00:00")), { index: 1, awakeSince: sgt("2026-10-05", "07:00:00") });
  assert.equal(currentWakeWindow([...sessions, { startedAt: sgt("2026-10-05", "12:00:00") }], sgt("2026-10-05", "12:30:00")), null);
  // Up at 04:30, before the 05:00 morning boundary: still his first window.
  const early = [{ startedAt: sgt("2026-10-04", "19:00:00"), endedAt: sgt("2026-10-05", "04:30:00") }];
  assert.deepEqual(currentWakeWindow(early, sgt("2026-10-05", "05:30:00")), { index: 1, awakeSince: sgt("2026-10-05", "04:30:00") });
});

test("median nap length per day", () => {
  assert.equal(medianNapMs({ ...day("a", []), napDurationsMs: [30 * minute, 90 * minute, 60 * minute] }), 60 * minute);
  assert.equal(medianNapMs(day("a", [])), null);
});

test("age guide picks the band for his age", () => {
  const now = sgt("2026-10-19", "12:00:00");
  assert.deepEqual(ageWakeWindowGuide(sgt("2026-04-19", "12:00:00"), now), { fromMs: 120 * minute, toMs: 180 * minute });
  assert.equal(ageWakeWindowGuide(null, now), null);
  assert.equal(ageWakeWindowGuide(now + 1, now), null);
});

test("nap hint prefers his own zone, then sick days while sick, then bedtime, then the age guide", () => {
  const now = sgt("2026-10-05", "12:00:00");
  const normal = calculateNapZones([day("a", [100, 150], 240), day("b", [110, 160], 250), day("c", [120, 140], 230)]);
  const sick = calculateNapZones([day("s1", [60]), day("s2", [70]), day("s3", [80])]);
  const at = (minutesAwake: number, index: number) => ({ index, awakeSince: now - minutesAwake * minute });

  assert.deepEqual(napHint({ current: at(90, 1), now, normal }), {
    status: "before", untilMs: 15 * minute, fromMs: 105 * minute, toMs: 115 * minute, medianMs: 110 * minute, source: "own", leadsTo: "nap", index: 1,
  });
  assert.equal(napHint({ current: at(110, 1), now, normal })?.status, "in");
  assert.equal(napHint({ current: at(110, 1), now, normal })?.untilMs, 0);
  assert.equal(napHint({ current: at(130, 1), now, normal })?.status, "past");
  assert.equal(napHint({ current: at(65, 1), now, normal, sick, isSick: true })?.source, "sick");
  // Sick but no sick-day zone for this window: fall back to his normal zone.
  assert.equal(napHint({ current: at(65, 2), now, normal, sick, isSick: true })?.source, "own");
  // An extra 3rd window at midday (no 3rd-window zone): borrow the 2nd window's zone, not bedtime.
  assert.deepEqual(napHint({ current: at(30, 3), now, normal })?.leadsTo, "nap");
  assert.equal(napHint({ current: at(30, 3), now, normal })?.medianMs, 150 * minute);
  const empty = calculateNapZones([]);
  assert.equal(napHint({ current: at(30, 1), now, normal: empty, ageGuide: { fromMs: 120 * minute, toMs: 180 * minute } })?.source, "age");
  assert.equal(napHint({ current: at(30, 1), now, normal: empty }), null);
  assert.equal(napHint({ current: null, now, normal }), null);
});

test("a stretch starting near his usual bedtime-stretch time heads to bed", () => {
  const normal = calculateNapZones([day("a", [100, 150], 240), day("b", [110, 160], 250), day("c", [120, 140], 230)]);
  assert.equal(normal.bedtimeWindowStartMinute, 16 * 60 + 30);
  const evening = sgt("2026-10-05", "18:00:00");
  // Woke from his 2nd nap at 16:00 (within 45 min of 16:30): bedtime zone, even though a 3rd-window zone could apply.
  const hint = napHint({ current: { index: 3, awakeSince: sgt("2026-10-05", "16:00:00") }, now: evening, normal });
  assert.equal(hint?.leadsTo, "bedtime");
  assert.equal(hint?.medianMs, 240 * minute);
  // Woke at 15:30: too early for the bedtime stretch.
  assert.equal(napHint({ current: { index: 3, awakeSince: sgt("2026-10-05", "15:30:00") }, now: evening, normal })?.leadsTo, "nap");
  // The first window of the day is never the bedtime stretch.
  assert.equal(napHint({ current: { index: 1, awakeSince: sgt("2026-10-05", "17:00:00") }, now: evening, normal })?.leadsTo, "nap");
});

test("zones carry his typical times, and naps get their own zones", () => {
  const sessions: SleepWindowSession[] = [];
  for (const [d, wake, nap1, nap1End, nap2, nap2End] of [
    ["2026-10-01", "07:00", "09:00", "10:00", "13:00", "14:30"],
    ["2026-10-02", "07:15", "09:15", "10:05", "13:10", "14:20"],
    ["2026-10-03", "06:50", "08:55", "10:10", "12:50", "14:40"],
  ]) {
    sessions.push({ startedAt: sgt(d, "00:00:00") - 5 * 60 * minute, endedAt: sgt(d, `${wake}:00`) });
    sessions.push({ startedAt: sgt(d, `${nap1}:00`), endedAt: sgt(d, `${nap1End}:00`) });
    sessions.push({ startedAt: sgt(d, `${nap2}:00`), endedAt: sgt(d, `${nap2End}:00`) });
  }
  const days = calculateSleepWindowHistory(sessions, sgt("2026-10-03", "16:00:00"));
  const wake = calculateNapZones(days);
  assert.equal(wake.nap[1]?.startMinute, 7 * 60);
  assert.equal(wake.nap[1]?.endMinute, 9 * 60);
  const naps = calculateNapLengthZones(days);
  assert.equal(naps[1]?.count, 3);
  assert.equal(naps[1]?.medianMs, 60 * minute);
  assert.equal(naps[1]?.startMinute, 9 * 60);
  assert.equal(naps[1]?.endMinute, 10 * 60 + 5);
  assert.equal(naps[2]?.medianMs, 90 * minute);
  assert.equal(naps[3], undefined);
});
