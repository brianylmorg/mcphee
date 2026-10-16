import assert from "node:assert/strict";
import test from "node:test";

import { vomitToNoteDetails } from "./vomit-note";

test("vomit details become note text and keep the original fields", () => {
  assert.deepEqual(vomitToNoteDetails({ vomitType: "projectile", notes: "Possibly 30 ml" }), {
    vomitType: "projectile",
    notes: "Vomit (projectile) – Possibly 30 ml",
    legacyType: "vomit",
  });
  assert.equal(vomitToNoteDetails({ vomitType: "dribble-milk" }).notes, "Vomit (dribble milk)");
  assert.equal(vomitToNoteDetails({ vomitType: "projectile", notes: null }).notes, "Vomit (projectile)");
  assert.deepEqual(vomitToNoteDetails({ source: "paper_log", vomitType: "unspecified" }), {
    source: "paper_log",
    vomitType: "unspecified",
    notes: "Vomit",
    legacyType: "vomit",
  });
});
