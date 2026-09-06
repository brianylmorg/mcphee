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
  assert.equal((html.match(/font-display text-2xl/g) ?? []).length, 2);
});
