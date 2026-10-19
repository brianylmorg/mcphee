import assert from "node:assert/strict";
import test from "node:test";

import { averageSleepWindows, calculateSleepWindowHistory, type SleepWindowSession } from "./sleep-windows";

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
    { date: "a", wakeWindowCount: 1, wakeWindowTotalMs: 60 * minute, napCount: 0, napTotalMs: 0 },
    { date: "b", wakeWindowCount: 3, wakeWindowTotalMs: 300 * minute, napCount: 2, napTotalMs: 100 * minute },
  ]);
  assert.equal(avg.wakeWindowMs, 90 * minute);
  assert.equal(avg.napMs, 50 * minute);
  assert.deepEqual(averageSleepWindows([]), { wakeWindowMs: null, napMs: null });
});
