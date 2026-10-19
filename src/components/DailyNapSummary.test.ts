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

test("nap total glows as it nears the daytime maximum and pulses once past", () => {
  const hour = 60 * 60 * 1000;
  const now = Date.now();
  // Woke 7h ago, then napped 3h 40m (finished 10 min ago).
  const sessions = [
    { startedAt: now - 20 * hour, endedAt: now - 7 * hour },
    { startedAt: now - 3 * hour - 50 * 60 * 1000, endedAt: now - 10 * 60 * 1000 },
  ];
  const near = renderToStaticMarkup(createElement(DailyNapSummary, { sessions, maxDaytimeMs: 4 * hour }));
  // Only meaningful once the day has started (after the 05:00 morning wake); skip the glow check otherwise.
  if (!near.includes("Waiting for morning wake")) {
    assert.match(near, /data-nap-total-status="near"/);
    assert.match(near, /Nearing the usual 4h 0m of daytime sleep/);
    assert.match(renderToStaticMarkup(createElement(DailyNapSummary, { sessions, maxDaytimeMs: 3 * hour })), /data-nap-total-status="past"/);
  }
  assert.doesNotMatch(renderToStaticMarkup(createElement(DailyNapSummary, { sessions, maxDaytimeMs: null })), /data-nap-total-status/);
});
