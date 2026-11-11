import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { NightBlipsSummary } from "./NightBlipsSummary";
import type { NightBlipSummary } from "@/lib/sleep-blips";

const night = (overrides: Partial<NightBlipSummary> = {}): NightBlipSummary => ({
  date: "2026-11-09", startedAt: 0, endedAt: 1, blipCount: 0, blipMs: 0,
  selfSettled: 0, settledByUs: 0, becameWake: 0, wakeCount: 0, longestStretchMs: 0, blips: [],
  ...overrides,
});
function render(nights: NightBlipSummary[] = []) {
  return renderToStaticMarkup(createElement(NightBlipsSummary, { nights }));
}

test("renders the empty state", () => {
  const html = render();
  assert.match(html, /Night blips/);
  assert.match(html, /No nights logged yet\./);
  assert.doesNotMatch(html, /Last .* nights:/);
});

test("uses singular and plural blip wording", () => {
  const html = render([night({ blipCount: 1, blipMs: 60_000 }), night({ date: "2026-11-08", blipCount: 3, blipMs: 12 * 60_000 })]);
  assert.match(html, />1 blip · 1m/);
  assert.match(html, />3 blips · 12m/);
});

test("marks an open night as tonight", () => {
  assert.match(render([night({ endedAt: null })]), /Mon 9 Nov · tonight/);
});

test("compares the last three completed nights with the three before", () => {
  const nights = [3, 2, 1, 4, 3, 2].map((count, index) => night({ date: `2026-11-${String(9 - index).padStart(2, "0")}`, blipCount: count }));
  assert.match(render(nights), /Last 3 nights: 2\.0 blips a night, down from 3\.0\./);
});

test("omits zero detail parts", () => {
  const html = render([night({ blipCount: 0, longestStretchMs: 0 })]);
  assert.doesNotMatch(html, /<span class="whitespace-nowrap">(?:longest|\d+ settled himself|\d+ by us|\d+ woke|\d+ wakes?)/);
});

test("renders nonzero detail parts and pluralizes wakes", () => {
  const html = render([night({ blipCount: 2, selfSettled: 1, settledByUs: 2, becameWake: 1, wakeCount: 2, longestStretchMs: 60_000 })]);
  assert.match(html, /longest 1m asleep/);
  assert.match(html, /1 settled himself/);
  assert.match(html, /2 by us/);
  assert.match(html, /1 woke/);
  assert.match(html, /2 wakes/);
});

test("an ongoing first night gets no NaN headline, and one finished night reads singular", () => {
  const base = { blipMs: 0, selfSettled: 0, settledByUs: 0, becameWake: 0, wakeCount: 0, longestStretchMs: 3_600_000, blips: [] };
  const open = renderToStaticMarkup(createElement(NightBlipsSummary, { nights: [{ ...base, date: "2026-11-09", startedAt: 1, endedAt: null, blipCount: 0 }] }));
  assert.doesNotMatch(open, /NaN/);
  const one = renderToStaticMarkup(createElement(NightBlipsSummary, { nights: [{ ...base, date: "2026-11-09", startedAt: 1, endedAt: 2, blipCount: 1 }] }));
  assert.match(one, /Last night: 1 blip\./);
  assert.doesNotMatch(one, /1 nights/);
});
