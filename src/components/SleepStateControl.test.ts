import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { SleepStateControl } from "./SleepStateControl";

test("sleep control exposes both states with the current segment pressed", () => {
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
  assert.equal((html.match(/font-display text-xl/g) ?? []).length, 2);
  assert.equal((html.match(/min-h-10/g) ?? []).length, 2);
  assert.match(html, /data-state="awake"/);
  assert.match(html, /transform:translateX\(0\)/);
  assert.match(html, /motion-reduce:transition-none/);
});

test("compact sleeping control keeps the pressed state, timer and sliding animation", () => {
  const html = renderToStaticMarkup(createElement(SleepStateControl, { state: "sleeping", elapsedLabel: "0:42", disabled: true, onSelect: () => undefined }));
  assert.match(html, /aria-label="Set state to Sleeping"[^>]*aria-pressed="true"[^>]*disabled=""/);
  assert.match(html, /data-state="sleeping"/);
  assert.match(html, /translateX\(calc\(100% \+ 0.25rem\)\)/);
  assert.match(html, />0:42</);
  assert.equal((html.match(/min-h-10/g) ?? []).length, 2);
});

test("care overview places the live timer beside the compact animated toggle", () => {
  const html = renderToStaticMarkup(createElement(SleepStateControl, { state: "sleeping", compact: true, elapsedLabel: "1:02:03", disabled: true, onSelect: () => undefined }));
  assert.match(html, /data-compact="true"/);
  assert.match(html, /sleep-control-compact flex items-center/);
  assert.match(html, /aria-label="Set state to Sleeping"[^>]*aria-pressed="true"[^>]*disabled=""/);
  assert.match(html, /translateX\(calc\(100% \+ 0.25rem\)\)/);
  assert.match(html, />1:02:03</);
  assert.equal((html.match(/min-h-8/g) ?? []).length, 2);
  assert.match(html, /aria-live="polite"/);
});
