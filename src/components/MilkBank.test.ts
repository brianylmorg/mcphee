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

  assert.doesNotMatch(html, />Available</);
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
  assert.match(html, /Freezer bank history/);
  assert.match(html, /aria-label="Delete Freeze transfer"/);
});

test("frozen details toggle sits after the reconcile action and owns the history panel", () => {
  const html = renderToStaticMarkup(createElement(MilkBank, {
    babyId: "baby-1",
    availableMl: 120,
    availableBatches: [],
    frozenMl: 80,
    frozenPackets: [],
    history: [{ id: "freeze-1", eventType: "Freeze", amountMl: 80, at: 100, packetId: "freeze-1" }],
    onChanged: async () => undefined,
  }));

  const reconcileIndex = html.indexOf("Reconcile Available milk");
  const snowflakeIndex = html.indexOf("Show frozen milk details");
  assert.ok(reconcileIndex >= 0, "reconcile button is rendered");
  assert.ok(snowflakeIndex >= 0, "snowflake button is rendered");
  assert.ok(reconcileIndex < snowflakeIndex, "snowflake button comes after the reconcile button");

  const panelIndex = html.indexOf('id="frozen-bank-details"');
  const historyIndex = html.indexOf("Freezer bank history");
  assert.ok(panelIndex >= 0, "frozen details panel is rendered");
  assert.ok(historyIndex >= 0, "freezer bank history is rendered");
  assert.ok(panelIndex < historyIndex, "bank history lives inside the frozen details panel");
});

test("standalone milk bank keeps its balances and actions in a separate dashboard card", () => {
  const html = renderToStaticMarkup(createElement(MilkBank, { standalone: true, babyId: "baby-1", availableMl: 120, availableBatches: [], frozenMl: 0, frozenPackets: [], history: [], onChanged: async () => undefined }));
  assert.match(html, /<section class="rounded-lg border border-border bg-surface p-3 shadow-sm" aria-labelledby="milk-bank-title"/);
  assert.match(html, />120<\/span>/);
  assert.match(html, /Reconcile Available milk/);
  assert.match(html, /Show frozen milk details/);
});
