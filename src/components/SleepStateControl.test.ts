import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { SleepStateControl } from "./SleepStateControl";

test("sleep control exposes both states with the timer inside the pressed segment", () => {
  const html = renderToStaticMarkup(createElement(SleepStateControl, {
    state: "awake",
    elapsedLabel: "1:20",
    disabled: false,
    onSelect: () => undefined,
  }));

  assert.match(html, />Awake</);
  assert.match(html, />Sleeping</);
  assert.match(html, /aria-label="Set state to Awake"[^>]*aria-pressed="true"/);
  assert.match(html, /aria-label="Set state to Sleeping"[^>]*aria-pressed="false"/);
  // The timer lives in the active segment only; there is no second "Awake" heading.
  assert.equal((html.match(/>1:20</g) ?? []).length, 1);
  assert.equal((html.match(/>Awake</g) ?? []).length, 1);
  const awakeButton = html.slice(html.indexOf('aria-label="Set state to Awake"'), html.indexOf('aria-label="Set state to Sleeping"'));
  assert.match(awakeButton, />1:20</);
  assert.equal((html.match(/min-h-14/g) ?? []).length, 2);
  assert.match(html, /data-state="awake"/);
  assert.match(html, /transform:translateX\(0\)/);
  assert.match(html, /motion-reduce:transition-none/);
});

test("both decorative scenes render hidden from assistive tech", () => {
  const html = renderToStaticMarkup(createElement(SleepStateControl, { state: "awake", elapsedLabel: "0:05", disabled: false, onSelect: () => undefined }));
  assert.match(html, /aria-hidden="true" class="sleep-scene sleep-scene-day"/);
  assert.match(html, /aria-hidden="true" class="sleep-scene sleep-scene-night"/);
  assert.equal((html.match(/sleep-cloud sleep-cloud-/g) ?? []).length, 3);
  assert.equal((html.match(/sleep-star sleep-star-/g) ?? []).length, 6);
  assert.match(html, /class="sleep-sun"/);
  assert.match(html, /class="sleep-moon"/);
});

test("sleeping control keeps the pressed state, timer and sliding animation", () => {
  const html = renderToStaticMarkup(createElement(SleepStateControl, { state: "sleeping", elapsedLabel: "0:42", disabled: true, onSelect: () => undefined }));
  assert.match(html, /aria-label="Set state to Sleeping"[^>]*aria-pressed="true"[^>]*disabled=""/);
  assert.match(html, /data-state="sleeping"/);
  assert.match(html, /translateX\(calc\(100% \+ 0.25rem\)\)/);
  const sleepingButton = html.slice(html.indexOf('aria-label="Set state to Sleeping"'));
  assert.match(sleepingButton, />0:42</);
});

test("care overview uses the compact single-line toggle with the timer inline", () => {
  const html = renderToStaticMarkup(createElement(SleepStateControl, { state: "sleeping", compact: true, elapsedLabel: "1:02:03", disabled: true, onSelect: () => undefined }));
  assert.match(html, /data-compact="true"/);
  assert.match(html, /aria-label="Set state to Sleeping"[^>]*aria-pressed="true"[^>]*disabled=""/);
  assert.match(html, />1:02:03</);
  assert.equal((html.match(/min-h-9/g) ?? []).length, 2);
});
