import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Milk } from "lucide-react";

import ActivityTimelineCard from "./ActivityTimelineCard";

test("activity card consolidates into a compact two-line summary", () => {
  const html = renderToStaticMarkup(
    createElement(ActivityTimelineCard, {
      icon: Milk,
      title: "Bottlefeed",
      when: "10:30 hrs",
      elapsed: "1h 5m ago",
      subcategory: "Formula",
      quantity: "120 ml",
      comment: "A complete feed comment must stay visible.",
      createdBy: "Preview tester",
      onEdit: () => {},
      onDelete: () => {},
    }),
  );

  assert.match(html, /data-activity-card/);
  // Row uses 14px title + 12px metadata tokens, not brittle full class chains.
  assert.match(html, /text-sm/);
  assert.match(html, /text-xs/);
  assert.match(html, />Bottlefeed</);
  assert.match(html, />120 ml</);
  assert.match(html, /10:30 hrs · 1h 5m ago/);
  assert.match(html, />Formula</);
  assert.match(html, /A complete feed comment must stay visible\./);
  assert.match(html, /Entered by Preview tester/);
  // Edit + delete are separate actions; delete keeps its derived label.
  assert.equal((html.match(/<button/g) ?? []).length, 2);
  assert.match(html, /aria-label="Delete bottlefeed activity"/);
});

test("activity card keeps full note text and comments without clamping", () => {
  const note =
    "Full note text, never replaced by a generic Note title.\nThis second line should remain visible in the activity diary.";
  const html = renderToStaticMarkup(
    createElement(ActivityTimelineCard, {
      icon: Milk,
      title: note,
      when: "10:30 hrs",
      elapsed: "2m ago",
      multiline: true,
      comment: "Trailing comment stays visible.",
      onEdit: () => {},
      onDelete: () => {},
    }),
  );

  assert.ok(html.includes("Full note text, never replaced by a generic Note title."));
  assert.ok(html.includes("This second line should remain visible in the activity diary."));
  assert.match(html, /whitespace-pre-wrap/);
  assert.doesNotMatch(html, /line-clamp/);
  // Multiline notes must not be truncated to a single line.
  assert.doesNotMatch(html, /truncate/);
  assert.match(html, /Trailing comment stays visible\./);
});
