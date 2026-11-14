import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluate, parseExpression } from "../src/plugins/plot/expression.ts";

const read = (text, x = 0) => evaluate(parseExpression(text, "x"), x);

test("arithmetic has the usual precedence and powers associate to the right", () => {
  for (const [text, expected] of [
    ["2+3*4", 14], ["(2+3)*4", 20], ["12/3/2", 2], ["8-3-2", 3],
    ["2^3^2", 512], ["(2^3)^2", 64], ["-x^2", -9], ["(-x)^2", 9],
    ["2^-3", 0.125], ["-2^-2", -0.25], ["--x", 3], ["+x", 3],
    [".5 + 1. + 1e-3 + 2E+2", 201.501],
  ]) assert.equal(read(text, 3), expected, text);
});

test("only a numeric literal can be followed by implicit multiplication", () => {
  for (const [text, expected] of [
    ["2x", 6], ["-2x^2", -18], ["2(x+1)", 8], ["2sin(pi/2)", 2],
    ["2pi", Math.PI * 2], ["2e", Math.E * 2], ["2 x", 6], ["2*3x", 18],
  ]) assert.equal(read(text, 3), expected, text);
  for (const text of ["x(x+1)", "(x+1)(x-1)", "pi x", "(2)x", "sin(x)cos(x)", "x2", "2 3"]) {
    assert.throws(() => read(text), /^Error: Line 1:/, text);
  }
});

test("constants and the chosen variable have fixed meanings", () => {
  assert.equal(read("pi+e+tau"), Math.PI + Math.E + 2 * Math.PI);
  assert.equal(evaluate(parseExpression("2t", "t"), 3), 6);
  assert.throws(() => parseExpression("x"), /unknown name x/);
  assert.throws(() => parseExpression("t", "x"), /unknown name t/);
  assert.throws(() => parseExpression("x", "t"), /unknown name x/);
});

const unary = [
  ["sin", Math.sin], ["cos", Math.cos], ["tan", Math.tan],
  ["asin", Math.asin], ["acos", Math.acos], ["atan", Math.atan],
  ["sinh", Math.sinh], ["cosh", Math.cosh], ["tanh", Math.tanh],
  ["exp", Math.exp], ["ln", Math.log], ["log", Math.log],
  ["log2", Math.log2], ["log10", Math.log10], ["sqrt", Math.sqrt],
  ["cbrt", Math.cbrt], ["abs", Math.abs], ["floor", Math.floor],
  ["ceil", Math.ceil], ["round", Math.round], ["sign", Math.sign],
];
for (const [name, fn] of unary) {
  test(`${name} accepts exactly one argument`, () => {
    assert.equal(read(`${name}(0.5)`), fn(0.5));
    for (const args of ["", "1,2", "1,2,3", ",1", "1,"]) {
      assert.throws(() => read(`${name}(${args})`), new RegExp(`${name} needs one number`));
    }
    assert.throws(() => read(name), /needs one number/);
  });
}
for (const [name, fn] of [["min", Math.min], ["max", Math.max], ["atan2", Math.atan2], ["pow", Math.pow]]) {
  test(`${name} accepts exactly two arguments`, () => {
    assert.equal(read(`${name}(2,3)`), fn(2, 3));
    for (const args of ["", "1", "1,2,3", "1,"]) {
      assert.throws(() => read(`${name}(${args})`), new RegExp(`${name} needs two numbers`));
    }
  });
}

test("nested calls keep each function's arguments together", () => {
  assert.equal(read("max(min(1,2),pow(2,3))"), 8);
});

test("unknown names and JavaScript syntax never run", () => {
  for (const name of ["constructor", "__proto__", "toString", "random", "PI", "window", "process"]) {
    assert.throws(() => read(name), /unknown name/, name);
    assert.throws(() => read(`${name}(1)`), /unknown name/, name);
  }
  for (const text of ["Math.sin(x)", "x=2", "x[0]", "'x'", '"x"', "x;1", "x=>x", "1%2", "1&&2", "1|2", "1/**/2", "`x`", "2**3"]) {
    assert.throws(() => read(text), /^Error: Line 1:/, text);
  }
});

test("malformed expressions give an actionable error with the source line", () => {
  for (const text of ["", "1+", "(x", "sin(1", "1)", "1,2", "sin(,)", "1e999"]) {
    assert.throws(() => parseExpression(text, "x", 3), /^Error: Line 3: .+\.$/, text);
  }
  assert.throws(() => parseExpression("sin(1,2)", "x", 3), { message: "Line 3: sin needs one number in its brackets." });
});

test("expression length and recursive nesting are bounded at the boundary", () => {
  assert.equal(read("1".padEnd(200)), 1);
  assert.throws(() => read("1".padEnd(201)), /200 characters/);
  assert.equal(read("(".repeat(64) + "1" + ")".repeat(64)), 1);
  assert.throws(() => read("(".repeat(65) + "1" + ")".repeat(65)), /64 nested/);
  assert.equal(read("-".repeat(64) + "1"), 1);
  assert.throws(() => read("-".repeat(65) + "1"), /64 nested/);
  assert.equal(read("1^".repeat(64) + "1"), 1);
  assert.throws(() => read("1^".repeat(65) + "1"), /64 nested/);
});

test("undefined real values are left for the sampler to break", () => {
  assert.ok(Number.isNaN(read("sqrt(-1)")));
  assert.equal(read("1/0"), Infinity);
});
