import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { SleepStateControl } from "./SleepStateControl";

test("awake fills the toggle with the current state, its timer and a switch to sleep", () => {
  const html = renderToStaticMarkup(createElement(SleepStateControl, {
    state: "awake",
    elapsedLabel: "1:20",
    disabled: false,
    onSelect: () => undefined,
  }));

  assert.match(html, /data-state="awake"/);
  assert.match(html, />Awake</);
  assert.equal((html.match(/>1:20</g) ?? []).length, 1);
  // One action: switch to the other state.
  assert.equal((html.match(/<button/g) ?? []).length, 1);
  assert.match(html, /aria-label="Set state to Sleeping"/);
  assert.match(html, />Sleep</);
  assert.doesNotMatch(html, /aria-label="Set state to Awake"/);
});

test("sleeping offers a wake-up switch and keeps the timer", () => {
  const html = renderToStaticMarkup(createElement(SleepStateControl, { state: "sleeping", elapsedLabel: "0:42", disabled: true, onSelect: () => undefined }));
  assert.match(html, /data-state="sleeping"/);
  assert.match(html, />Sleeping</);
  assert.match(html, />0:42</);
  assert.match(html, /aria-label="Set state to Awake"[^>]*disabled=""/);
  assert.match(html, />Wake up</);
});

test("both scenes stay mounted (for the crossfade) and are hidden from assistive tech", () => {
  const html = renderToStaticMarkup(createElement(SleepStateControl, { state: "awake", elapsedLabel: "0:05", disabled: false, onSelect: () => undefined }));
  assert.match(html, /aria-hidden="true" class="sleep-scene sleep-scene-day"/);
  assert.match(html, /aria-hidden="true" class="sleep-scene sleep-scene-night"/);
  assert.match(html, /class="sb-sun-arc sb-pos"/);
  assert.match(html, /class="sb-moon-arc sb-pos"/);
  assert.match(html, /sb-bee-path/);
  assert.equal((html.match(/sb-bee-frame /g) ?? []).length, 2);
  assert.equal((html.match(/sb-star-twinkle/g) ?? []).length, 6);
  // Painted layers are decorative: empty alt text.
  assert.ok((html.match(/<img /g) ?? []).length > 10);
  assert.doesNotMatch(html, /<img [^>]*alt="[^"]/);
});

test("an untimed state shows the hint in small text", () => {
  const html = renderToStaticMarkup(createElement(SleepStateControl, { state: "awake", since: null, disabled: false, onSelect: () => undefined }));
  assert.match(html, /mt-0\.5 text-sm[^"]*">Not timed yet</);
});
