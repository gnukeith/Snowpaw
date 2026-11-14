import assert from "node:assert/strict";
import { test } from "node:test";
import katex from "katex";
import { checkSizes, definesCommands, largest, sizeOf } from "../src/plugins/math/size.ts";

/** The MathML KaTeX builds for a formula, as a tree `checkSizes` can walk.
    The tests have no DOM, so the markup is read with a small tag reader. */
function built(formula, displayMode = false) {
  const markup = katex.renderToString(formula, { output: "mathml", displayMode, trust: false, maxSize: largest, maxExpand: 1000, strict: "ignore" });
  const root = { attributes: [], children: [] };
  const open = [root];
  for (const [, closing, , attributes, selfClosing] of markup.matchAll(/<(\/?)([a-zA-Z]+)([^>]*?)(\/?)>/g)) {
    if (closing) {
      open.pop();
      continue;
    }
    const element = { attributes: [...attributes.matchAll(/([a-zA-Z-]+)="([^"]*)"/g)].map(([, name, value]) => ({ name, value })), children: [] };
    open.at(-1).children.push(element);
    if (!selfClosing) open.push(element);
  }
  return root;
}

const passes = (formula) => {
  checkSizes(built(formula));
  return true;
};

test("ordinary formulas pass", () => {
  for (const formula of [
    "x^2",
    "\\frac{1}{2}",
    "\\begin{pmatrix}a&b\\\\c&d\\end{pmatrix}",
    "\\hspace{3em}x",
    "\\mathrel{\\raisebox{0.2em}{=}}",
    "\\sum_{i=1}^n i",
    "\\Huge x",
    "\\llap{x}",
    "\\clap{x}",
    "\\rlap{x}",
    "\\genfrac{(}{)}{2pt}{0}{a}{b}",
  ]) {
    assert.ok(passes(formula), formula);
  }
  checkSizes(built("x\\tag{1}", true));
});

test("sizes that pass KaTeX's own limit are caught", () => {
  for (const formula of ["\\raisebox{500em}{x}", "\\rule[-500em]{1em}{1em}", "\\kern-500em x", "\\raisebox{-90000em}{x}"]) {
    assert.throws(() => checkSizes(built(formula)), /more room/, formula);
  }
});

test("sizes that are each small but add up are caught", () => {
  assert.throws(() => checkSizes(built("\\Huge{".repeat(8) + "x" + "}".repeat(8))), /more room/);
  assert.throws(() => checkSizes(built("\\Huge{\\Huge{x}}")), /more room/);
  assert.throws(() => checkSizes(built("\\raisebox{15em}{\\raisebox{15em}{x}}")), /more room/);
  assert.throws(() => checkSizes(built("\\Huge{\\rule{15em}{1em}}")), /more room/);
});

test("each unit is read, and what cannot be read counts as too large", () => {
  assert.equal(sizeOf("width", "2em"), 2);
  assert.equal(sizeOf("width", "-3em"), 3);
  assert.equal(sizeOf("voffset", "10pt"), 1);
  assert.equal(sizeOf("rowspacing", "0.16em 30em"), 30);
  assert.equal(sizeOf("linethickness", "40em"), 40);
  assert.equal(sizeOf("width", "-0.5width"), 0);
  assert.equal(sizeOf("width", "-3width"), Infinity);
  assert.equal(sizeOf("width", "100%"), 0);
  assert.equal(sizeOf("width", "900%"), Infinity);
  assert.equal(sizeOf("maxsize", "infinity"), Infinity);
  assert.equal(sizeOf("columnalign", "center"), 0);
  // A size that cannot be read as ems or a percentage is refused, so that it
  // can never shrink the scale to nothing and let what is inside it through.
  const inside = { attributes: [{ name: "width", value: "100em" }], children: [] };
  assert.throws(() => checkSizes({ attributes: [{ name: "mathsize", value: "50width" }], children: [inside] }), /more room/);
  assert.throws(() => checkSizes({ attributes: [{ name: "mathsize", value: "50%" }], children: [inside] }), /more room/);
  checkSizes({ attributes: [{ name: "mathsize", value: "70%" }], children: [] });
});

test("a formula that defines commands of its own is recognised", () => {
  // \tag keeps its text in \df@tag, which could then be called over and over.
  const retagged = String.raw`\tag{$` + "x+".repeat(1000) + "x$}" + String.raw`\df@tag`.repeat(284);
  for (const formula of ["\\def\\a{x}\\a", "\\newcommand{\\R}{\\mathbb{R}}", "\\gdef\\b{y}", "\\let\\c=x", "x \\global\\def\\d{z}", retagged, "\\bra@ket{x}", "\\current@color"]) {
    assert.ok(definesCommands.test(formula), formula);
  }
  for (const formula of ["\\left( x \\right)", "\\deg x", "\\delta", "\\letter", "\\defined", "a \\leq b", "x \\tag{1}", "\\braket{x|y}", "a @ b", "\\text{me@example.com}"]) {
    assert.ok(!definesCommands.test(formula), formula);
  }
});
