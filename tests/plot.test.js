import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluate } from "../src/plugins/plot/expression.ts";
import { parseSpec } from "../src/plugins/plot/spec.ts";
import { formatNumber, paths, position, preparePlot, ticks } from "../src/plugins/plot/scale.ts";

const plot = (text) => preparePlot(parseSpec(text));
const pieces = (text) => {
  const spec = parseSpec(text);
  const { samples, y } = preparePlot(spec);
  return paths(samples[0], spec.x, y, (p) => p);
};

test("the example draws two curves and constant-expression points", () => {
  const spec = parseSpec(`title: Sine and its tangent at zero
x: -2*pi .. 2*pi
y = sin(x)
y = x
points: (0, 0), (pi/2, 1)`);
  assert.equal(spec.title, "Sine and its tangent at zero");
  assert.deepEqual(spec.x, [-2 * Math.PI, 2 * Math.PI]);
  assert.deepEqual(spec.series.map((s) => s.kind), ["curve", "curve", "points"]);
  assert.deepEqual(spec.series[2].points, [[0, 0], [Math.PI / 2, 1]]);
  assert.equal(evaluate(spec.series[0].y, Math.PI / 2), 1);
});

test("all line forms allow surrounding whitespace and ignore blank and comment lines", () => {
  const spec = parseSpec(` # a comment\r
 title: Measurements \r
xlabel: Time (s)
ylabel: Height
x: -1 .. 5
y: -2 .. 8

f(x) = x^2
(cos(t), sin(t)), t: 0 .. tau
points Measured: (min(1, 2), max(3, 4)), (2pi, sqrt(4))
line Fit: (0, 1), (2, 3)
line: (0, 0)`);
  assert.equal(spec.title, "Measurements");
  assert.equal(spec.xlabel, "Time (s)");
  assert.equal(spec.ylabel, "Height");
  assert.deepEqual(spec.x, [-1, 5]);
  assert.deepEqual(spec.y, [-2, 8]);
  assert.equal(spec.series[0].named, true);
  assert.equal(spec.series[0].label, "f");
  assert.equal(spec.series[0].formula, "f(x) = x^2");
  assert.equal(spec.series[1].kind, "parametric");
  assert.deepEqual(spec.series[1].t, [0, 2 * Math.PI]);
  assert.equal(spec.series[2].label, "Measured");
  assert.deepEqual(spec.series[2].points, [[1, 4], [2 * Math.PI, 2]]);
  assert.equal(spec.series[3].label, "Fit");
  assert.equal(spec.series[4].named, false);
});

test("omitted ranges choose defaults and retain supplied data extremes", () => {
  assert.deepEqual(parseSpec("y = x").x, [-10, 10]);
  assert.equal(parseSpec("y = x").y, undefined);
  const { y } = plot("y = 1/x");
  assert.ok(y[0] < -1 && y[0] > -4);
  assert.ok(y[1] > 1 && y[1] < 4);
  assert.deepEqual(plot("y: -2 .. 2\ny = 1/x").y, [-2, 2]);
  assert.deepEqual(plot("y = 0").y, [-1, 1]);
  const data = plot("points: (0, 1), (1, 1000)");
  assert.ok(data.y[0] < 1 && data.y[1] > 1000);
  const crossing = plot("line: (-20, 100), (20, 100)");
  assert.ok(crossing.y[0] < 100 && crossing.y[1] > 100);
  assert.deepEqual(plot("points: (100, 100)").y, [-1, 1]);
});

test("bad settings, line forms and coordinates name the offending line", () => {
  const errors = [
    ["title:", /Add text/], ["xlabel:", /Add text/], ["ylabel:", /Add text/],
    ["colour: red", /Write a title/], ["y == x", /Use only/],
    ["x: 1", /Write the range/], ["y: 1 .. 2 .. 3", /Write the range/],
    ["x: 1 .. 1", /lower end/], ["y: 2 .. -2", /lower end/],
    ["x: x .. 2", /unknown name x/], ["x: 0 .. 1/0", /finite number/],
    ["x: -1e308 .. 1e308", /closer together/],
    ["points:", /Write each point/], ["points: 1, 2", /Write each point/],
    ["points: (1, 2),", /Write each point/], ["line: (1, 2, 3)", /two expressions/],
    ["points: (1)", /two expressions/], ["points: (, 1)", /Add a number/],
    ["line: (x, 2)", /unknown name x/], ["points: (1/0, 2)", /finite number/],
    ["line: (1, 2", /Close each/], ["line: (1, 2))", /Match each/],
    ["(cos(t), sin(t))", /parametric curve/], ["(t,t), s: 0 .. 1", /parametric curve/],
    ["(t), t: 0 .. 1", /two expressions/], ["(t,t), t: 1 .. 0", /lower end/],
    ["(x,t), t: 0 .. 1", /unknown name x/], ["y = t", /unknown name t/],
    ["f(t) = t", /Write a title/], ["y = sin(x) # comment", /Use only/],
  ];
  for (const [source, reason] of errors) {
    assert.throws(() => parseSpec(`# comment\n${source}\ny = x`), (error) => {
      assert.match(error.message, /^Line 2: .+\.$/, source);
      assert.match(error.message, reason, source);
      return true;
    });
  }
  for (const source of ["", "# comment", "title: Empty"]) {
    assert.throws(() => parseSpec(source), /Line 1: Add a curve or some points/);
  }
});

test("settings cannot silently override an earlier setting", () => {
  for (const setting of ["title: Title", "xlabel: X", "ylabel: Y", "x: 0 .. 1", "y: 0 .. 1"]) {
    assert.throws(() => parseSpec(`${setting}\n${setting}\ny = x`), /Line 2: Keep just one/);
  }
});

