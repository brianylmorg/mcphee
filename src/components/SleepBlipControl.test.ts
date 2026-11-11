import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { SleepBlipControl } from "./SleepBlipControl";
import type { SleepBlip } from "@/lib/sleep-blips";

const NOW = Date.parse("2026-11-10T02:00:00+08:00");
const MIN = 60_000;
const render = (blips: SleepBlip[]) => renderToStaticMarkup(createElement(SleepBlipControl, {
  blips, disabled: false, onStart: () => {}, onStop: () => {}, initialNow: NOW,
}));

test("with no blips it offers one Blip button", () => {
  const html = render([]);
  assert.match(html, /aria-label="Start a blip \(crying in his sleep\)"/);
  assert.match(html, /No blips this sleep/);
  assert.doesNotMatch(html, /Settled himself/);
});

test("it totals finished blips for this sleep", () => {
  const html = render([
    { startedAt: NOW - 60 * MIN, endedAt: NOW - 56 * MIN },
    { startedAt: NOW - 30 * MIN, endedAt: NOW - 28 * MIN },
  ]);
  assert.match(html, /2 blips · 6m this sleep/);
});

test("an open blip shows its timer and the two ways it can end", () => {
  const html = render([{ startedAt: NOW - 83_000, endedAt: null }]);
  assert.match(html, /data-blip="open"/);
  assert.match(html, />1:23</);
  assert.match(html, />Settled himself</);
  assert.match(html, />We settled him</);
  assert.doesNotMatch(html, /Start a blip/);
});
