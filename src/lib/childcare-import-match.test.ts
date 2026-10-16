import assert from "node:assert/strict";
import test from "node:test";

import type { MatchableBatch, MatchableSession } from "./childcare-import-match";
import { matchUnlinkedImports, sgtDateKeyOf } from "./childcare-import-match";

// 1. sgtDateKeyOf puts the Singapore calendar day boundary at 16:00Z.
test("sgtDateKeyOf uses the Singapore calendar date", () => {
  assert.equal(sgtDateKeyOf(Date.parse("2026-10-15T16:30:00Z")), "2026-10-16");
  assert.equal(sgtDateKeyOf(Date.parse("2026-10-15T15:59:59Z")), "2026-10-15");
});

// 2. An unlinked committed batch matches the closed session it describes.
test("unlinked committed batch matches the closed session of the same baby on the same SGT date", () => {
  const session: MatchableSession = {
    id: "session-closed",
    babyId: "baby-a",
    checkedInAt: Date.parse("2026-10-16T01:00:00.000Z"), // 09:00 SGT 16 Oct
    checkedOutAt: Date.parse("2026-10-16T09:00:00.000Z"), // 17:00 SGT 16 Oct
    importBatchId: null,
  };
  const batch: MatchableBatch = {
    id: "batch-unlinked",
    babyId: "baby-a",
    childcareSessionId: null,
    selectedDate: "2026-10-16",
    committedAt: Date.parse("2026-10-16T10:00:00.000Z"),
    coverage: {
      startedAt: Date.parse("2026-10-16T01:00:00.000Z"),
      endedAt: Date.parse("2026-10-16T09:00:00.000Z"),
    },
  };

  const matches = matchUnlinkedImports([session], [batch]);

  assert.equal(matches.size, 1);
  assert.deepEqual(matches.get("session-closed"), batch);
});

// 3. A batch already linked to a session is never matched.
test("batch with childcareSessionId set is never matched", () => {
  const session: MatchableSession = {
    id: "session-closed",
    babyId: "baby-a",
    checkedInAt: Date.parse("2026-10-16T01:00:00.000Z"),
    checkedOutAt: Date.parse("2026-10-16T09:00:00.000Z"),
    importBatchId: null,
  };
  const batch: MatchableBatch = {
    id: "batch-linked",
    babyId: "baby-a",
    childcareSessionId: "session-other",
    selectedDate: "2026-10-16",
    committedAt: Date.parse("2026-10-16T10:00:00.000Z"),
    coverage: {
      startedAt: Date.parse("2026-10-16T01:00:00.000Z"),
      endedAt: Date.parse("2026-10-16T09:00:00.000Z"),
    },
  };

  const matches = matchUnlinkedImports([session], [batch]);

  assert.equal(matches.size, 0);
});

// 4. Sessions that fail any eligibility rule are not matched.
test("no match when the session belongs to a different baby", () => {
  const session: MatchableSession = {
    id: "session-other-baby",
    babyId: "baby-b",
    checkedInAt: Date.parse("2026-10-16T01:00:00.000Z"),
    checkedOutAt: Date.parse("2026-10-16T09:00:00.000Z"),
    importBatchId: null,
  };
  const batch: MatchableBatch = {
    id: "batch-unlinked",
    babyId: "baby-a",
    childcareSessionId: null,
    selectedDate: "2026-10-16",
    committedAt: Date.parse("2026-10-16T10:00:00.000Z"),
    coverage: {
      startedAt: Date.parse("2026-10-16T01:00:00.000Z"),
      endedAt: Date.parse("2026-10-16T09:00:00.000Z"),
    },
  };

  const matches = matchUnlinkedImports([session], [batch]);

  assert.equal(matches.size, 0);
});

test("no match when the session is still open", () => {
  const session: MatchableSession = {
    id: "session-open",
    babyId: "baby-a",
    checkedInAt: Date.parse("2026-10-16T01:00:00.000Z"),
    checkedOutAt: null,
    importBatchId: null,
  };
  const batch: MatchableBatch = {
    id: "batch-unlinked",
    babyId: "baby-a",
    childcareSessionId: null,
    selectedDate: "2026-10-16",
    committedAt: Date.parse("2026-10-16T10:00:00.000Z"),
    coverage: {
      startedAt: Date.parse("2026-10-16T01:00:00.000Z"),
      endedAt: Date.parse("2026-10-16T09:00:00.000Z"),
    },
  };

  const matches = matchUnlinkedImports([session], [batch]);

  assert.equal(matches.size, 0);
});

test("no match when the session already has an import batch", () => {
  const session: MatchableSession = {
    id: "session-already-imported",
    babyId: "baby-a",
    checkedInAt: Date.parse("2026-10-16T01:00:00.000Z"),
    checkedOutAt: Date.parse("2026-10-16T09:00:00.000Z"),
    importBatchId: "batch-existing",
  };
  const batch: MatchableBatch = {
    id: "batch-unlinked",
    babyId: "baby-a",
    childcareSessionId: null,
    selectedDate: "2026-10-16",
    committedAt: Date.parse("2026-10-16T10:00:00.000Z"),
    coverage: {
      startedAt: Date.parse("2026-10-16T01:00:00.000Z"),
      endedAt: Date.parse("2026-10-16T09:00:00.000Z"),
    },
  };

  const matches = matchUnlinkedImports([session], [batch]);

  assert.equal(matches.size, 0);
});

