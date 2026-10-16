import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import ThemePreferenceControl from "./ThemePreferenceControl";
import { THEME_BOOT_SCRIPT, THEME_STORAGE_KEY } from "@/lib/theme-preference";

test("appearance control offers light, dark and system with system selected by default", () => {
  const html = renderToStaticMarkup(createElement(ThemePreferenceControl));
  assert.equal((html.match(/role="radio"/g) ?? []).length, 3);
  assert.match(html, />Light</);
  assert.match(html, />Dark</);
  assert.match(html, /aria-checked="true"[^>]*>.*System/);
});

test("boot script only applies explicit light or dark choices", () => {
  assert.ok(THEME_BOOT_SCRIPT.includes(THEME_STORAGE_KEY));
  assert.match(THEME_BOOT_SCRIPT, /t==="light"\|\|t==="dark"/);
  assert.match(THEME_BOOT_SCRIPT, /^try\{/);
});
