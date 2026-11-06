#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const problems = [];
const read = (path) => {
  try { return readFileSync(join(root, path), "utf8"); }
  catch { problems.push(`Cannot read ${path}`); return ""; }
};
const markdown = read("FEATURES.md");
const fixturesSource = read("e2e/fixtures.ts");
const fixtureArray = fixturesSource.match(/export\s+const\s+fixtureNames\s*=\s*\[([\s\S]*?)\]/);
if (!fixtureArray) problems.push("Cannot find exported fixtureNames array in e2e/fixtures.ts");
const fixtures = new Set(Array.from((fixtureArray?.[1] ?? "").matchAll(/["']([^"']+)["']/g), (match) => match[1]));

// Inline code may also contain labels, API URLs, identifiers or calculations.
const paths = new Set(Array.from(markdown.matchAll(/`([^`\r\n]+)`/g), (match) => match[1])
  .filter((value) => /^(src|e2e|scripts|public)\//.test(value) || /^[\w.-]+\.[a-z\d]+$/i.test(value)));
for (const path of paths) {
  if (!existsSync(join(root, path))) problems.push(`Missing path: ${path}`);
}

function walk(directory) {
  const absolute = join(root, directory);
  if (!existsSync(absolute)) return [];
  return readdirSync(absolute, { withFileTypes: true }).flatMap((entry) => {
    const path = `${directory}/${entry.name}`;
    return entry.isDirectory() ? walk(path) : [path];
  });
}
const surfaces = [
  ...walk("src/app").filter((path) => path.endsWith("/page.tsx") || (path.startsWith("src/app/api/") && path.endsWith("/route.ts"))),
  ...walk("src/components").filter((path) => /^src\/components\/[^/]+\.tsx$/.test(path) && !/\.(test|spec)\.tsx$/.test(path)),
];
for (const path of surfaces) {
  if (!markdown.includes(path)) problems.push(`Unmapped page, route or component: ${path}`);
}

for (const [index, line] of markdown.split(/\r?\n/).entries()) {
  const match = line.match(/^\s*-\s+\*\*Fixture:\*\*\s*(.*?)\s*$/);
  if (!match) continue;
  const name = match[1].replace(/^`([^`]+)`$/, "$1");
  if (!fixtures.has(name) && name !== "none" && !/^fresh-day\s+\+\s+\S/.test(name)) {
    problems.push(`Unknown fixture at FEATURES.md:${index + 1}: ${name || "(empty)"}`);
  }
}
const ids = new Set();
for (const [, id] of markdown.matchAll(/\{#([^}\s]+)\}/g)) {
  if (ids.has(id)) problems.push(`Duplicate feature id: ${id}`);
  ids.add(id);
}
const features = Array.from(markdown.matchAll(/^### .+ \{#[^}\s]+\}\s*$/gm)).length;
if (problems.length) {
  console.error(`feature-map: FAIL\n${problems.map((problem) => `- ${problem}`).join("\n")}`);
  process.exitCode = 1;
} else {
  console.log(`feature-map: OK (${features} features, ${paths.size} paths)`);
}
