import assert from "node:assert/strict";
import test from "node:test";

import { msUntilNextSgtMidnight } from "./sgt-day";

test("counts down to the next Singapore midnight", () => {
  // 23:59:30 SGT on 17 Oct is 15:59:30 UTC.
  assert.equal(msUntilNextSgtMidnight(Date.parse("2026-10-17T15:59:30Z")), 30_000);
  // 08:00 SGT is 16 hours before midnight.
  assert.equal(msUntilNextSgtMidnight(Date.parse("2026-10-17T00:00:00Z")), 16 * 3_600_000);
});

test("exactly at midnight waits a full day", () => {
  assert.equal(msUntilNextSgtMidnight(Date.parse("2026-10-17T16:00:00Z")), 24 * 3_600_000);
});
