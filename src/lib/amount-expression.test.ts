import assert from "node:assert/strict";
import test from "node:test";

import { bottleAmountDetails, evaluateAmountExpression, isAmountExpression } from "./amount-expression";
import { bottleBreastmilkLibraryDeduction } from "./milk-calculation";

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

test("bottle details keep the wastage so the bank deducts the full bottle", () => {
  const details = bottleAmountDetails("150-40");
  assert.deepEqual(details, { amount: 110, amountExpression: "150-40", wastedAmount: 40 });
  assert.equal(bottleBreastmilkLibraryDeduction({ milkType: "breastmilk", ...details }), 150);
  assert.deepEqual(bottleAmountDetails(" 150 − 40 "), { amount: 110, amountExpression: "150-40", wastedAmount: 40 });
  assert.deepEqual(bottleAmountDetails("110"), { amount: 110 });
  assert.deepEqual(bottleAmountDetails("60+60"), { amount: 120, amountExpression: "60+60" });
  assert.deepEqual(bottleAmountDetails("2*60"), { amount: 120 });
  assert.equal(bottleAmountDetails("150-"), null);
  assert.equal(bottleBreastmilkLibraryDeduction({ milkType: "formula", ...bottleAmountDetails("150-40") }), 0);
});
