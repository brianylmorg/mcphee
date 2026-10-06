import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import BabyCareMenu from "./BabyCareMenu";

test("baby-name trigger exposes an accessible care dialog without changing the baby image", () => {
  const html = renderToStaticMarkup(createElement(BabyCareMenu, { name: "Example", active: false, children: "Care settings" }));
  assert.match(html, /aria-label="Baby settings for Example"/);
  assert.match(html, /aria-haspopup="dialog"/);
  assert.match(html, /<dialog[^>]+aria-labelledby="baby-care-menu-title"/);
  assert.match(html, /Close baby settings/);
  assert.match(html, /Baby settings &amp; sick mode/);
  assert.match(html, /src="\/icon.svg"/);
  assert.doesNotMatch(html, /<dialog[^>]+ open/);
});