test("source, line, curve and coordinate expression limits are enforced", () => {
  assert.equal(parseSpec("y = x\n#" + "a".repeat(3993)).series.length, 1);
  assert.throws(() => parseSpec("y = x\n#" + "a".repeat(3994)), /Line 2: Shorten this plot to 4,000/);
  assert.equal(parseSpec("\n".repeat(39) + "y = x").series.length, 1);
  assert.throws(() => parseSpec("\n".repeat(40) + "y = x"), /Line 41: Shorten this plot to 40/);
  assert.equal(parseSpec(Array(8).fill("y = x").join("\n")).series.length, 8);
  for (const ninth of ["y = x", "(t,t), t: 0 .. 1"]) {
    assert.throws(() => parseSpec(Array(8).fill("y = x").concat(ninth).join("\n")), /Line 9: Use no more than eight/);
  }
  for (const source of ["y = ", "x: 0 .. ", "points: (0, "]) {
    assert.throws(() => parseSpec(source + "1".repeat(201) + (source.startsWith("points") ? ")" : "")), /200 characters/);
  }
  // Even the shortest 2,001-point list exceeds the source limit first.
  assert.throws(() => parseSpec("points: " + Array(2001).fill("(0,0)").join(",")), /4,000 characters/);
  assert.throws(() => parseSpec("points: (" + "(".repeat(65) + "1" + ")".repeat(65) + ",0)"), /64 nested/);
});

test("ticks use round steps across ordinary, small and negative ranges", () => {
  assert.deepEqual(ticks([-10, 10]), [-10, -5, 0, 5, 10]);
  assert.deepEqual(ticks([0, 6]), [0, 1, 2, 3, 4, 5, 6]);
  assert.deepEqual(ticks([0, 10]), [0, 2, 4, 6, 8, 10]);
  assert.deepEqual(ticks([-9, -1]), [-8, -6, -4, -2]);
  assert.deepEqual(ticks([0, 0.006]), [0, 0.001, 0.002, 0.003, 0.004, 0.005, 0.006]);
  assert.equal(formatNumber(-2 * Math.PI), "-6.28");
  assert.equal(formatNumber(-0), "0");
  assert.equal(formatNumber(1000.2, 1), "1000.2");
  assert.equal(formatNumber(1000.4, 1), "1000.4");
  for (const range of [[0, 5e-324], [1e300, 1.000000000000001e300]]) {
    const values = ticks(range);
    assert.ok(values.length <= 10);
    assert.ok(values.every(Number.isFinite));
  }
});

test("sampling is bounded and a parametric circle closes", () => {
  const { samples, y } = plot("y = sin(x)\n(cos(t),sin(t)), t: 0 .. tau");
  assert.equal(samples[0].points.length, 401);
  assert.equal(samples[1].points.length, 601);
  assert.deepEqual(samples[1].points[0], [1, 0]);
  assert.ok(Math.abs(samples[1].points.at(-1)[1]) < 1e-12);
  assert.equal(paths(samples[1], [-10, 10], y, (p) => p).length, 1);
});

test("reciprocals and tangents break at poles, including poles between samples", () => {
  assert.equal(pieces("y = 1/x").length, 2);
  assert.equal(pieces("x: -1 .. 1\ny: -10 .. 10\ny = 1/(x-0.001)").length, 2);
  assert.equal(pieces("x: -pi .. pi\ny = tan(x)").length, 3);
  assert.equal(pieces("y = sin(x)").length, 1);
  assert.equal(pieces("y = x^2").length, 1);
  assert.equal(pieces("y: -1 .. 1\ny = 1000*x").length, 1);
});

test("step functions break instead of joining neighbouring levels", () => {
  const { samples } = plot("x: -2 .. 2\ny = floor(x)");
  const breaks = [...samples[0].breaks];
  assert.equal(breaks.length, 4);
  for (const index of breaks) assert.notEqual(samples[0].points[index - 1][1], samples[0].points[index][1]);
});

test("non-real portions leave gaps and an entirely non-real series explains why", () => {
  assert.equal(pieces("y = sqrt(x)").length, 1);
  assert.equal(pieces("y = sqrt(x^2-1)").length, 2);
  assert.throws(() => plot("# comment\ny = sqrt(-1)"), /Line 2: Change this expression or its range/);
  assert.throws(() => plot("(1/0,t), t: 0 .. 1"), /real, finite points/);
});

test("data lines join their marks in order even across the visible range", () => {
  const { samples } = plot("y: -1 .. 1\nline: (0, -100), (1, 100), (0, 0)");
  assert.deepEqual(paths(samples[0], [-10, 10], [-1, 1], (p) => p), ["M0.495,-1L0.505,1", "M0.01,1L0,0"]);
  assert.equal(samples[0].breaks.size, 0);
});

test("extreme finite values cannot produce non-finite SVG coordinates", () => {
  const spec = parseSpec("x: 0 .. 1e-300\ny: 0 .. 1e-300\nline: (-1e308, -1e308), (1e308, 1e308)");
  const { samples, y } = preparePlot(spec);
  const d = paths(samples[0], spec.x, y, ([x, value]) => [position(x, spec.x), position(value, y)]).join("");
  assert.doesNotMatch(d, /NaN|Infinity/);
  assert.ok(plot("y = 1e308").y.every(Number.isFinite));
  assert.throws(() => plot("points: (0, -1e308), (1, 1e308)"), /Set a narrower y: range/);
});

test("clipping distant data retains the line's slope inside the frame", () => {
  const { samples } = plot("line: (0,0), (1e10,1e20)");
  assert.deepEqual(paths(samples[0], [-10, 10], [-1, 1], (p) => p), ["M0,0L0,1"]);
});
