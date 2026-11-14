import { evaluate, fail } from "./expression.ts";
import type { PlotSpec, Point, Range, Series } from "./spec.ts";

export interface SampledSeries {
  series: Series;
  points: Point[];
  /** Indices where a new piece starts instead of joining its neighbour. */
  breaks: Set<number>;
}

export function finite(point: Point): boolean {
  return Number.isFinite(point[0]) && Number.isFinite(point[1]);
}

function at(series: Series, value: number): Point {
  if (series.kind === "curve") return [value, evaluate(series.y, value)];
  if (series.kind === "parametric") return [evaluate(series.x, value), evaluate(series.y, value)];
  return [NaN, NaN];
}

function sample(series: Series, x: Range): SampledSeries {
  if (series.kind === "points" || series.kind === "line") return { series, points: series.points, breaks: new Set() };
  const range = series.kind === "parametric" ? series.t : x;
  const intervals = series.kind === "curve" ? 400 : 600;
  const points = Array.from({ length: intervals + 1 }, (_, index) => at(series, interpolate(range, index / intervals)));
  if (!points.some(finite)) fail(series.line, "Change this expression or its range so it gives real, finite points.");
  return { series, points, breaks: new Set() };
}

function interpolate(range: Range, fraction: number): number {
  const span = range[1] - range[0];
  return Number.isFinite(span) ? range[0] + span * fraction : range[0] * (1 - fraction) + range[1] * fraction;
}

/** Extreme curve tails do not get to flatten the rest of a plot. Supplied
    data is deliberate, so all of its visible points contribute to the range. */
function autoRange(samples: SampledSeries[], x: Range): Range {
  const bounds: number[] = [];
  for (const { series, points } of samples) {
    const ys = points.filter((p) => finite(p) && p[0] >= x[0] && p[0] <= x[1]).map((p) => p[1]);
    // A data line can cross the whole frame with both marks outside it.
    // Include its intersections with the sides when choosing the y range.
    if (series.kind === "line" || series.kind === "parametric") {
      for (let index = 1; index < points.length; index++) {
        const a = points[index - 1];
        const b = points[index];
        if (!finite(a) || !finite(b) || (a[0] >= x[0] && a[0] <= x[1] && b[0] >= x[0] && b[0] <= x[1])) continue;
        const segment = clip(a, b, x, [-Number.MAX_VALUE, Number.MAX_VALUE]);
        if (segment) ys.push(segment[0][1], segment[1][1]);
      }
    }
    ys.sort((a, b) => a - b);
    if (!ys.length) continue;
    const trim = series.kind === "curve" || series.kind === "parametric" ? Math.floor(ys.length * 0.02) : 0;
    bounds.push(ys[trim], ys[ys.length - 1 - trim]);
  }
  if (!bounds.length) return [-1, 1];
  const low = Math.min(...bounds);
  const high = Math.max(...bounds);
  const span = high - low;
  if (!Number.isFinite(span)) fail(samples[0].series.line, "Set a narrower y: range to show these very large values.");
  const padding = span === 0 ? Math.max(Math.abs(low) * 0.05, 1) : span * 0.05;
  // Padding must not turn otherwise drawable finite values into infinity.
  const padded: Range = [Math.max(-Number.MAX_VALUE, low - padding), Math.min(Number.MAX_VALUE, high + padding)];
  return Number.isFinite(padded[1] - padded[0]) ? padded : [low, high];
}

function distance(a: Point, b: Point, x: Range, y: Range): number {
  return Math.max(Math.abs((a[0] - b[0]) / (x[1] - x[0])), Math.abs((a[1] - b[1]) / (y[1] - y[0])));
}

/** A jump keeps nearly all its height as the interval shrinks; a smooth
    steep curve does not. Only uneven intervals need this extra sampling. */
function jumps(series: Series, start: number, end: number, a: Point, b: Point, x: Range, y: Range): boolean {
  // A segment wholly beyond one edge cannot draw a false stroke in the frame.
  if ((a[0] < x[0] && b[0] < x[0]) || (a[0] > x[1] && b[0] > x[1]) ||
      (a[1] < y[0] && b[1] < y[0]) || (a[1] > y[1] && b[1] > y[1])) return false;
  const whole = distance(a, b, x, y);
  if (whole < 0.00001) return false;
  for (let step = 0; step < 8; step++) {
    const middle = start + (end - start) / 2;
    const point = at(series, middle);
    if (!finite(point)) return true;
    const left = distance(a, point, x, y);
    const right = distance(point, b, x, y);
    if (Math.max(left, right) < whole * 0.8) return false;
    if (left > right) { end = middle; b = point; }
    else { start = middle; a = point; }
  }
  return true;
}

