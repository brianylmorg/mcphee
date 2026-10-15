import assert from "node:assert/strict";
import test from "node:test";

import {
  compareCaretakerActivities,
  isRealDateKey,
  parseCaretakerOcrLines,
  singaporeTimestamp,
  validateCaretakerDraft,
} from "./caretaker-import";
import type { CaretakerOcrLine, CaretakerOriginClassification } from "./caretaker-import-contract";

function line(
  id: string,
  y: number,
  text: string,
  origin: CaretakerOriginClassification = "caretaker",
  confidence = 0.98,
): CaretakerOcrLine {
  return {
    id,
    text,
    confidence,
    bounds: { x: 20, y, width: 240, height: 24 },
    origin: { classification: origin, confidence: 0.95, blueRatio: origin === "household" ? 0.8 : 0 },
  };
}

test("known caretaker layout preserves display nap groups and locks blue activity groups", () => {
  const rows = parseCaretakerOcrLines([
    line("milk-title", 0, "Milk"), line("milk-icon-ocr", 5, "A wik"),
    line("milk-heading", 10, "Past Milk Feeds"),
    line("milk-1-time", 20, "12:00 p.m."), line("milk-1-amount", 30, "130 ml"), line("milk-1-type", 40, "Breast Milk"),
    line("milk-2-time", 50, "9:00 a.m."), line("milk-2-amount", 60, "130 ml", "caretaker", 0.7), line("milk-2-type", 70, "Breast Milk"),
    line("milk-3-time", 80, "4:55 a.m.", "household"), line("milk-3-amount", 90, "120 ml", "household"), line("milk-3-type", 100, "Breast Milk", "household"),
    line("solid-title", 105, "A solid"), line("solids", 110, "Solid / Pending Updates"),
    line("diaper-title", 115, "& Diaper"), line("diaper-heading", 120, "Past diaper changes"),
    line("diaper-1-time", 130, "11:25 a.m."), line("diaper-1-detail", 140, "Change Needed, Wet"),
    line("diaper-2-time", 150, "8:25 a.m.", "household"), line("diaper-2-detail", 160, "Routine, Wet", "household"),
    line("nap-decoration", 165, "Zz"), line("nap-title", 170, "© Nap"), line("nap-heading", 175, "Past Nap Times"),
    line("nap-1-end-time", 180, "12:40 p.m."), line("nap-1-end", 190, "- Nap End"),
    line("nap-1-start-time", 200, "10:10 a.m."), line("nap-1-start", 210, "- Nap Start"),
    line("metadata", 215, "EditedBy:Teacher at12:41PM"),
    line("nap-2-end", 220, "- Nap End"), line("nap-2-start-time", 230, "12:15 p.m."), line("nap-2-start", 240, "- Nap Start"),
  ], "2026-10-14");

  assert.equal(rows.length, 7);
  const feeds = rows.filter((row) => row.draft.type === "bottlefeed");
  assert.deepEqual(feeds.map((row) => row.draft.details.amount), [130, 130, 120]);
  assert.equal(feeds[2].status, "blue_excluded");
  assert.equal(feeds[2].canInclude, false);
  assert.match(String(feeds[2].exclusionReason), /Household entry/);
  assert.ok(feeds[1].issues.some((entry) => entry.code === "LOW_CONFIDENCE"));

  const diapers = rows.filter((row) => row.draft.type === "diaper");
  assert.equal(diapers[0].draft.details.peeUnits, "3");
  assert.equal(diapers[0].draft.details.peeUnitsSource, "McPhee default from source Wet");
  assert.equal(diapers[0].draft.details.poop, "no");
  assert.equal(diapers[1].status, "blue_excluded");

  const naps = rows.filter((row) => row.draft.type === "sleep");
  assert.equal(naps[0].draft.startedAt, singaporeTimestamp("2026-10-14", "10:10 a.m."));
  assert.equal(naps[0].draft.endedAt, singaporeTimestamp("2026-10-14", "12:40 p.m."));
  assert.equal(naps[1].draft.startedAt, singaporeTimestamp("2026-10-14", "12:15 p.m."));
  assert.equal(naps[1].draft.endedAt, null);
  assert.ok(naps[1].issues.some((entry) => entry.code === "MISSING_END"));
  assert.ok(naps.every((row) => row.issues.some((entry) => entry.code === "NAP_OVERLAP")));
  assert.equal(rows.some((row) => JSON.stringify(row).includes("12:41")), false, "Edited By timestamp is metadata");
  assert.equal(rows.some((row) => row.draft.type === "note"), false, "Pending Updates is not a solids activity");
});

