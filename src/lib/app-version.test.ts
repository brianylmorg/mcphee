import assert from "node:assert/strict";
import test from "node:test";

import { isDifferentRelease } from "./app-version";

test("only a known, different live release counts as an update", () => {
  assert.equal(isDifferentRelease("abc123", "def456"), true);
  assert.equal(isDifferentRelease("abc123", "abc123"), false);
  // Local development and unknown versions never trigger a reload.
  assert.equal(isDifferentRelease("dev", "def456"), false);
  assert.equal(isDifferentRelease("abc123", "dev"), false);
  assert.equal(isDifferentRelease("abc123", null), false);
  assert.equal(isDifferentRelease("abc123", undefined), false);
});
