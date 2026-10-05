import assert from "node:assert/strict";
import test from "node:test";

import { calculateDailyNaps, type DailyNapSession } from "./daily-naps";

const minute = 60 * 1000;
const sgt = (day: string, time: string) => Date.parse(`${day}T${time}+08:00`);

test("excludes incoming overnight sleep and totals multiple daytime naps", () => {
  const sessions: DailyNapSession[] = [
    { id: "overnight", startedAt: sgt("2026-10-04", "19:00:00"), endedAt: sgt("2026-10-05", "07:05:00") },
    { id: "nap-one", startedAt: sgt("2026-10-05", "09:10:00"), endedAt: sgt("2026-10-05", "09:55:00") },
    { id: "nap-two", startedAt: sgt("2026-10-05", "13:00:00"), endedAt: sgt("2026-10-05", "14:20:00") },
  ];

  assert.deepEqual(calculateDailyNaps(sessions, sgt("2026-10-05", "15:00:00")), {
    totalMs: 125 * minute,
    dayStartAt: sgt("2026-10-05", "07:05:00"),
    bedtimeAt: null,
    waitingForMorningWake: false,
  });
});

test("includes the elapsed portion of an ongoing daytime nap", () => {
  const sessions: DailyNapSession[] = [
    { startedAt: sgt("2026-10-04", "20:00:00"), endedAt: sgt("2026-10-05", "07:00:00") },
    { startedAt: sgt("2026-10-05", "10:00:00") },
  ];

  assert.equal(calculateDailyNaps(sessions, sgt("2026-10-05", "10:15:00")).totalMs, 15 * minute);
  assert.equal(calculateDailyNaps(sessions, sgt("2026-10-05", "10:45:00")).totalMs, 45 * minute);
});

test("freezes the total at bedtime and ignores following overnight wakes", () => {
  const sessions: DailyNapSession[] = [
    { startedAt: sgt("2026-10-04", "19:00:00"), endedAt: sgt("2026-10-05", "07:00:00") },
    { startedAt: sgt("2026-10-05", "10:00:00"), endedAt: sgt("2026-10-05", "10:30:00") },
    { startedAt: sgt("2026-10-05", "18:45:00"), endedAt: sgt("2026-10-05", "22:00:00") },
    { startedAt: sgt("2026-10-05", "23:00:00"), endedAt: sgt("2026-10-05", "23:15:00") },
  ];
  const result = calculateDailyNaps(sessions, sgt("2026-10-05", "23:30:00"));

  assert.equal(result.totalMs, 30 * minute);
  assert.equal(result.bedtimeAt, sgt("2026-10-05", "18:45:00"));
});

test("uses inclusive 05:00 and 18:00 boundaries but ignores earlier wakes", () => {
  const sessions: DailyNapSession[] = [
    { startedAt: sgt("2026-10-04", "21:00:00"), endedAt: sgt("2026-10-05", "04:59:00") },
    { startedAt: sgt("2026-10-05", "04:59:30"), endedAt: sgt("2026-10-05", "05:00:00") },
    { startedAt: sgt("2026-10-05", "12:00:00"), endedAt: sgt("2026-10-05", "12:20:00") },
    { startedAt: sgt("2026-10-05", "18:00:00") },
  ];
  const result = calculateDailyNaps(sessions, sgt("2026-10-05", "19:00:00"));

  assert.equal(result.dayStartAt, sgt("2026-10-05", "05:00:00"));
  assert.equal(result.bedtimeAt, sgt("2026-10-05", "18:00:00"));
  assert.equal(result.totalMs, 20 * minute);
});

test("waits for a qualifying morning wake and does not count overnight sleep", () => {
  const sessions: DailyNapSession[] = [
    { startedAt: sgt("2026-10-04", "20:00:00") },
    { startedAt: sgt("2026-10-05", "01:00:00"), endedAt: sgt("2026-10-05", "04:45:00") },
  ];

  assert.deepEqual(calculateDailyNaps(sessions, sgt("2026-10-05", "06:00:00")), {
    totalMs: 0,
    dayStartAt: null,
    bedtimeAt: null,
    waitingForMorningWake: true,
  });
});

test("excludes future, non-finite, and reversed rows", () => {
  const sessions: DailyNapSession[] = [
    { startedAt: sgt("2026-10-04", "20:00:00"), endedAt: sgt("2026-10-05", "07:00:00") },
    { startedAt: sgt("2026-10-05", "09:00:00"), endedAt: sgt("2026-10-05", "08:00:00") },
    { startedAt: Number.NaN, endedAt: sgt("2026-10-05", "09:30:00") },
    { startedAt: sgt("2026-10-05", "11:00:00"), endedAt: sgt("2026-10-05", "12:00:00") },
    { startedAt: sgt("2026-10-05", "08:00:00"), endedAt: sgt("2026-10-05", "10:30:00") },
  ];

  assert.equal(calculateDailyNaps(sessions, sgt("2026-10-05", "10:00:00")).totalMs, 0);
});

test("merges overlapping duplicate intervals without mutating input", () => {
  const sessions: DailyNapSession[] = [
    { id: "wake", startedAt: sgt("2026-10-04", "20:00:00"), endedAt: sgt("2026-10-05", "07:00:00") },
    { id: "a", startedAt: sgt("2026-10-05", "09:00:00"), endedAt: sgt("2026-10-05", "10:00:00") },
    { id: "b", startedAt: sgt("2026-10-05", "09:30:00"), endedAt: sgt("2026-10-05", "10:30:00") },
  ];
  const snapshot = structuredClone(sessions);

  assert.equal(calculateDailyNaps(sessions, sgt("2026-10-05", "11:00:00")).totalMs, 90 * minute);
  assert.deepEqual(sessions, snapshot);
});

test("resets at Singapore midnight independently of the host timezone", () => {
  const sessions: DailyNapSession[] = [
    { startedAt: Date.parse("2026-10-04T12:00:00Z"), endedAt: Date.parse("2026-10-04T23:00:00Z") },
    { startedAt: Date.parse("2026-10-05T02:00:00Z"), endedAt: Date.parse("2026-10-05T03:00:00Z") },
  ];

  assert.equal(calculateDailyNaps(sessions, Date.parse("2026-10-05T15:59:59Z")).totalMs, 60 * minute);
  assert.deepEqual(calculateDailyNaps(sessions, Date.parse("2026-10-05T16:00:00Z")), {
    totalMs: 0,
    dayStartAt: null,
    bedtimeAt: null,
    waitingForMorningWake: true,
  });
});
