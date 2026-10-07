import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import SickMilkProgress, { buildSickMilkProgressModel } from "./SickMilkProgress";

test("marker positions share a scale covering consumed, frozen baseline and weight estimate", () => {
  const model = buildSickMilkProgressModel({ consumedMl: 300, baselineMl: 800, expectedMl: 1125 });
  assert.equal(model.scaleMaxMl, 1125);
  assert.deepEqual(model.threshold, { valueMl: 400, positionPercent: 35.556 });
  assert.deepEqual(model.baseline, { valueMl: 800, positionPercent: 71.111 });
  assert.deepEqual(model.expected, { valueMl: 1125, positionPercent: 100 });
  assert.equal(model.consumedPercent, 26.667);
});

test("marker scale handles expected below baseline and consumption above both", () => {
  const reversed = buildSickMilkProgressModel({ consumedMl: 200, baselineMl: 800, expectedMl: 750 });
  assert.equal(reversed.scaleMaxMl, 800);
  assert.equal(reversed.threshold?.positionPercent, 50);
  assert.equal(reversed.baseline?.positionPercent, 100);
  assert.equal(reversed.expected?.positionPercent, 93.75);

  const exceeded = buildSickMilkProgressModel({ consumedMl: 1_200, baselineMl: 800, expectedMl: 750 });
  assert.equal(exceeded.scaleMaxMl, 1_200);
  assert.equal(exceeded.consumedPercent, 100);
  assert.equal(exceeded.baseline?.positionPercent, 66.667);
});

test("missing or invalid weight stays pending without a fabricated marker", () => {
  for (const expectedMl of [null, 0, Number.NaN]) {
    const model = buildSickMilkProgressModel({ consumedMl: 100, baselineMl: 800, expectedMl });
    assert.equal(model.expected, null);
  }
  const html = renderToStaticMarkup(createElement(SickMilkProgress, { consumedMl: 100, baselineMl: 800, expectedMl: null, baselineKind: "calculated" }));
  assert.doesNotMatch(html, /data-milk-marker="expected"/);
  assert.match(html, /aria-label="Expected weight estimate Pending"/);
});

test("coincident baseline and expected remain separate accessible markers at the true position", () => {
  const model = buildSickMilkProgressModel({ consumedMl: 100, baselineMl: 800, expectedMl: 800 });
  assert.equal(model.baseline?.positionPercent, 100);
  assert.equal(model.expected?.positionPercent, 100);
  const html = renderToStaticMarkup(createElement(SickMilkProgress, { consumedMl: 100, baselineMl: 800, expectedMl: 800, baselineKind: "calculated" }));
  assert.equal((html.match(/data-milk-marker=/g) ?? []).length, 3);
  assert.match(html, /data-milk-marker="baseline"[^>]+left:100%/);
  assert.match(html, /data-milk-marker="expected"[^>]+left:100%/);
  assert.match(html, /aria-label="Pre-sick median 800 ml"/);
  assert.match(html, />Median<\/span><span class="tabular-nums"> · 800 ml/);
  assert.match(html, /aria-label="Expected weight estimate 800 ml"/);
});

test("manual frozen baseline is labelled honestly", () => {
  const html = renderToStaticMarkup(createElement(SickMilkProgress, { consumedMl: 100, baselineMl: 800, expectedMl: 1125, baselineKind: "manual" }));
  assert.match(html, /Approved manual baseline/);
  assert.match(html, />Manual<\/span><span class="tabular-nums"> · 800 ml/);
  assert.doesNotMatch(html, /Pre-sick median/);
});
