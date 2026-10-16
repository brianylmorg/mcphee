import assert from "node:assert/strict";
import test from "node:test";

import { buildWeightChart, weighInRows } from "./weight-chart";

const DAY = 24 * 60 * 60 * 1000;
const birth = Date.parse("2026-03-30T00:00:00+08:00");
const at = (day: number) => birth + day * DAY;

test("weigh-in rows are oldest first with the change since the previous one", () => {
  const rows = weighInRows([
    { id: "c", measuredAt: at(60), weightG: 5600 },
    { id: "a", measuredAt: at(10), weightG: 3600 },
    { id: "b", measuredAt: at(24), weightG: 4300 },
  ], birth);
  assert.deepEqual(rows.map((row) => row.id), ["a", "b", "c"]);
  assert.equal(rows[0].deltaG, null);
  assert.equal(rows[1].deltaG, 700);
  assert.equal(rows[1].deltaDays, 14);
  assert.equal(rows[2].deltaDays, 36);
  assert.ok(rows.every((row) => row.percentile != null));
});

test("points sit on a true time axis: a 3-week gap is three times a 1-week gap", () => {
  const rows = weighInRows([
    { id: "a", measuredAt: at(30), weightG: 4500 },
    { id: "b", measuredAt: at(37), weightG: 4800 },
    { id: "c", measuredAt: at(58), weightG: 5600 },
  ], birth);
  const chart = buildWeightChart(rows, birth, 300);
  const [a, b, c] = chart.points;
  const weekGap = b.x - a.x;
  const threeWeekGap = c.x - b.x;
  assert.ok(Math.abs(threeWeekGap / weekGap - 3) < 0.01, `ratio ${threeWeekGap / weekGap}`);
});

test("percentile bands are drawn and the chart includes the reference range", () => {
  const rows = weighInRows([
    { id: "a", measuredAt: at(20), weightG: 3800 },
    { id: "b", measuredAt: at(90), weightG: 6000 },
  ], birth);
  const chart = buildWeightChart(rows, birth, 320);
  assert.deepEqual(chart.bands.map((band) => [band.lower, band.upper]), [[3, 97], [10, 90], [25, 75]]);
  assert.ok(chart.median && chart.median.split(" ").length > 5);
  assert.ok(chart.points.every((point) => point.y >= chart.plotTop && point.y <= chart.plotBottom));
  assert.ok(chart.monthTicks.length >= 2);
});

test("without a birth date there are no bands but weigh-ins still plot", () => {
  const rows = weighInRows([{ id: "a", measuredAt: at(20), weightG: 3800 }], null);
  const chart = buildWeightChart(rows, null, 320);
  assert.equal(chart.bands.length, 0);
  assert.equal(chart.median, null);
  assert.equal(chart.points.length, 1);
  assert.equal(rows[0].percentile, null);
});

test("long histories scroll rather than squash", () => {
  const rows = weighInRows(Array.from({ length: 12 }, (_, i) => ({ id: String(i), measuredAt: at(i * 30), weightG: 3300 + i * 500 })), birth);
  const chart = buildWeightChart(rows, birth, 320);
  assert.ok(chart.width > 320 * 3);
});
