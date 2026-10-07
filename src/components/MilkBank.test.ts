import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { MilkBank } from "./MilkBank";

test("milk bank separates Available and Frozen and blocks thaw for expired packets", () => {
  const html = renderToStaticMarkup(createElement(MilkBank, {
    babyId: "baby-1",
    availableMl: 120,
    availableBatches: [],
    frozenMl: 80,
    frozenPackets: [{
      id: "old-packet", amountMl: 80, frozenAt: 100, expiresAt: 200, isExpired: true,
      status: "frozen", closedAt: null,
    }],
    history: [{ id: "old-packet", eventType: "Freeze", amountMl: 80, at: 100, packetId: "old-packet" }],
    onChanged: async () => undefined,
  }));

  assert.match(html, /Available/);
  assert.match(html, />120<\/span>\s*<span[^>]*>ml/);
  assert.match(html, /Frozen/);
  assert.match(html, /aria-expanded="false"/);
  assert.match(html, /aria-controls="frozen-bank-details"/);
  assert.match(html, /id="frozen-bank-details" hidden=""/);
  assert.doesNotMatch(html, /20 ml expired/);
  assert.match(html, /Expired/);
  assert.match(html, /Discard/);
  assert.doesNotMatch(html, />Correct<\/button>/);
  assert.match(html, /aria-label="Edit 80 ml packet"/);
  assert.match(html, /aria-label="Delete 80 ml packet"/);
  assert.doesNotMatch(html, /aria-label="Thaw 80 ml packet"/);
  assert.match(html, /Bank history/);
  assert.match(html, /aria-label="Delete Freeze transfer"/);
});

test("standalone milk bank keeps its balances and actions in a separate dashboard card", () => {
  const html = renderToStaticMarkup(createElement(MilkBank, { standalone: true, babyId: "baby-1", availableMl: 120, availableBatches: [], frozenMl: 0, frozenPackets: [], history: [], onChanged: async () => undefined }));
  assert.match(html, /<section class="rounded-lg border border-border bg-surface p-3 shadow-sm" aria-labelledby="milk-bank-title"/);
  assert.match(html, />120<\/span>/);
  assert.match(html, /Reconcile Available milk/);
  assert.match(html, /Show frozen milk details/);
});
