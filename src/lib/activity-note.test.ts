import assert from "node:assert/strict";
import test from "node:test";

import { activityNoteText } from "./activity-note";

test("activity notes use the entered text as their display title", () => {
  assert.equal(activityNoteText({ notes: "  Baby smiled today  " }), "Baby smiled today");
  assert.equal(activityNoteText({ note: "Legacy note" }), "Legacy note");
  assert.equal(activityNoteText({ notes: "", note: "Older fallback" }), "");
  assert.equal(activityNoteText({}), "");
});
