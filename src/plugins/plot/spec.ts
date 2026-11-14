import { evaluate, fail, parseExpression } from "./expression.ts";
import type { Expression } from "./expression.ts";

export type Range = [number, number];
export type Point = [number, number];
interface SeriesLabel {
  label: string;
  named: boolean;
  line: number;
}
export type Series = SeriesLabel & (
  | { kind: "curve"; y: Expression; formula: string }
  | { kind: "parametric"; x: Expression; y: Expression; t: Range }
  | { kind: "points" | "line"; points: Point[] }
);
export interface PlotSpec {
  title?: string;
  xlabel?: string;
  ylabel?: string;
  x: Range;
  y?: Range;
  series: Series[];
}

function number(text: string, line: number): number {
  const value = evaluate(parseExpression(text.trim(), undefined, line));
  if (!Number.isFinite(value)) fail(line, "Use an expression that gives a finite number here.");
  return value;
}

function range(text: string, line: number): Range {
  const ends = text.split("..");
  if (ends.length !== 2) fail(line, "Write the range as a lower number followed by .. and a higher number.");
  const low = number(ends[0], line);
  const high = number(ends[1], line);
  if (!(high > low)) fail(line, "Put the lower end of the range before the higher end.");
  if (!Number.isFinite(high - low)) fail(line, "Bring the ends of this range closer together.");
  return [low, high];
}

/** Commas inside a function belong to that function, not to the point list. */
function splitOutside(text: string, line: number): string[] {
  let depth = 0;
  let start = 0;
  const parts: string[] = [];
  for (let at = 0; at < text.length; at++) {
    if (text[at] === "(") depth++;
    if (text[at] === ")") depth--;
    if (depth < 0) fail(line, "Match each closing bracket with an opening bracket.");
    if (depth > 65) fail(line, "Use no more than 64 nested brackets inside a point.");
    if (text[at] === "," && depth === 0) {
      parts.push(text.slice(start, at).trim());
      start = at + 1;
    }
  }
  if (depth !== 0) fail(line, "Close each opening bracket with a closing bracket.");
  parts.push(text.slice(start).trim());
  return parts;
}

function pair(text: string, line: number): [string, string] {
  if (!text.startsWith("(") || !text.endsWith(")")) fail(line, "Write each point as two numbers in brackets, like (1, 2).");
  const values = splitOutside(text.slice(1, -1), line);
  if (values.length !== 2) fail(line, "Put two expressions separated by a comma inside each point's brackets.");
  return [values[0], values[1]];
}

/** Every line is checked before sampling, so an unfinished or misspelled
    instruction cannot silently change the meaning of a plot. */
export function parseSpec(source: string): PlotSpec {
  if (source.length > 4_000) {
    const line = source.slice(0, 4_000).split("\n").length;
    fail(line, "Shorten this plot to 4,000 characters or fewer.");
  }
  const lines = source.split(/\r?\n/);
  if (lines.length > 40) fail(41, "Shorten this plot to 40 lines or fewer.");
  const spec: PlotSpec = { x: [-10, 10], series: [] };
  const settings = new Set<string>();
  let curves = 0;
  let points = 0;
  for (let index = 0; index < lines.length; index++) {
    const text = lines[index].trim();
    const line = index + 1;
    if (!text || text.startsWith("#")) continue;
    const setting = /^(title|xlabel|ylabel|x|y):\s*(.*)$/.exec(text);
    if (setting) {
      const [, key, value] = setting;
      if (settings.has(key)) fail(line, `Keep just one ${key} setting in this plot.`);
      settings.add(key);
      if (key === "x" || key === "y") spec[key] = range(value, line);
      else {
        if (!value) fail(line, `Add text after ${key}: or remove this line.`);
        if (key === "title") spec.title = value;
        if (key === "xlabel") spec.xlabel = value;
        if (key === "ylabel") spec.ylabel = value;
      }
      continue;
    }
    const data = /^(points|line)(?:\s+([^:]+))?:\s*(.*)$/.exec(text);
    if (data) {
      const kind = data[1] as "points" | "line";
      const label = data[2]?.trim();
      const values = splitOutside(data[3], line).map((text): Point => {
        if (++points > 2_000) fail(line, "Use no more than 2,000 data points in one plot.");
        const [x, y] = pair(text, line);
        return [number(x, line), number(y, line)];
      });
      spec.series.push({ kind, label: label || (kind === "points" ? "Points" : "Data line"), named: !!label, points: values, line });
      continue;
    }
    const curve = /^(y|([A-Za-z_][A-Za-z_0-9]*)\(x\))\s*=\s*(.*)$/.exec(text);
    if (curve) {
      if (++curves > 8) fail(line, "Use no more than eight curves in one plot.");
      spec.series.push({
        kind: "curve", y: parseExpression(curve[3], "x", line), formula: text,
        label: curve[2] ?? text, named: !!curve[2], line,
      });
      continue;
    }
    if (text.startsWith("(")) {
      if (++curves > 8) fail(line, "Use no more than eight curves in one plot.");
      const parts = splitOutside(text, line);
      if (parts.length !== 2 || !/^t:\s*/.test(parts[1])) {
        fail(line, "Write a parametric curve as (x expression, y expression), t: lower .. higher.");
      }
      const [x, y] = pair(parts[0], line);
      spec.series.push({
        kind: "parametric", x: parseExpression(x, "t", line), y: parseExpression(y, "t", line),
        t: range(parts[1].slice(2), line), label: parts[0], named: false, line,
      });
      continue;
    }
    fail(line, "Write a title, axis label, range, curve, points or data line here.");
  }
  if (!spec.series.length) fail(1, "Add a curve or some points to draw a plot.");
  return spec;
}
