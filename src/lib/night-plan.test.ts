import assert from "node:assert/strict";
import test from "node:test";
import { computeNightPlan, currentNightSlot, nightPlanSummaryText, slotForTime, type NightPlanInputs } from "./night-plan";

const at = (date: string, time: string) => Date.parse(`${date}T${time}:00+08:00`);
const DAY = 86400_000;
const now = at("2026-11-12", "17:00");
// Oldest to newest; daytime feeds keep the low-intake gate out of slot tests.
function input(evening = [120, 120, 120, 120], early = [100, 100, 100, 100], midnight = [140, 140, 140, 140]): NightPlanInputs {
  const sleeps = evening.map((_, i) => ({ startedAt: at("2026-11-08", "20:00") + i * DAY, endedAt: at("2026-11-09", "07:00") + i * DAY }));
  const feeds = sleeps.flatMap((sleep, i) => [
    { startedAt: sleep.startedAt - 8 * 3600_000, amountMl: 800 },
    ...[[1, evening[i]], [5, midnight[i]], [9, early[i]]].flatMap(([hour, amountMl]) => amountMl == null ? [] : [{ startedAt: sleep.startedAt + hour * 3600_000, amountMl }]),
  ]);
  return { sleeps, feeds, weights: [], isSick: false, now };
}
const plan = (evening?: number[], early?: number[], midnight?: number[]) => computeNightPlan(input(evening, early, midnight));

test("ratchets after two compliant nights, and holds or raises after larger feeds", () => {
  assert.equal(plan().slots.evening?.tonightMl, 100);
  assert.equal(plan([120, 120, 100, 100]).slots.evening?.tonightMl, 80);
  assert.equal(plan([120, 120, 100, 120]).slots.evening?.tonightMl, 100);
  assert.equal(plan([120, 120, 100, 140]).slots.evening?.tonightMl, 120);
  const capped = plan([100, 100, 100, 240]).slots.evening!;
  assert.equal(capped.tonightMl, capped.usualMl! + 20);
});

test("settle first at 60 or less, zero on the last two usable nights moves to early then midnight", () => {
  assert.equal(plan([80, 80, 60, 60]).slots.evening?.mode, "settle-first");
  assert.equal(plan([80, 80, 60, 60]).slots.evening?.tonightMl, 0);
  // 1–5 ml are ignored, unlike a breastfeed represented by zero.
  assert.equal(plan([80, 80, 1, 5]).activeSlot, "early");
  assert.equal(plan([1, 1, 1, 1], [1, 1, 1, 1]).activeSlot, "midnight");
  assert.equal(plan([1, 1, 1, 1], [1, 1, 1, 1], [1, 1, 1, 1]).activeSlot, null);
});

test("breastfeeds make only their slot unusable; unknown holds its place and has no size", () => {
  const unknown = plan([0, 0, 0, 100]);
  assert.equal(unknown.status, "ready");
  assert.equal(unknown.activeSlot, "evening");
  assert.deepEqual(unknown.slots.evening, { mode: "unknown" });
  assert.equal(unknown.slots.early?.mode, "usual");
  assert.doesNotMatch(nightPlanSummaryText(unknown)!, /Evening/);
  const skipped = plan([120, 100, 0, 0]);
  assert.equal(skipped.slots.evening?.tonightMl, 100);
  const gone = input([120, 1, 1, 0]);
  assert.equal(computeNightPlan(gone).slots.evening?.mode, "gone");
  // Any breastfeed invalidates even a mixed breast/bottle slot.
  const mixed = input();
  mixed.feeds = [...mixed.feeds, ...mixed.sleeps.slice(1).map((s) => ({ startedAt: s.startedAt + 65 * 60_000, amountMl: 0 }))];
  assert.equal(computeNightPlan(mixed).slots.evening?.mode, "unknown");
});

test("midnight weight gate locks missing, stale, short or insufficient growth and unlocks at 70g/week", () => {
  const base = input([1, 1, 1, 1], [1, 1, 1, 1]);
  const latest = { measuredAt: now - DAY, weightG: 8000 };
  const earlier = { measuredAt: now - 8 * DAY, weightG: 7930 };
  for (const weights of [[], [latest], [latest, { ...earlier, measuredAt: now - 7 * DAY }], [latest, { ...earlier, weightG: 7940 }], [{ ...latest, measuredAt: now - 15 * DAY }, { ...earlier, measuredAt: now - 22 * DAY }]]) {
    const result = computeNightPlan({ ...base, weights });
    assert.equal(result.slots.midnight?.mode, "locked");
    assert.equal(result.slots.midnight?.tonightMl, 140);
    assert.equal(result.note, "weigh");
  }
  const result = computeNightPlan({ ...base, weights: [earlier, latest] });
  assert.equal(result.slots.midnight?.mode, "active");
  assert.equal(result.slots.midnight?.tonightMl, 120);
});

