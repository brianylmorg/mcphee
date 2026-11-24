import assert from "node:assert/strict";
import test from "node:test";

import { isQuietHours, planPushes, type PushMedication, type PushPlanInput } from "./push-plan";
import type { NapHint } from "./sleep-windows";

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const at = (sgt: string) => Date.parse(`2026-11-22T${sgt}:00+08:00`);

function input(overrides: Partial<PushPlanInput> = {}): PushPlanInput {
  return {
    now: at("10:00"),
    babyName: "Robin",
    asleep: false,
    atChildcare: false,
    feedInProgress: false,
    lastFeed: null,
    napHint: null,
    awakeSince: null,
    medications: [],
    ...overrides,
  };
}

function hint(overrides: Partial<NapHint> = {}): NapHint {
  return { status: "before", untilMs: 8 * MIN, fromMs: 2 * HOUR, toMs: 2.5 * HOUR, medianMs: null, source: "own", leadsTo: "nap", index: 2, ...overrides };
}

function med(overrides: Partial<PushMedication> = {}): PushMedication {
  return {
    id: "m1",
    name: "Paracetamol",
    doseText: "3.5 ml",
    asNeeded: false,
    minIntervalHours: 6,
    maxIntervalHours: null,
    latestDose: { id: "d1", givenAt: at("08:00"), givenBy: "Alex" },
    ...overrides,
  };
}

test("quiet hours run 20:00 to 07:00 SGT", () => {
  assert.equal(isQuietHours(at("19:59")), false);
  assert.equal(isQuietHours(at("20:00")), true);
  assert.equal(isQuietHours(at("03:00")), true);
  assert.equal(isQuietHours(at("06:59")), true);
  assert.equal(isQuietHours(at("07:00")), false);
});

test("nap push fires within 10 minutes of the zone, once per wake window", () => {
  const awakeSince = at("08:08");
  const [push] = planPushes(input({ napHint: hint(), awakeSince }));
  assert.equal(push.key, `nap:${awakeSince}`);
  assert.equal(push.title, "Nap zone in 8m");
  assert.match(push.body, /awake since 08:08\. He usually sleeps 2h00–2h30 after waking\./);

  assert.deepEqual(planPushes(input({ napHint: hint({ untilMs: 11 * MIN }), awakeSince })), []);
  assert.equal(planPushes(input({ napHint: hint({ status: "in", untilMs: 0 }), awakeSince }))[0].title, "Nap zone now");
  assert.equal(planPushes(input({ napHint: hint({ leadsTo: "bedtime" }), awakeSince }))[0].title, "Bedtime zone in 8m");
});

test("nap push skips stale, age-guide, childcare, asleep and night cases", () => {
  const awakeSince = at("08:08");
  assert.deepEqual(planPushes(input({ napHint: hint({ status: "past", untilMs: 0 }), awakeSince })), []);
  assert.deepEqual(planPushes(input({ napHint: hint({ source: "age" }), awakeSince })), []);
  assert.deepEqual(planPushes(input({ napHint: hint(), awakeSince, atChildcare: true })), []);
  assert.deepEqual(planPushes(input({ napHint: hint(), awakeSince, asleep: true })), []);
  assert.deepEqual(planPushes(input({ napHint: hint(), awakeSince, now: at("20:30") })), []);
});

test("feed push follows the dashboard milk hint: due at 2h45, past at 3h30, gone at 8h", () => {
  const lastFeed = { id: "f1", startedAt: at("07:00") };
  assert.deepEqual(planPushes(input({ lastFeed, now: at("09:44") })), []);
  const [due] = planPushes(input({ lastFeed, now: at("09:45") }));
  assert.equal(due.key, "feed:f1");
  assert.equal(due.title, "Milk time");
  assert.equal(due.body, "Robin's last feed was at 07:00, 2h45 ago.");
  assert.equal(planPushes(input({ lastFeed, now: at("10:30") }))[0].title, "Past milk time");
  assert.deepEqual(planPushes(input({ lastFeed, now: at("15:00") })), []);
});

test("feed push stays quiet at night, while asleep, at childcare and during a breastfeed", () => {
  const lastFeed = { id: "f1", startedAt: at("17:30") };
  assert.deepEqual(planPushes(input({ lastFeed, now: at("20:30") })), []);
  const day = { id: "f2", startedAt: at("07:00") };
  assert.deepEqual(planPushes(input({ lastFeed: day, asleep: true })), []);
  assert.deepEqual(planPushes(input({ lastFeed: day, atChildcare: true })), []);
  assert.deepEqual(planPushes(input({ lastFeed: day, feedInProgress: true })), []);
});

test("a scheduled medication pushes when due, then once more 30 minutes later", () => {
  assert.deepEqual(planPushes(input({ medications: [med()], now: at("13:59") })), []);
  const [due] = planPushes(input({ medications: [med()], now: at("14:00") }));
  assert.equal(due.key, "med:m1:d1:due");
  assert.equal(due.tag, "med:m1");
  assert.equal(due.title, "Paracetamol due");
  assert.equal(due.body, "3.5 ml. Last given at 08:00 by Alex.");
  const [late] = planPushes(input({ medications: [med()], now: at("14:30") }));
  assert.equal(late.key, "med:m1:d1:late");
  assert.equal(late.title, "Paracetamol overdue");
  assert.equal(late.body, "3.5 ml. Due since 14:00. Last given at 08:00 by Alex.");
});

test("a latest interval sets the overdue push instead of 30 minutes", () => {
  const ranged = med({ minIntervalHours: 6, maxIntervalHours: 8 });
  assert.equal(planPushes(input({ medications: [ranged], now: at("15:00") }))[0].key, "med:m1:d1:due");
  assert.equal(planPushes(input({ medications: [ranged], now: at("16:00") }))[0].key, "med:m1:d1:late");
});

test("medication pushes run at night and at childcare", () => {
  const night = med({ latestDose: { id: "d1", givenAt: at("17:00"), givenBy: null } });
  const [push] = planPushes(input({ medications: [night], now: at("23:05"), asleep: true, atChildcare: true }));
  assert.equal(push.key, "med:m1:d1:due");
  assert.equal(push.body, "3.5 ml. Last given at 17:00.");
});

test("as-needed, undosed and stale medications never push", () => {
  assert.deepEqual(planPushes(input({ medications: [med({ asNeeded: true, minIntervalHours: 4 })], now: at("14:00") })), []);
  assert.deepEqual(planPushes(input({ medications: [med({ latestDose: null })], now: at("14:00") })), []);
  assert.deepEqual(planPushes(input({ medications: [med()], now: at("14:30") + 12 * HOUR + MIN })), []);
});
