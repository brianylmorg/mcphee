import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { ChildcareHandover } from "@/lib/childcare-handover";
import ChildcareHandoverCard, { type ChildcareHandoverCardProps } from "./ChildcareHandoverCard";

const NOW = Date.parse("2026-10-21T02:00:00Z"); // 10:00 SGT.

function render(props: Partial<ChildcareHandoverCardProps> = {}): string {
  const defaults: ChildcareHandoverCardProps = {
    babyName: "Aria",
    checkedInAt: Date.parse("2026-10-21T01:00:00Z"),
    handover: { bottle: null, diaper: null },
    dimmed: true,
    onToggleBrowse: () => {},
    now: NOW,
  };
  return renderToStaticMarkup(createElement(ChildcareHandoverCard, { ...defaults, ...props }));
}

test("renders the bottle time, elapsed age, milk, volume and note", () => {
  const handover: ChildcareHandover = {
    bottle: {
      at: Date.parse("2026-10-21T00:00:00Z"),
      milk: "Breast milk",
      volume: "120 ml",
      note: "Finished the bottle",
    },
    diaper: null,
  };
  const html = render({ handover });
  assert.ok(html.includes("08:00 · 2h 0m ago"));
  assert.ok(html.includes("Breast milk · 120 ml"));
  assert.ok(html.includes("Finished the bottle"));
});

test("renders the diaper pee and poo line", () => {
  const html = render({ handover: { bottle: null, diaper: {
    at: Date.parse("2026-10-21T01:30:00Z"), pee: "Pee 3 units", poo: "Poo M", note: "",
  } } });
  assert.ok(html.includes("Pee 3 units · Poo M"));
});

test("adds a date prefix for a handover from the previous Singapore day", () => {
  const html = render({ handover: { bottle: {
    at: Date.parse("2026-10-20T15:40:00Z"), milk: "Formula", volume: "90 ml", note: "",
  }, diaper: null } });
  assert.ok(html.includes("20 Oct, 23:40"));
});

test("shows the empty state for both handover rows", () => {
  const html = render();
  assert.equal((html.match(/None logged yet/g) ?? []).length, 2);
});

test("toggle label and pressed state follow dimmed state", () => {
  const dimmed = render({ dimmed: true });
  assert.match(dimmed, /aria-pressed="false"/);
  assert.ok(dimmed.includes("Browse anyway"));
  const browsing = render({ dimmed: false });
  assert.match(browsing, /aria-pressed="true"/);
  assert.ok(browsing.includes("Grey out again"));
});

test("keeps childcare-dim-banner on the root section", () => {
  assert.match(render(), /<section aria-label="Childcare summary" class="childcare-dim-banner[^>]*>/);
});
