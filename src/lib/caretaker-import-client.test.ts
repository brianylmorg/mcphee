import assert from "node:assert/strict";
import test from "node:test";

import { classifyCaretakerOriginPixels } from "./caretaker-import-client";

function pixels(red: number, green: number, blue: number, count = 12): Uint8ClampedArray {
  return Uint8ClampedArray.from(
    Array.from({ length: count }, () => [red, green, blue, 255]).flat(),
  );
}

function mixedPixels(parts: Array<[number, number, number, number]>): Uint8ClampedArray {
  return Uint8ClampedArray.from(parts.flatMap(([red, green, blue, count]) =>
    Array.from({ length: count }, () => [red, green, blue, 255]).flat()));
}

test("strong blue activity text stays household when layout or global colour checks are inconclusive", () => {
  const blue = pixels(57, 173, 252);
  assert.equal(classifyCaretakerOriginPixels(blue, false, false).classification, "household");
  assert.equal(classifyCaretakerOriginPixels(blue, true, false).classification, "household");
});

test("neutral activity text requires a supported colour layout before caretaker classification", () => {
  const neutral = pixels(70, 70, 70);
  assert.equal(classifyCaretakerOriginPixels(neutral, false, false).classification, "uncertain");
  assert.equal(classifyCaretakerOriginPixels(neutral, true, false).classification, "uncertain");
  assert.equal(classifyCaretakerOriginPixels(neutral, true, true).classification, "caretaker");
});

test("anti-aliased blue cores remain household while coloured fringes around gray cores remain caretaker", () => {
  const antiAliasedBlue = mixedPixels([
    [57, 173, 252, 30],
    [132, 205, 255, 12],
    [220, 242, 255, 18],
    [255, 255, 255, 30],
  ]);
  assert.equal(classifyCaretakerOriginPixels(antiAliasedBlue, true, true).classification, "household");

  const antiAliasedGray = mixedPixels([
    [85, 85, 85, 45],
    [150, 150, 150, 15],
    [201, 239, 255, 20],
    [122, 90, 85, 8],
    [255, 255, 255, 25],
  ]);
  assert.equal(classifyCaretakerOriginPixels(antiAliasedGray, true, true).classification, "caretaker");
});
