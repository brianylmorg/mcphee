import assert from "node:assert/strict";
import test from "node:test";

import { alignPair, planStitch, rowSignatures, type StitchPlan } from "./screenshot-stitch";

const WIDTH = 96;

/** Deterministic pseudo-random generator so failures are reproducible. */
function rng(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

/**
 * A long scrolling "page" of list entries: textured text bands separated by
 * blank gaps, like a caretaker log. Each row is WIDTH greyscale values.
 */
function makePage(rows: number, seed = 7): number[][] {
  const random = rng(seed);
  const page: number[][] = [];
  while (page.length < rows) {
    const gap = 4 + Math.floor(random() * 6);
    for (let i = 0; i < gap && page.length < rows; i += 1) page.push(new Array(WIDTH).fill(250));
    const band = 8 + Math.floor(random() * 6);
    const glyphs = Array.from({ length: WIDTH }, () => (random() < 0.45 ? 30 + Math.floor(random() * 60) : 250));
    for (let i = 0; i < band && page.length < rows; i += 1) {
      page.push(glyphs.map((value, x) => (value < 250 && (x + i) % 3 === 0 ? 250 : value)));
    }
  }
  return page;
}

function band(rows: number, value: number, clock = 0): number[][] {
  return Array.from({ length: rows }, (_, y) => Array.from({ length: WIDTH }, (_, x) => (
    y < 6 && x > 40 && x < 56 ? 40 + ((clock * 17 + x) % 50) : value
  )));
}

const HEADER = 30;
const FOOTER = 20;

/** A phone screenshot: status bar + header, a window onto the page, a footer. */
function screenshot(page: number[][], scroll: number, viewport: number, clock: number): number[][] {
  return [...band(HEADER, 200, clock), ...page.slice(scroll, scroll + viewport), ...band(FOOTER, 180)];
}

function signatures(image: number[][]) {
  return rowSignatures(image.flat(), WIDTH, image.length);
}

function render(images: number[][][], plan: StitchPlan): number[][] {
  return plan.segments.flatMap((segment) => images[segment.image].slice(segment.fromRow, segment.toRow));
}

test("three overlapping screenshots rebuild the page once with one header and one footer", () => {
  const page = makePage(900);
  const viewport = 400;
  const shots = [
    screenshot(page, 0, viewport, 1),
    screenshot(page, 260, viewport, 2),
    screenshot(page, 500, viewport, 3),
  ];
  const plan = planStitch(shots.map(signatures));
  assert.deepEqual(plan.pairs.map((pair) => pair.kind), ["aligned", "aligned"]);

  const stitched = render(shots, plan);
  const expected = [...shots[0].slice(0, HEADER), ...page.slice(0, 500 + viewport), ...band(FOOTER, 180)];
  assert.equal(stitched.length, expected.length);
  assert.deepEqual(stitched, expected);
});

test("the scroll offset is measured exactly, including the fixed header", () => {
  const page = makePage(700, 11);
  const a = screenshot(page, 0, 360, 4);
  const b = screenshot(page, 145, 360, 9);
  const pair = alignPair(signatures(a), signatures(b));
  assert.equal(pair.kind, "aligned");
  if (pair.kind === "aligned") {
    assert.equal(pair.offset, 145);
    // The seam sits inside page content, past b's header and before a's footer.
    assert.ok(pair.seamB >= HEADER && pair.seamA <= HEADER + 360);
    // ...and on a blank row, so rounding can never slice a line of text.
    assert.ok(b[pair.seamB].every((value) => value === 250));
  }
});

test("the same screenshot picked twice is dropped instead of doubling entries", () => {
  const page = makePage(500, 3);
  const shot = screenshot(page, 40, 380, 5);
  const plan = planStitch([shot, shot].map(signatures));
  assert.deepEqual(plan.pairs.map((pair) => pair.kind), ["duplicate"]);
  assert.deepEqual(render([shot, shot], plan), shot);
});

test("the same screen captured again with a different clock still counts as a repeat", () => {
  const page = makePage(600, 5);
  const first = screenshot(page, 120, 380, 1);
  const again = screenshot(page, 120, 380, 8);
  const plan = planStitch([first, again].map(signatures));
  assert.deepEqual(plan.pairs.map((pair) => pair.kind), ["duplicate"]);
  assert.equal(render([first, again], plan).length, first.length);
});

test("screenshots of unrelated pages are kept whole and reported as unaligned", () => {
  const a = screenshot(makePage(500, 21), 0, 380, 1);
  const b = screenshot(makePage(500, 99), 0, 380, 2);
  const plan = planStitch([a, b].map(signatures));
  assert.deepEqual(plan.pairs.map((pair) => pair.kind), ["unaligned"]);
  assert.equal(render([a, b], plan).length, a.length + b.length);
});

test("blank background alone never counts as an overlap", () => {
  const blank = [...band(HEADER, 200, 1), ...band(400, 250), ...band(FOOTER, 180)];
  const other = [...band(HEADER, 200, 2), ...band(400, 250), ...band(FOOTER, 180)];
  assert.equal(alignPair(signatures(blank), signatures(other)).kind, "unaligned");
});
