import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NightPlanSummary } from "./NightPlanSummary";
import type { NightPlan } from "@/lib/night-plan";

const base: NightPlan = { status: "ready", activeSlot: "evening", dayMilkMl: 540, dayTargetMl: 650,
  slots: { evening: { mode: "active", tonightMl: 40 }, midnight: { mode: "usual", tonightMl: 140 }, early: { mode: "usual", tonightMl: 100 } } };
const render = (override: Partial<NightPlan> = {}) => renderToStaticMarkup(createElement(NightPlanSummary, { plan: { ...base, ...override } }));

test("compact plan includes tonight sizes and the feed-on-demand reminder with no controls", () => {
  const html = render();
  assert.match(html, /<h3[^>]*>Night plan<\/h3>/);
  assert.match(html, /Shrinking the evening feed/);
  assert.match(html, /Tonight: Evening 40 ml · 01:00 140 ml · 05:00 100 ml/);
  assert.match(html, /Always feed him if he will not settle. A size drops 20 ml after two nights at or under it./);
  assert.doesNotMatch(html, /<button|<input/);
});

test("paused and not-enough-data states have no sizes", () => {
  const paused = render({ status: "paused", reason: "sick mode", slots: {} });
  assert.match(paused, /Paused: sick mode. Feed on demand./);
  assert.doesNotMatch(paused, /Tonight:/);
  assert.match(render({ status: "not-enough-data", slots: {} }), /Needs 4 logged nights./);
});

test("settle, locked, unknown and all gone states", () => {
  assert.match(render({ slots: { evening: { mode: "settle-first", tonightMl: 0 } } }), /Evening feed: settle first, feed if he will not settle/);
  assert.match(render({ activeSlot: "midnight", slots: { midnight: { mode: "locked", tonightMl: 140 } } }), /Weigh him to start on the 01:00 feed/);
  const unknown = render({ slots: { evening: { mode: "unknown" } } });
  assert.match(unknown, /Log bottle amounts to size the evening feed/);
  assert.doesNotMatch(unknown, /Tonight:|undefined|NaN/);
  assert.match(render({ activeSlot: null, slots: {} }), /All night feeds gone/);
});
