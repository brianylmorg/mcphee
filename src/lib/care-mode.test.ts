import assert from "node:assert/strict";
import test from "node:test";
import { CARE_MODE_EVENT, isCareModeUpdate, publishCareMode } from "./care-mode";

test("care-theme updates require explicit household, baby, and confirmed boolean state", () => {
  assert.equal(isCareModeUpdate({ householdId: "home", babyId: "baby", active: true }), true);
  assert.equal(isCareModeUpdate({ householdId: "home", babyId: "baby", active: false }), true);
  for (const value of [null, true, {}, { householdId: "", babyId: "baby", active: true }, { householdId: "home", babyId: "", active: true }, { householdId: "home", babyId: "baby", active: "false" }]) {
    assert.equal(isCareModeUpdate(value), false);
  }
});

test("publishing a confirmed care state preserves its scope and end state", () => {
  const previousWindow = globalThis.window;
  const events: Event[] = [];
  Object.assign(globalThis, { window: { dispatchEvent: (event: Event) => { events.push(event); return true; } } });
  try {
    const update = { householdId: "home", babyId: "baby", active: false };
    publishCareMode(update);
    assert.equal(events[0].type, CARE_MODE_EVENT);
    assert.deepEqual((events[0] as CustomEvent).detail, update);
  } finally {
    if (previousWindow) Object.assign(globalThis, { window: previousWindow });
    else Reflect.deleteProperty(globalThis, "window");
  }
});
