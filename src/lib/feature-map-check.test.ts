import { test } from "node:test";
import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

test("feature map checks paths, all app surfaces, fixtures and duplicate ids", () => {
  const root = mkdtempSync(join(tmpdir(), "feature-map-test-"));
  const files = ["src/app/(app)/dashboard/page.tsx", "src/app/api/example/route.ts", "src/components/Card.tsx"];
  const put = (path: string, content = "") => {
    mkdirSync(join(root, path, ".."), { recursive: true });
    writeFileSync(join(root, path), content);
  };
  try {
    put("scripts/feature-map-check.mjs");
    copyFileSync(resolve("scripts/feature-map-check.mjs"), join(root, "scripts/feature-map-check.mjs"));
    put("e2e/fixtures.ts", 'export const fixtureNames = ["fresh-day", "sick-episode"] as const;');
    for (const path of files) put(path);
    put("src/components/Card.test.tsx"); // Tests are not feature surfaces.
    put("vercel.json", "{}");
    const base = `### Example {#example}\n- **Fixture:** fresh-day\n- **Code:** ${[...files, "vercel.json"].map(path => "`" + path + "`").join(", ")}\n`;
    const run = (markdown: string) => {
      put("FEATURES.md", markdown);
      const result = spawnSync(process.execPath, [join(root, "scripts/feature-map-check.mjs")], { encoding: "utf8" });
      assert.ifError(result.error);
      return { status: result.status, output: result.stdout + result.stderr };
    };
    assert.deepEqual(run(base), { status: 0, output: "feature-map: OK (1 features, 4 paths)\n" });
    for (const fixture of ["sick-episode", "fresh-day + add a nap", "none"]) {
      assert.equal(run(base.replace("Fixture:** fresh-day", `Fixture:** ${fixture}`)).status, 0);
    }
    const cases = [
      [base.replace("Card.tsx", "Missing.tsx"), /Missing path: src\/components\/Missing.tsx/],
      [base.replace("`vercel.json`", "`missing.json`"), /Missing path: missing.json/],
      ...files.map(path => [base.replace("`" + path + "`", ""), new RegExp("Unmapped page, route or component:")] as const),
      [base.replace("Fixture:** fresh-day", "Fixture:** typo"), /Unknown fixture/],
      [base + "### Again {#example}\n", /Duplicate feature id: example/],
    ] as const;
    for (const [markdown, expected] of cases) {
      const result = run(markdown);
      assert.equal(result.status, 1);
      assert.match(result.output, expected);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
