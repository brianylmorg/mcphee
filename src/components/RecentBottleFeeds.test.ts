import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import RecentBottleFeeds from "./RecentBottleFeeds";
import { formatDate, formatTime } from "@/lib/utils";

test("latest feeds keep three records behind a closed native disclosure", () => {
  const now = Date.now();
  const feeds = [90, 40, 50].map((amountMl, index) => ({
    id: `feed-${index}`,
    startedAt: now - (24 + index) * 60 * 60 * 1000,
    amountMl,
  }));
  const html = renderToStaticMarkup(createElement(RecentBottleFeeds, { feeds }));
  // Native <details> is the disclosure and starts closed (no `open` attribute).
  assert.match(html, /<details[^>]*data-latest-entries="true"/);
  assert.doesNotMatch(html, /<details[^>]*\bopen/);
  assert.match(html, /<summary[^>]*>[\s\S]*Latest feeds[\s\S]*<\/summary>/);
  assert.match(html, /data-latest-entries-content="true"/);
  assert.equal((html.match(/data-feed-row=/g) ?? []).length, 3);
  // Rendering formats the JSX values as text, never as literal markup.
  assert.doesNotMatch(html, /\[object Object\]/);
  for (const feed of feeds) {
    assert.ok(html.includes(formatDate(feed.startedAt)));
    assert.ok(html.includes(formatTime(feed.startedAt)));
    assert.ok(html.includes(`${feed.amountMl} ml</span>`));
  }
  // Timestamp and elapsed read stronger than the volume value.
  assert.match(html, /latest-entries-elapsed[^"]*font-semibold/);
  assert.doesNotMatch(html, /latest-entries-amount[^"]*font-semibold/);
  assert.doesNotMatch(html, /pr-12|sm:pr-0/);
});

test("latest feeds explicitly state when no feeds have been logged", () => {
  const html = renderToStaticMarkup(createElement(RecentBottleFeeds, { feeds: [] }));
  assert.match(html, /No bottle feeds logged yet/);
  assert.match(html, /latest-entries-title/);
  assert.doesNotMatch(html, /data-feed-row=/);
});

test("latest feeds bound the history at three for empty through larger inputs", () => {
  const now = Date.now();
  const makeFeeds = (count: number) =>
    Array.from({ length: count }, (_, index) => ({
      id: `feed-${index}`,
      startedAt: now - index * 60 * 60 * 1000,
      amountMl: 100 + index,
    }));

  for (const count of [1, 2, 3, 4, 5]) {
    const html = renderToStaticMarkup(createElement(RecentBottleFeeds, { feeds: makeFeeds(count) }));
    assert.equal(
      (html.match(/data-feed-row=/g) ?? []).length,
      Math.min(count, 3),
      `feed history rows for ${count} feeds`,
    );
    // The newest entry is always present in the collapsed summary.
    assert.match(html, /<summary[^>]*>[\s\S]*Latest feeds[\s\S]*<\/summary>/);
    assert.match(html, /latest-entries-newest/);
  }
});
