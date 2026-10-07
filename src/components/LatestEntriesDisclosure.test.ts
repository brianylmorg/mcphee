import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import LatestEntriesDisclosure from "./LatestEntriesDisclosure";

test("shared disclosure is a closed native details element by default", () => {
  const html = renderToStaticMarkup(createElement(LatestEntriesDisclosure, {
    title: "Latest diapers",
    summary: createElement("span", { className: "newest" }, "newest entry"),
    entries: createElement("div", { className: "rows" }, "history row"),
    footer: createElement("button", { type: "button" }, "Log a new diaper"),
    titleClassName: "custom-title",
  }));

  assert.match(html, /^<details/);
  assert.match(html, /data-latest-entries="true"/);
  assert.doesNotMatch(html, /<details[^>]*\bopen/);
  assert.match(html, /<summary[^>]*>[\s\S]*Latest diapers[\s\S]*<\/summary>/);
  assert.match(html, /latest-entries-title custom-title/);
  // The newest summary sits in the closed summary and hides once expanded.
  assert.match(html, /latest-entries-newest[^"]*group-open:hidden/);
  assert.match(html, /newest entry/);
  assert.match(html, /data-latest-entries-content="true"[\s\S]*history row/);
  assert.match(html, /Log a new diaper/);
});
