import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { NapZonesSummary } from "./NapZonesSummary";
import type { NapZone, NapZones } from "@/lib/sleep-windows";

const zone = (overrides: Partial<NapZone> = {}): NapZone => ({ count: 22, medianMs: 100 * 60 * 1000, fromMs: 93 * 60 * 1000, toMs: 112 * 60 * 1000, lookbackDays: 14, startMinute: 905, endMinute: 1020, ...overrides });
const empty: NapZones = { nap: {}, bedtime: null, bedtimeWindowStartMinute: null, dayCount: 0 };
function render(overrides: Partial<Parameters<typeof NapZonesSummary>[0]> = {}) {
  return renderToStaticMarkup(createElement(NapZonesSummary, { normal: empty, sick: empty, normalNaps: {}, sickNaps: {}, initialView: "usual", ageGuide: null, ageLabel: null, ...overrides }));
}

test("renders range and rounded clock details", () => {
  const html = render({ normal: { ...empty, nap: { 1: zone() } } });
  assert.match(html, /1h 33m – 1h 52m/);
  assert.match(html, /~15:00–17:00<\/span> · <span[^>]*>typical 1h 40m<\/span> · <span[^>]*>80% confidence/);
  assert.doesNotMatch(html, /n = |· 14 days/);
});

test("confidence drops when the zone had to reach further back", () => {
  const html = render({ normal: { ...empty, nap: { 1: zone({ lookbackDays: 28 }) } } });
  assert.match(html, />70% confidence</);
  assert.doesNotMatch(html, /28 days/);
});

test("omits toggle without sick data and defaults selected radio to usual", () => {
  assert.doesNotMatch(render(), /radiogroup/);
  const html = render({ sick: { ...empty, nap: { 1: zone() } } });
  assert.match(html, /Usual days<\/button>/);
  assert.match(html, /aria-checked="true"/);
  assert.match(html, /aria-checked="false"/);
});

test("initial sick view selects sick days", () => {
  const html = render({ sick: { ...empty, nap: { 1: zone() } }, initialView: "sick" });
  assert.match(html, /Sick days<\/button>/);
  assert.match(html, /aria-checked="true"[^>]*>Sick days/);
});

test("renders nap rows and empty block guidance", () => {
  const html = render({ normalNaps: { 1: zone() } });
  assert.match(html, /1st nap/);
  assert.match(html, /Not enough yet: a range needs at least 3 at that point in the day\./);
});
