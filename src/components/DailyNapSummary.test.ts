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
  const sgt = (time: string) => Date.parse(`2026-10-05T${time}+08:00`);
  // A fixed 15:00 clock: woke at 07:00, then napped 09:00-12:40 (3h 40m).
  const sessions = [
    { startedAt: sgt("00:00:00") - 5 * hour, endedAt: sgt("07:00:00") },
    { startedAt: sgt("09:00:00"), endedAt: sgt("12:40:00") },
  ];
  const render = (maxDaytimeMs: number | null) => renderToStaticMarkup(createElement(DailyNapSummary, { sessions, maxDaytimeMs, initialNow: sgt("15:00:00") }));
  const near = render(4 * hour);
  assert.match(near, />3h 40m/);
  assert.match(near, /data-nap-total-status="near"/);
  assert.match(near, /Nearing the usual 4h 0m of daytime sleep/);
  assert.match(render(3.5 * hour), /data-nap-total-status="past"/);
  assert.doesNotMatch(render(5 * hour), /data-nap-total-status/);
  assert.doesNotMatch(render(null), /data-nap-total-status/);
});