test("no match when the session is on a different SGT date", () => {
  const session: MatchableSession = {
    id: "session-previous-day",
    babyId: "baby-a",
    checkedInAt: Date.parse("2026-10-15T02:00:00.000Z"), // 10:00 SGT 15 Oct
    checkedOutAt: Date.parse("2026-10-15T09:00:00.000Z"), // 17:00 SGT 15 Oct
    importBatchId: null,
  };
  const batch: MatchableBatch = {
    id: "batch-unlinked",
    babyId: "baby-a",
    childcareSessionId: null,
    selectedDate: "2026-10-16",
    committedAt: Date.parse("2026-10-16T10:00:00.000Z"),
    coverage: {
      startedAt: Date.parse("2026-10-15T02:00:00.000Z"),
      endedAt: Date.parse("2026-10-15T09:00:00.000Z"),
    },
  };

  const matches = matchUnlinkedImports([session], [batch]);

  assert.equal(matches.size, 0);
});

// 5. Overlap with the reviewed coverage window decides between sessions.
test("the session overlapping the batch coverage window most wins", () => {
  const earlySession: MatchableSession = {
    id: "session-early",
    babyId: "baby-a",
    checkedInAt: Date.parse("2026-10-16T01:00:00.000Z"), // 09:00 SGT 16 Oct
    checkedOutAt: Date.parse("2026-10-16T03:00:00.000Z"), // 11:00 SGT 16 Oct
    importBatchId: null,
  };
  const lateSession: MatchableSession = {
    id: "session-late",
    babyId: "baby-a",
    checkedInAt: Date.parse("2026-10-16T05:00:00.000Z"), // 13:00 SGT 16 Oct
    checkedOutAt: Date.parse("2026-10-16T09:00:00.000Z"), // 17:00 SGT 16 Oct
    importBatchId: null,
  };
  const batch: MatchableBatch = {
    id: "batch-overlap",
    babyId: "baby-a",
    childcareSessionId: null,
    selectedDate: "2026-10-16",
    committedAt: Date.parse("2026-10-16T10:00:00.000Z"),
    coverage: {
      startedAt: Date.parse("2026-10-16T05:30:00.000Z"),
      endedAt: Date.parse("2026-10-16T08:30:00.000Z"),
    },
  };

  const matches = matchUnlinkedImports([earlySession, lateSession], [batch]);

  assert.deepEqual([...matches.keys()], ["session-late"]);
  assert.deepEqual(matches.get("session-late"), batch);
});

// 6. Batches are claimed in commit order, so the earlier commit wins.
test("only the earlier committed batch matches when two unlinked batches share a date", () => {
  const session: MatchableSession = {
    id: "session-closed",
    babyId: "baby-a",
    checkedInAt: Date.parse("2026-10-16T01:00:00.000Z"),
    checkedOutAt: Date.parse("2026-10-16T09:00:00.000Z"),
    importBatchId: null,
  };
  const laterBatch: MatchableBatch = {
    id: "batch-later",
    babyId: "baby-a",
    childcareSessionId: null,
    selectedDate: "2026-10-16",
    committedAt: Date.parse("2026-10-16T12:00:00.000Z"),
    coverage: {
      startedAt: Date.parse("2026-10-16T01:00:00.000Z"),
      endedAt: Date.parse("2026-10-16T09:00:00.000Z"),
    },
  };
  const earlierBatch: MatchableBatch = {
    id: "batch-earlier",
    babyId: "baby-a",
    childcareSessionId: null,
    selectedDate: "2026-10-16",
    committedAt: Date.parse("2026-10-16T08:00:00.000Z"),
    coverage: {
      startedAt: Date.parse("2026-10-16T01:00:00.000Z"),
      endedAt: Date.parse("2026-10-16T09:00:00.000Z"),
    },
  };

  const matches = matchUnlinkedImports([session], [laterBatch, earlierBatch]);

  assert.equal(matches.size, 1);
  assert.deepEqual(matches.get("session-closed"), earlierBatch);
});

// 7. Without a selected date, coverage.startedAt supplies the SGT date.
test("selectedDate null falls back to the SGT date of coverage.startedAt", () => {
  const session: MatchableSession = {
    id: "session-fallback",
    babyId: "baby-a",
    checkedInAt: Date.parse("2026-10-16T02:00:00.000Z"), // 10:00 SGT 16 Oct
    checkedOutAt: Date.parse("2026-10-16T08:00:00.000Z"), // 16:00 SGT 16 Oct
    importBatchId: null,
  };
  const batch: MatchableBatch = {
    id: "batch-no-selected-date",
    babyId: "baby-a",
    childcareSessionId: null,
    selectedDate: null,
    committedAt: Date.parse("2026-10-16T10:00:00.000Z"),
    coverage: {
      startedAt: Date.parse("2026-10-15T16:30:00.000Z"), // 00:30 SGT 16 Oct
      endedAt: Date.parse("2026-10-16T08:00:00.000Z"),
    },
  };

  const matches = matchUnlinkedImports([session], [batch]);

  assert.equal(matches.size, 1);
  assert.deepEqual(matches.get("session-fallback"), batch);
});
