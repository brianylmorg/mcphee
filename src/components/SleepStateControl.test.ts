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
  // The other state peeks in on the right as the single action.
  assert.equal((html.match(/<button/g) ?? []).length, 1);
  assert.match(html, /data-scene="awake" data-role="current"/);
  assert.match(html, /data-scene="sleeping" data-role="peek"/);
  assert.match(html, /aria-label="Set state to Sleeping"/);
  assert.match(html, />Sleep</);
  assert.doesNotMatch(html, /aria-label="Set state to Awake"/);
});

test("sleeping offers a wake-up switch and keeps the timer", () => {
  const html = renderToStaticMarkup(createElement(SleepStateControl, { state: "sleeping", elapsedLabel: "0:42", disabled: true, onSelect: () => undefined }));
  assert.match(html, /data-state="sleeping"/);
  assert.match(html, />Sleeping</);
  assert.match(html, />0:42</);
  assert.match(html, /data-scene="sleeping" data-role="current"/);
  assert.match(html, /data-scene="awake" data-role="peek"/);
  assert.match(html, /aria-label="Set state to Awake"[^>]*disabled=""/);
  assert.match(html, />Wake up</);
});

test("both scenes stay mounted (for the carousel) and are hidden from assistive tech", () => {
  const html = renderToStaticMarkup(createElement(SleepStateControl, { state: "awake", elapsedLabel: "0:05", disabled: false, onSelect: () => undefined }));
  assert.equal((html.match(/aria-hidden="true" class="sleep-scene"/g) ?? []).length, 2);
  assert.match(html, /sb-painted-day/);
  assert.match(html, /sb-painted-night/);
  assert.match(html, /class="sb-sun-arc sb-pos"/);
  assert.match(html, /class="sb-moon-arc sb-pos"/);
  // He runs the meadow chasing a bee by day, and sleeps on the hill at night.
  assert.equal((html.match(/src="\/storybook\/bee-up\.webp"/g) ?? []).length, 1);
  assert.match(html, /class="sb-kid-runner"/);
  assert.match(html, /kid-run\.webp/);
  assert.match(html, /class="sb-kid-bee"/);
  assert.match(html, /kid-sleep\.webp/);
  assert.equal((html.match(/sb-star-twinkle/g) ?? []).length, 6);
  // Painted layers are decorative: empty alt text.
  assert.ok((html.match(/<img /g) ?? []).length > 10);
  assert.doesNotMatch(html, /<img [^>]*alt="[^"]/);
});

test("an untimed state shows the hint in small text", () => {
  const html = renderToStaticMarkup(createElement(SleepStateControl, { state: "awake", since: null, disabled: false, onSelect: () => undefined }));
  assert.match(html, /mt-0\.5 text-sm[^"]*">Not timed yet</);
});
