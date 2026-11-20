import { mkdir } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { renderCaretakerScreenshot, sgtTime, stageScreenshot, type StagedRow } from "./caretaker-import-flow";

// Regression: the real in-browser OCR (tesseract.js) reading a caretaker-app screenshot must still
// stage the same feeds, solids, naps and diapers, and must now see poo diapers. Fake names only.
test("caretaker OCR still stages every section and recognises poo diapers", async ({ page, context, browser }) => {
  test.setTimeout(200_000);
  const png = await renderCaretakerScreenshot(browser, [
    { title: "Milk", heading: "Past Milk Feeds:", rows: [
      ["04:05 PM - Breast Milk, 130ml", "Added By: Sam Lee"],
      ["12:25 PM - Formula Milk, 90ml", "Added By: Sam Lee"],
    ] },
    { title: "Solid", heading: "Past Solid Feeds:", rows: [["11:30 AM - Lunch, 1 Serving", "Added By: Pat Lim"]] },
    { title: "Diaper", heading: "Past diaper changes:", rows: [
      ["02:40 PM - Routine, Wet", "Added By: Sam Lee"],
      ["01:15 PM - Routine, Poo - Normal Stool - Yellow", "Added By: Sam Lee"],
      ["10:44 AM - Routine, Wet, Poo - Watery Stool - Green", "Added By: Pat Lim", "Remarks: Changed clothes"],
      ["08:10 AM - Routine, Wet", "Added By: Pat Lim"],
    ] },
    { title: "Nap", heading: "Past Nap Times", rows: [
      ["02:36 PM - Nap End", "Added By: Sam Lee"],
      ["12:30 PM - Nap Start", "Added By: Sam Lee"],
    ] },
  ]);
  await mkdir(".verify/shots", { recursive: true });
  await test.info().attach("source", { body: png, contentType: "image/png" });

  const { rows } = await stageScreenshot(page, context, png);
  const byType = (type: string) => rows.filter(r => r.draft.type === type);
  const at = (list: StagedRow[], time: string) => list.find(r => sgtTime(r.draft.startedAt) === time);

  // Feeds and solids and naps: unchanged behaviour.
  const feeds = byType("bottlefeed");
  expect(feeds).toHaveLength(2);
  expect(at(feeds, "16:05")?.draft.details).toMatchObject({ milkType: "breastmilk", amount: 130 });
  expect(at(feeds, "12:25")?.draft.details).toMatchObject({ milkType: "formula", amount: 90 });
  expect(byType("note").some(r => /Solids: .*Lunch/i.test(String(r.draft.details.notes)))).toBeTruthy();
  const naps = byType("sleep");
  expect(naps).toHaveLength(1);
  expect(sgtTime(naps[0].draft.startedAt)).toBe("12:30");
  expect(sgtTime(naps[0].draft.endedAt ?? 0)).toBe("14:36");

  // Diapers: four rows; wet stays wet, poo is poo, nothing is double-counted.
  const diapers = byType("diaper");
  expect(diapers).toHaveLength(4);
  expect(at(diapers, "14:40")?.draft.details).toMatchObject({ peeUnits: "3", poop: "no" });
  expect(at(diapers, "08:10")?.draft.details).toMatchObject({ peeUnits: "3", poop: "no" });
  const poo = at(diapers, "13:15");
  expect(poo?.draft.details).toMatchObject({ peeUnits: "0", poop: "yes" });
  expect(String(poo?.draft.details.notes)).toMatch(/^Stool: /);
  const both = at(diapers, "10:44");
  expect(both?.draft.details).toMatchObject({ peeUnits: "3", poop: "yes" });
  expect(String(both?.draft.details.notes)).toMatch(/^Stool: /);
  for (const row of diapers) expect(row.issues.map(i => i.code)).not.toContain("UNSUPPORTED_LAYOUT");

  // The review screen shows poo as selected, so saving cannot drop it.
  await expect(page.getByLabel("Poop").filter({ visible: true }).first()).toBeVisible();
  await page.screenshot({ path: ".verify/shots/caretaker-ocr-review.png", fullPage: true });
});
