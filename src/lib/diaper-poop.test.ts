import assert from "node:assert/strict";
import test from "node:test";
import { diaperHasPoop, diaperPoopQuantity } from "./diaper-poop";

test("screenshot and paper-log poo count as poo; size shown only when known", () => {
  for (const value of ["M", "L", "yes", true]) assert.equal(diaperHasPoop(value), true, String(value));
  for (const value of ["no", "", null, undefined, false, "invented"]) assert.equal(diaperHasPoop(value), false, String(value));
  assert.equal(diaperPoopQuantity("M"), "poop M");
  assert.equal(diaperPoopQuantity("yes"), "poop");
  assert.equal(diaperPoopQuantity(true), "poop");
  assert.equal(diaperPoopQuantity("no"), "");
});
