import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { DailyNapSummary } from "./DailyNapSummary";

test("nap summary exposes its waiting state and accessible calculation details", () => {
  const html = renderToStaticMarkup(createElement(DailyNapSummary, { sessions: [] }));

  assert.match(html, />Naps today</);
  assert.match(html, />Waiting for morning wake</);
  assert.match(html, />0h 0m</);
  assert.match(html, /aria-label="How naps today is calculated"/);
  assert.match(html, /aria-expanded="false"/);
  assert.match(html, /aria-controls="[^"]+"/);
  assert.match(html, /hidden=""[^>]*>Singapore time:/);
});

test("nap summary can host an accessible inline sleep-start edit action", () => {
  const html = renderToStaticMarkup(createElement(DailyNapSummary, { sessions: [], trailingAction: createElement("button", { type: "button", "aria-label": "Edit sleep start" }, "Edit") }));
  assert.match(html, /aria-label="Edit sleep start"/);
  assert.match(html, /How naps today is calculated/);
  assert.match(html, />Naps today</);
});
