import assert from "node:assert/strict";
import test from "node:test";

import { evaluateAmountExpression, isAmountExpression } from "./amount-expression";

test("evaluates plain numbers and wastage sums", () => {
  assert.equal(evaluateAmountExpression("80"), 80);
  assert.equal(evaluateAmountExpression("120-40"), 80);
  assert.equal(evaluateAmountExpression(" 120 − 40 "), 80);
  assert.equal(evaluateAmountExpression("60+60-15"), 105);
  assert.equal(evaluateAmountExpression("2*60-(10+5)"), 105);
  assert.equal(evaluateAmountExpression("150/2"), 75);
  assert.equal(evaluateAmountExpression("100/3"), 33.3);
});

test("rejects incomplete or unsafe input", () => {
  for (const input of ["", "120-", "abc", "1/0", "(120-40", "120--", "alert(1)", "1e3"]) {
    assert.equal(evaluateAmountExpression(input), null, input);
  }
});

test("detects expressions versus plain numbers", () => {
  assert.equal(isAmountExpression("120-40"), true);
  assert.equal(isAmountExpression("80"), false);
  assert.equal(isAmountExpression("80.5"), false);
});
