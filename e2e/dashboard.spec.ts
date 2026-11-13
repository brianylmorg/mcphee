import { mkdir } from "node:fs/promises";
import { createClient } from "@libsql/client";
import { expect, test } from "@playwright/test";
import { fixtureNames, seedFixture, setFixtureCookies } from "./fixtures";

for (const name of fixtureNames) {
  test(name, async ({ page, context }) => {
    // The first fixture also pays for a cold webpack dashboard/API compilation.
    if (name === "fresh-day") test.setTimeout(60_000);
    if (name === "asleep-blips") test.setTimeout(90_000);
    const url = process.env.TURSO_DATABASE_URL;
    if (!url?.startsWith("file:")) throw new Error("Run bash scripts/verify.sh ui to create an isolated file database.");
    const client = createClient({ url, authToken: "" });
    try {
      const fixture = await seedFixture(name, client);
      await setFixtureCookies(context, fixture);
      await page.goto("/dashboard");
      await expect(page.getByRole("button", { name: "Baby settings for Robin" })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Today’s milk consumption" })).toBeVisible();

      if (name === "fresh-day") {
        await expect(page.getByLabel("Recent bottle feeds")).toContainText("150 ml");
        await page.getByRole("button", { name: "Add activity", exact: true }).click();
        await page.getByRole("button", { name: /^Bottlefeed/ }).click();
        const form = page.getByRole("dialog", { name: "Log Bottlefeed" });
        await form.getByRole("button", { name: "Formula", exact: true }).click();
        await form.getByLabel("Amount (ml)", { exact: true }).fill("123");
        const saved = page.waitForResponse(response => response.url().endsWith("/api/activities") && response.request().method() === "POST");
        await form.getByRole("button", { name: "Log activity", exact: true }).click();
        expect((await saved).ok()).toBeTruthy();
        await expect(form).toBeHidden();
        await expect(page.getByLabel("Recent bottle feeds").getByLabel("123 ml consumed").filter({ visible: true })).toBeVisible();
        await expect(page.getByRole("button", { name: "Edit bottlefeed activity", exact: true }).filter({ hasText: "123 ml" })).toBeVisible();
        // Also prove persistence across a fresh dashboard load.
        await page.reload();
        await expect(page.getByLabel("Recent bottle feeds").getByLabel("123 ml consumed").filter({ visible: true })).toBeVisible();
      } else if (name === "sick-episode") {
        const health = page.getByRole("region", { name: "Health check-in" });
        await expect(health).toBeVisible();
        await expect(health).toContainText("37.8 °C");
        await expect(health.getByRole("button", { name: "Log Paracetamol", exact: true })).toBeVisible();
        await expect(health.getByRole("button", { name: "Dose history for Paracetamol" })).toContainText(/\d/);
      } else if (name === "childcare-checked-in") {
        const status = page.getByRole("button", { name: "Childcare status: in childcare" });
        await expect(status).toBeVisible();
        await status.click();
        await expect(page.getByRole("heading", { name: "Robin is in childcare" })).toBeVisible();
        await expect(page.getByRole("region", { name: "Childcare", exact: true })).toContainText("Checked in");
        await page.getByRole("button", { name: "Close baby settings" }).click();
      } else if (name === "milk-bank") {
        const bank = page.getByRole("region", { name: "Breastmilk bank" });
        await expect(bank).toBeVisible();
        await expect(bank).toContainText("1040");
        await bank.getByRole("button", { name: "Show frozen milk details" }).click();
        await expect(bank.getByRole("button", { name: "Thaw 180 ml packet" })).toBeVisible();
      } else if (name === "asleep-blips") {
        const card = page.getByRole("region", { name: "Sleep status" });
        await expect(card).toContainText("No blips this sleep");
        const refetched = () => page.waitForResponse(response => response.url().endsWith("/api/dashboard") && response.status() === 200);
        const started = page.waitForResponse(response => response.url().endsWith("/api/sleep-blips") && response.request().method() === "POST");
        const afterStart = refetched();
        await card.getByRole("button", { name: "Start a blip (crying in his sleep)" }).click();
        expect((await started).ok()).toBeTruthy();
        await afterStart;
        await expect(card.getByRole("button", { name: "Settled himself", exact: true })).toBeVisible();
        await expect(page.getByRole("status")).toContainText("Blip started");
        await mkdir(".verify/shots", { recursive: true });
        await page.screenshot({ path: ".verify/shots/asleep-blips-open.png", fullPage: true });
        const stopped = page.waitForResponse(response => response.url().endsWith("/api/sleep-blips") && response.request().method() === "POST");
        const afterStop = refetched();
        await card.getByRole("button", { name: "Settled himself", exact: true }).click();
        expect((await stopped).ok()).toBeTruthy();
        await afterStop;
        await expect(card).toContainText(/1 blip · .+ this sleep/);
        await page.getByRole("button", { name: "View wake window and nap charts" }).click();
        const nights = page.getByRole("region", { name: "Night blips" });
        await expect(nights.getByRole("heading", { name: "Night plan", exact: true })).toBeVisible();
        await expect(nights).toContainText("3 blips");
        await nights.scrollIntoViewIfNeeded();
        await page.screenshot({ path: ".verify/shots/asleep-blips-chart.png" });
        await nights.getByRole("heading", { name: "Night plan", exact: true }).evaluate(element => element.scrollIntoView({ block: "center" }));
        await page.screenshot({ path: ".verify/shots/asleep-blips-plan.png" });
        await page.getByRole("button", { name: "Close", exact: true }).click();
      } else {
        await expect(page.getByRole("button", { name: "Stop & log", exact: true })).toBeVisible();
        await expect(page.getByRole("button", { name: "Left side", exact: true })).toBeVisible();
        await expect(page.getByRole("button", { name: "Right side", exact: true })).toBeVisible();
      }
      await mkdir(".verify/shots", { recursive: true });
      await page.screenshot({ path: `.verify/shots/${name}.png`, fullPage: true });
    } finally {
      client.close();
    }
  });
}
