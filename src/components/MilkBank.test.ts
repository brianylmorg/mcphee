import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { MilkBank } from "./MilkBank";

test("milk bank separates Available and Frozen and blocks thaw for expired packets", () => {
  const html = renderToStaticMarkup(createElement(MilkBank, {
    babyId: "baby-1",
    availableMl: 120,
    expiredAvailableMl: 20,
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
  assert.match(html, /20 ml expired/);
  assert.match(html, /Expired/);
  assert.match(html, /Discard/);
  assert.match(html, /Correct/);
  assert.match(html, /aria-label="Remove 80 ml packet"/);
  assert.doesNotMatch(html, /aria-label="Thaw 80 ml packet"/);
  assert.match(html, /Bank history/);
});
