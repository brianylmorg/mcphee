import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import RecentBottleFeeds from "./RecentBottleFeeds";
import { formatDate, formatTime } from "@/lib/utils";

test("latest feeds retain three records, dates and clearly separated elapsed labels", () => {
  const now = Date.now();
  const feeds = [90, 40, 50].map((amountMl, index) => ({
    id: `feed-${index}`,
    startedAt: now - (24 + index) * 60 * 60 * 1000,
    amountMl,
  }));
  const html = renderToStaticMarkup(createElement(RecentBottleFeeds, { feeds }));
  assert.match(html, />Latest feeds<\/p>/);
  assert.equal((html.match(/aria-label="\d+ ml consumed"/g) ?? []).length, 3);
  assert.equal((html.match(/aria-hidden="true">· <\/span>/g) ?? []).length, 3);
  for (const feed of feeds) {
    assert.ok(html.includes(formatDate(feed.startedAt)));
    assert.ok(html.includes(formatTime(feed.startedAt)));
    assert.ok(html.includes(`${feed.amountMl} ml</span>`));
  }
  assert.match(html, /font-semibold tabular-nums text-muted/);
  assert.doesNotMatch(html, /font-semibold[^"<>]*"[^>]*>90 ml/);
});

test("latest feeds explicitly state when no feeds have been logged", () => {
  const html = renderToStaticMarkup(createElement(RecentBottleFeeds, { feeds: [] }));
  assert.match(html, /No bottle feeds logged yet/);
});
