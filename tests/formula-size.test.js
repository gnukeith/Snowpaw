import assert from "node:assert/strict";
import { test } from "node:test";
import katex from "katex";
import { largest, sizeOf } from "../src/plugins/math/size.ts";

/** The largest size in the MathML KaTeX builds for a formula, read from the
    markup as text, since the tests have no DOM. */
function largestIn(formula) {
  const markup = katex.renderToString(formula, { output: "mathml", trust: false, maxSize: largest, maxExpand: 1000, strict: "ignore" });
  let most = 0;
  for (const [, name, value] of markup.matchAll(/ ([a-z]+)="([^"]*)"/g)) most = Math.max(most, sizeOf(name, value));
  return most;
}

test("ordinary formulas are well within bounds", () => {
  for (const formula of ["x^2", "\\frac{1}{2}", "\\begin{pmatrix}a&b\\\\c&d\\end{pmatrix}", "\\hspace{3em}x", "\\mathrel{\\raisebox{0.2em}{=}}", "\\sum_{i=1}^n i"]) {
    assert.ok(largestIn(formula) <= largest, formula);
  }
});

test("sizes that pass KaTeX's own limit are caught", () => {
  for (const formula of ["\\raisebox{500em}{x}", "\\rule[-500em]{1em}{1em}", "\\kern-500em x", "\\raisebox{-90000em}{x}"]) {
    assert.ok(largestIn(formula) > largest, formula);
  }
});

test("each unit is read, and what cannot be read counts as too large", () => {
  assert.equal(sizeOf("width", "2em"), 2);
  assert.equal(sizeOf("width", "-3em"), 3);
  assert.equal(sizeOf("voffset", "10pt"), 1);
  assert.equal(sizeOf("rowspacing", "0.16em 30em"), 30);
  assert.equal(sizeOf("width", "100%"), Infinity);
  assert.equal(sizeOf("maxsize", "infinity"), Infinity);
  assert.equal(sizeOf("columnalign", "center"), 0);
  assert.equal(sizeOf("scriptlevel", "9999"), 0);
});