export function preparePlot(spec: PlotSpec): { samples: SampledSeries[]; y: Range } {
  const samples = spec.series.map((series) => sample(series, spec.x));
  const y = spec.y ?? autoRange(samples, spec.x);
  for (const sampled of samples) {
    const { series, points, breaks } = sampled;
    if (series.kind === "line" || series.kind === "points") continue;
    const range = series.kind === "parametric" ? series.t : spec.x;
    for (let index = 1; index < points.length; index++) {
      if (!finite(points[index - 1]) || !finite(points[index]) || jumps(
        series, interpolate(range, (index - 1) / (points.length - 1)), interpolate(range, index / (points.length - 1)),
        points[index - 1], points[index], spec.x, y,
      )) breaks.add(index);
    }
  }
  return { samples, y };
}

/** Roughly six ticks, with steps people can read and compare at a glance. */
export function ticks(range: Range): number[] {
  const raw = (range[1] - range[0]) / 6;
  if (raw === 0) return [range[0], range[1]];
  const power = 10 ** Math.floor(Math.log10(raw));
  if (power === 0) return [range[0], range[1]];
  const fraction = raw / power;
  const step = (fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10) * power;
  const first = Math.ceil(range[0] / step);
  const result: number[] = [];
  // Counting, rather than adding a tiny step to a large number repeatedly,
  // also keeps ranges near the limits of floating-point arithmetic bounded.
  for (let index = 0; index < 10; index++) {
    const value = (first + index) * step;
    if (value > range[1] + step * 1e-10) break;
    if (Number.isFinite(value) && value >= range[0] && !result.includes(value)) result.push(value === 0 ? 0 : value);
  }
  return result;
}

export function formatNumber(value: number, span?: number): string {
  // Close ticks at a large offset need more digits to remain distinct.
  const digits = span ? Math.ceil(Math.log10(Math.abs(value)) - Math.log10(span) + 2) : 3;
  return Number(value.toPrecision(Math.min(17, Math.max(3, digits)))).toString();
}

export function position(value: number, range: Range): number {
  return (value - range[0]) / (range[1] - range[0]);
}

/** Clip before projecting, so even a distant data point keeps its line's
    true slope and never sends enormous coordinates to SVG. */
function clip(a: Point, b: Point, x: Range, y: Range): [Point, Point] | undefined {
  a = [...a];
  b = [...b];
  for (const axis of [0, 1] as const) {
    const range = axis === 0 ? x : y;
    for (const edge of [0, 1] as const) {
      const bound = range[edge];
      const outsideA = edge === 0 ? a[axis] < bound : a[axis] > bound;
      const outsideB = edge === 0 ? b[axis] < bound : b[axis] > bound;
      if (outsideA && outsideB) return;
      if (outsideA === outsideB) continue;
      const from = outsideA ? b : a;
      const to = outsideA ? a : b;
      const span = to[axis] - from[axis];
      const fraction = Number.isFinite(span)
        ? (bound - from[axis]) / span
        : (bound / 2 - from[axis] / 2) / (to[axis] / 2 - from[axis] / 2);
      const other = axis === 0 ? 1 : 0;
      to[other] = interpolate([from[other], to[other]], fraction);
      to[axis] = bound;
    }
  }
  return [a, b];
}

export function paths(sampled: SampledSeries, x: Range, y: Range, project: (point: Point) => Point): string[] {
  const pieces: string[] = [];
  let piece = "";
  let last = "";
  const coordinate = (point: Point) => project(point).map((n) => Number(n.toFixed(3))).join(",");
  for (let index = 1; index < sampled.points.length; index++) {
    const a = sampled.points[index - 1];
    const b = sampled.points[index];
    const segment = finite(a) && finite(b) && !sampled.breaks.has(index) ? clip(a, b, x, y) : undefined;
    if (!segment) {
      if (piece) pieces.push(piece);
      piece = "";
      last = "";
      continue;
    }
    const start = coordinate(segment[0]);
    const end = coordinate(segment[1]);
    if (piece && last !== start) { pieces.push(piece); piece = ""; }
    piece += `${piece ? "" : `M${start}`}L${end}`;
    last = end;
  }
  if (piece) pieces.push(piece);
  return pieces;
}
