import { createClient } from "@libsql/client";
import { expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { seedFixture, setFixtureCookies } from "./fixtures";

export type StagedRow = {
  status: string;
  sourceText: string;
  draft: { type: string; startedAt: number; endedAt: number | null; details: Record<string, unknown>; note: string | null };
  issues: Array<{ code: string }>;
};

/** SGT clock time (HH:MM, 24h) of an epoch-ms timestamp. */
export const sgtTime = (ms: number) => new Date(ms + 8 * 3_600_000).toISOString().slice(11, 16);

/** Render caretaker-app-style rows to a PNG, so the real OCR has something to read. Fake names only. */
export async function renderCaretakerScreenshot(browser: Browser, sections: Array<{ title: string; heading: string; rows: string[][] }>): Promise<Buffer> {
  const context = await browser.newContext({ viewport: { width: 612, height: 900 } });
  const page = await context.newPage();
  const body = sections.map(({ title, heading, rows }) => `
    <h1>${title}</h1><p class="h">${heading}</p>
    ${rows.map(([main, ...rest]) => `<div class="r"><div class="m">${main}</div>${rest.map(t => `<div class="s">${t}</div>`).join("")}</div>`).join("")}
    <hr>`).join("");
  await page.setContent(`<style>
    body{margin:0;padding:28px;background:#faf9f7;font-family:Lato,"Helvetica Neue",Arial,sans-serif;color:#333;width:556px}
    h1{font-size:28px;margin:18px 0 6px 0}.h{font-size:18px;margin:0 0 14px}
    .r{margin-bottom:20px}.m{font-size:23px}.s{font-size:21px;font-style:italic;color:#999;margin:4px 0 0 40px}
    hr{border:0;border-top:1px solid #ddd;margin:22px 0}</style>${body}`);
  const png = await page.screenshot({ fullPage: true });
  await context.close();
  return png;
}

/** Run a screenshot through the real in-browser OCR and the stage API; returns the staged rows. */
export async function stageScreenshot(page: Page, context: BrowserContext, png: Buffer): Promise<{ rows: StagedRow[]; lines: string }> {
  const url = process.env.TURSO_DATABASE_URL;
  if (!url?.startsWith("file:")) throw new Error("Run bash scripts/verify.sh ui to create an isolated file database.");
  const client = createClient({ url, authToken: "" });
  try {
    const fixture = await seedFixture("fresh-day", client);
    await setFixtureCookies(context, fixture);
  } finally {
    client.close();
  }
  // Keep the OCR lines the client posts, so a run can be replayed against another parser.
  await page.addInitScript(() => {
    const original = window.fetch;
    window.fetch = async (input, init) => {
      const body = init?.body;
      if (body instanceof FormData && body.has("lines")) (window as unknown as { __ocrLines?: string }).__ocrLines = String(body.get("lines"));
      return original(input, init);
    };
  });
  await page.goto("/dashboard");
  await page.getByRole("button", { name: "Baby settings for Robin" }).click();
  await page.getByRole("button", { name: "Import a screenshot without a check-in" }).click();
  await expect(page.getByRole("heading", { name: "Import caretaker screenshot" })).toBeVisible();
  // Picking the file starts the OCR read by itself; wait for the stage call before choosing it.
  const staged = page.waitForResponse(r => r.url().endsWith("/api/caretaker-import/stage") && r.request().method() === "POST", { timeout: 150_000 });
  await page.locator("#caretaker-screenshot").setInputFiles({ name: "caretaker.png", mimeType: "image/png", buffer: png });
  const response = await staged;
  expect(response.ok(), await response.text()).toBeTruthy();
  const snapshot = await response.json() as { rows: StagedRow[] };
  const lines = await page.evaluate(() => (window as unknown as { __ocrLines?: string }).__ocrLines ?? "");
  return { rows: snapshot.rows, lines };
}
