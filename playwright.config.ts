import { defineConfig } from "@playwright/test";

if (process.env.TURSO_DATABASE_URL && !process.env.TURSO_DATABASE_URL.startsWith("file:")) {
  throw new Error("UI verification requires a file: TURSO_DATABASE_URL; remote databases are forbidden.");
}

export default defineConfig({
  testDir: "./e2e",
  workers: 1,
  retries: 0,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  outputDir: ".verify/playwright",
  reporter: [["list"], ["json", { outputFile: ".verify/playwright/results.json" }]],
  use: {
    baseURL: "http://127.0.0.1:3217",
    timezoneId: "Asia/Singapore",
    screenshot: "only-on-failure",
  },
  projects: [{
    name: "mobile-chromium",
    use: {
      browserName: "chromium",
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 1,
      isMobile: true,
      hasTouch: true,
    },
  }],
});