test("partial known sections parse and cropped unknown text remains a blocking review row", () => {
  const partial = parseCaretakerOcrLines([
    line("heading", 0, "Past Milk Feeds"),
    line("time", 10, "9:00 a.m."),
    line("amount", 20, "80 ml"),
    line("type", 30, "Formula"),
  ], "2026-10-14");
  assert.equal(partial.length, 1);
  assert.deepEqual(partial[0].draft.details, { milkType: "formula", amount: 80 });

  const cropped = parseCaretakerOcrLines([
    line("time", 10, "9:00 a.m."),
    line("amount", 20, "80 ml"),
  ], "2026-10-14");
  assert.equal(cropped.length, 1);
  assert.equal(cropped[0].status, "needs_review");
  assert.ok(cropped[0].issues.some((entry) => entry.code === "UNSUPPORTED_LAYOUT"));
});

test("missing-time feed fragments are preserved and repeated feed facts never merge silently", () => {
  const leadingUntimed = parseCaretakerOcrLines([
    line("heading", 0, "Past Milk Feeds"),
    line("untimed-amount", 10, "80 ml"), line("untimed-type", 20, "Breast Milk"),
    line("timed", 30, "9:00 a.m."), line("timed-amount", 40, "130 ml"), line("timed-type", 50, "Breast Milk"),
  ], "2026-10-14");
  assert.equal(leadingUntimed.length, 2);
  assert.equal(leadingUntimed[0].draft.details.amount, 80);
  assert.ok(leadingUntimed[0].issues.some((entry) => entry.code === "MISSING_TIME"));
  assert.equal(leadingUntimed[0].status, "needs_review");
  assert.equal(leadingUntimed[1].draft.details.amount, 130);

  const trailingUntimed = parseCaretakerOcrLines([
    line("heading", 0, "Past Milk Feeds"),
    line("timed", 10, "9:00 a.m."), line("first-amount", 20, "130 ml"), line("first-type", 30, "Breast Milk"),
    line("second-amount", 40, "150 ml"), line("second-type", 50, "Breast Milk"),
  ], "2026-10-14");
  assert.equal(trailingUntimed.length, 2);
  assert.equal(trailingUntimed[1].draft.details.amount, 150);
  assert.ok(trailingUntimed[1].issues.some((entry) => entry.code === "MISSING_TIME"));

  const fused = parseCaretakerOcrLines([
    line("heading", 0, "Past Milk Feeds"),
    line("fused", 10, "9:00 a.m. 130 ml Breast Milk 150 ml Breast Milk"),
  ], "2026-10-14");
  assert.equal(fused.length, 1);
  assert.ok(fused[0].issues.some((entry) => entry.code === "UNSUPPORTED_LAYOUT"));
});

test("one-line OCR activity groups with icon headings produce only the seven source activities", () => {
  const rows = parseCaretakerOcrLines([
    line("milk-title", 0, "Milk"),
    line("milk-icon", 5, "A wik"),
    line("milk-heading", 10, "Past Milk Feeds"),
    line("milk-noon", 20, "12:00 p.m. 150 ml Breast Milk"),
    line("milk-nine", 30, "9:00 a.m. 125 ml Breast Milk"),
    line("milk-blue", 40, "4:55 a.m. 95 ml Breast Milk", "household"),
    line("solid-title", 45, "A solid"),
    line("solid-pending", 50, "Solid / Pending Updates"),
    line("diaper-title", 55, "& Diaper"),
    line("diaper-heading", 60, "Past diaper changes"),
    line("diaper-grey", 70, "11:20 a.m. Change Needed, Wet"),
    line("diaper-blue", 80, "8:20 a.m. Routine, Wet", "household"),
    line("nap-decoration", 85, "Zz"),
    line("nap-title", 90, "© Nap"),
    line("nap-heading", 95, "Past Nap Times"),
    line("nap-end", 100, "12:40 p.m. - Nap End"),
    line("nap-start", 110, "10:10 a.m. - Nap Start"),
    line("metadata", 115, "EditedBy:Teacher at12:41PM"),
    line("open-nap-end", 120, "- Nap End"),
    line("open-nap-start", 130, "12:15 p.m. - Nap Start"),
  ], "2026-10-14");

  assert.equal(rows.length, 7);
  assert.deepEqual(
    rows.filter((row) => row.draft.type === "bottlefeed").map((row) => row.draft.details.amount),
    [150, 125, 95],
  );
  assert.equal(rows.filter((row) => row.status === "blue_excluded").length, 2);
  assert.equal(rows.filter((row) => row.draft.type === "note").length, 0);
  assert.equal(rows.some((row) => row.sourceText.includes("Pending Updates")), false);
  assert.equal(rows.some((row) => row.sourceText.includes("12:41")), false);
});

