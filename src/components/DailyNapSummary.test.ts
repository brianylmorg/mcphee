import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { DailyNapSummary } from "./DailyNapSummary";

test("nap summary exposes its waiting state and accessible calculation details", () => {
  const html = renderToStaticMarkup(createElement(DailyNapSummary, { sessions: [] }));

  assert.match(html, />Naps today</);
  assert.match(html, />Waiting for morning wake</);
  assert.match(html, />0h 00mins</);
  assert.match(html, /aria-label="How naps today is calculated"/);
  assert.match(html, /aria-expanded="false"/);
  assert.match(html, /aria-controls="[^"]+"/);
  assert.match(html, /hidden=""[^>]*>Singapore time:/);
});
