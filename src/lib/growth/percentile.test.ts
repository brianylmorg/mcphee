import assert from "node:assert/strict";
import test from "node:test";

import { sg2000BoysWeightAtPercentile, sg2000BoysWeightForAgePercentile, sg2000MaxAgeMonths } from "./percentile";

test("percentile curve weights match the table at whole rows and interpolate between them", () => {
  assert.equal(sg2000BoysWeightAtPercentile(50, 6), 8300);
  assert.equal(sg2000BoysWeightAtPercentile(3, 0), 2300);
  // Halfway between month 6 (8.3 kg) and month 8 (9.1 kg) on the 50th curve.
  assert.equal(sg2000BoysWeightAtPercentile(50, 7), 8700);
  assert.equal(sg2000BoysWeightAtPercentile(15, 6), null);
  assert.equal(sg2000BoysWeightAtPercentile(50, 30), null);
});

test("a weight on a curve reads back as that percentile", () => {
  const weight = sg2000BoysWeightAtPercentile(25, 4)!;
  assert.equal(Math.round(sg2000BoysWeightForAgePercentile(weight, 4)!), 25);
  assert.equal(sg2000MaxAgeMonths(), 24);
});