test("an automatically excluded blue nap does not block an overlapping caretaker nap", () => {
  const rows = parseCaretakerOcrLines([
    line("heading", 0, "Past Nap Times"),
    line("grey-end-time", 10, "11:00 a.m."), line("grey-end", 20, "Nap End"),
    line("grey-start-time", 30, "10:00 a.m."), line("grey-start", 40, "Nap Start"),
    line("blue-end-time", 50, "10:45 a.m.", "household"), line("blue-end", 60, "Nap End", "household"),
    line("blue-start-time", 70, "10:15 a.m.", "household"), line("blue-start", 80, "Nap Start", "household"),
  ], "2026-10-14");

  assert.equal(rows.length, 2);
  assert.equal(rows[0].status, "staged");
  assert.equal(rows[0].issues.some((entry) => entry.code === "NAP_OVERLAP"), false);
  assert.equal(rows[1].status, "blue_excluded");
  assert.equal(rows[1].issues.some((entry) => entry.code === "NAP_OVERLAP"), false);
});

test("Singapore time/date and exact-versus-near conflict comparison are strict", () => {
  assert.equal(isRealDateKey("2026-02-29"), false);
  assert.equal(isRealDateKey("2024-02-29"), true);
  assert.equal(singaporeTimestamp("2026-10-14", "12:00 a.m."), Date.parse("2026-10-14T00:00:00+08:00"));
  assert.equal(singaporeTimestamp("2026-10-14", "12:00 p.m."), Date.parse("2026-10-14T12:00:00+08:00"));
  const base = {
    type: "bottlefeed" as const,
    startedAt: Date.parse("2026-10-14T09:00:00+08:00"),
    endedAt: null,
    details: { milkType: "breastmilk", amount: 130 },
    note: null,
  };
  assert.equal(compareCaretakerActivities(base, structuredClone(base)), "exact");
  assert.equal(compareCaretakerActivities(base, { ...base, startedAt: base.startedAt + 60_000 }), "conflict");
  assert.equal(compareCaretakerActivities(base, { ...base, details: { ...base.details, amount: 150 } }), "conflict");
  assert.equal(compareCaretakerActivities(base, { ...base, details: { ...base.details, amount: "130" } }), "exact");
  const wet = { ...base, type: "diaper" as const, details: { peeUnits: "3", poop: "no", peeUnitsSource: "McPhee default from source Wet" } };
  assert.equal(compareCaretakerActivities(wet, { ...wet, details: { peeUnits: 3, poop: "no" } }), "exact");
  assert.equal(compareCaretakerActivities(wet, { ...wet, details: { peeUnits: 3, poop: "yes" } }), "conflict");
  const solids = { ...base, type: "note" as const, details: { notes: "Solids: rice" } };
  assert.equal(compareCaretakerActivities(solids, { ...solids, note: "Solids: rice" }), "exact");
});

test("invalid diaper contents, empty naps and explicitly negative poo evidence cannot import as valid", () => {
  const startedAt = Date.parse("2026-10-14T09:00:00+08:00");
  for (const details of [{ peeUnits: 99, poop: "no" }, { peeUnits: 1.5, poop: "no" }, { peeUnits: 0, poop: "invented" }]) {
    assert.ok(validateCaretakerDraft({ type: "diaper", startedAt, endedAt: null, details, note: null }, "baby")
      .some(issue => issue.code === "INVALID_DETAILS"));
  }
  assert.ok(validateCaretakerDraft({ type: "sleep", startedAt, endedAt: startedAt, details: {}, note: null }, "baby")
    .some(issue => issue.code === "INVALID_TIME"));
  const noPoo = parseCaretakerOcrLines([
    line("heading", 0, "Past diaper changes"), line("entry", 10, "9:00 a.m. Wet, no poo"),
  ], "2026-10-14");
  assert.equal(noPoo[0].draft.details.poop, "no");
});