test("each pause reason returns no sizes or push", () => {
  const base = input();
  for (const [override, reason] of [
    [{ isSick: true }, "sick mode"],
    [{ feeds: base.feeds.filter((f) => f.amountMl !== 800) }, "milk below 700 ml on both previous days"],
    [{ weights: [{ measuredAt: now - DAY, weightG: 7900 }, { measuredAt: now - 8 * DAY, weightG: 8000 }] }, "weight has fallen"],
  ] as const) {
    const result = computeNightPlan({ ...base, ...override });
    assert.equal(result.status, "paused");
    assert.equal(result.reason, reason);
    assert.deepEqual(result.slots, {});
    assert.equal(nightPlanSummaryText(result), null);
  }
  assert.notEqual(computeNightPlan({ ...base, feeds: [] }).status, "paused");
  assert.notEqual(computeNightPlan({ ...base, feeds: [{ startedAt: now - DAY, amountMl: 100 }] }).status, "paused");
});

test("needs four completed recent nights, keeps seven at most and excludes ongoing nights", () => {
  const base = input();
  for (const sleeps of [base.sleeps.slice(0, 3), base.sleeps.map((s) => ({ ...s, startedAt: s.startedAt - 11 * DAY, endedAt: s.endedAt! - 11 * DAY })), [...base.sleeps.slice(0, 3), { ...base.sleeps[3], endedAt: null }]]) {
    const result = computeNightPlan({ ...base, sleeps });
    assert.equal(result.status, "not-enough-data");
    assert.deepEqual(result.slots, {});
    assert.equal(nightPlanSummaryText(result), null);
  }
  assert.equal(computeNightPlan({ ...base, sleeps: [...base.sleeps, { startedAt: now - 11 * DAY, endedAt: now - 10 * DAY }] }).slots.evening?.usualMl, 120);
  const eight = input([120, 120, 0, 0, 0, 0, 0, 0]);
  eight.sleeps = eight.sleeps.map((sleep) => ({ startedAt: sleep.startedAt - 4 * DAY, endedAt: sleep.endedAt! - 4 * DAY }));
  eight.feeds = eight.feeds.map((feed) => ({ ...feed, startedAt: feed.startedAt - 4 * DAY }));
  assert.equal(computeNightPlan(eight).slots.evening?.mode, "unknown", "eighth-oldest usable night cannot size a slot");
});

test("SGT slot boundaries and current night only after 30 minutes, open or just merged", () => {
  for (const [time, slot] of [["17:59", null], ["18:00", "evening"], ["23:59", "evening"], ["00:00", "midnight"], ["03:59", "midnight"], ["04:00", "early"], ["06:59", "early"], ["07:00", null]] as const) assert.equal(slotForTime(at("2026-11-12", time)), slot);
  const start = at("2026-11-11", "20:00");
  const sleeps = [{ startedAt: start, endedAt: null }];
  assert.equal(currentNightSlot({ sleeps, now }), null);
  assert.equal(currentNightSlot({ sleeps, now: start + 30 * 60_000 }), null);
  assert.equal(currentNightSlot({ sleeps, now: start + 31 * 60_000 }), "evening");
  assert.equal(currentNightSlot({ sleeps, now: at("2026-11-12", "01:00") }), "midnight");
  assert.equal(currentNightSlot({ sleeps: [], now: start + 3600_000 }), null);
  const closed = [{ startedAt: start, endedAt: start + 3600_000 }];
  assert.equal(currentNightSlot({ sleeps: closed, now: start + 64 * 60_000 }), "evening");
  assert.equal(currentNightSlot({ sleeps: closed, now: start + 66 * 60_000 }), null);
});

test("qualification shares bedtime exclusion and tiny feed rules; totals sum within slots", () => {
  const base = input();
  const extra = base.sleeps.flatMap((s) => [
    { startedAt: s.startedAt + 30 * 60_000, amountMl: 200 },
    { startedAt: s.startedAt + 70 * 60_000, amountMl: 20 },
    { startedAt: s.endedAt!, amountMl: 200 },
    { startedAt: s.startedAt + 80 * 60_000, amountMl: 5 },
  ]);
  assert.equal(computeNightPlan({ ...base, feeds: [...base.feeds, ...extra] }).slots.evening?.usualMl, 140);
});

test("milk day rolls at 07:00 and summary formats sizes, omissions and settle first", () => {
  const base = input([80, 80, 60, 60]);
  base.feeds = [...base.feeds, { startedAt: at("2026-11-12", "08:00"), amountMl: 540 }];
  const result = computeNightPlan(base);
  assert.equal(result.dayMilkMl, 540);
  assert.equal(nightPlanSummaryText(result, "Robin"), "Milk since 7am: 540 of 650 ml. Tonight: Evening: settle first · 01:00 140 ml · 05:00 100 ml.");
  assert.doesNotMatch(nightPlanSummaryText(plan([1, 1, 1, 1]))!, /Evening/);
  assert.equal(computeNightPlan({ ...base, now: at("2026-11-12", "06:59") }).dayMilkMl, 1100);
  assert.equal(computeNightPlan({ ...base, now: at("2026-11-12", "07:00") }).dayMilkMl, 0);
});
