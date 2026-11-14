/* Finding the formulas in a message before it is read as Markdown.

   Models mark formulas four ways: $x$ and \(x\) inside a line, $$x$$ and
   \[x\] on lines of their own. The Markdown reader's math knows only the
   dollar forms, and reads every pair of dollar signs as a formula, so
   "$5 and $10" would turn into one. This rewrites a message so that the
   reader sees a formula exactly where there is one, and nowhere else.

   - What is between the marks is never changed. Each formula is fenced with
     one more dollar sign than the longest run of them inside it, which is
     how the reader carries a formula's text whole.
   - A dollar sign that is not part of a formula is escaped.
   - Code, raw HTML, a link's address and an address shown as a link are
     never touched. A formula does not reach into or across them, nor across
     a blank line.

   The text is written by an agent that may have read anything, so every
   search only moves forward, and what is known about a line is worked out
   once: the work grows with the length of the message and no faster. */

import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";

/** The most formulas one message may have drawn. More, and it is read as
    text: each formula costs a render of its own. */
export const mostFormulas = 500;

/** Parts of the message that are never rewritten, as [start, end) offsets. */
type Range = [number, number];

interface Node {
  type: string;
  url?: string;
  value?: string;
  children?: Node[];
  position?: { start: { offset?: number }; end: { offset?: number } };
}

const reader = unified().use(remarkParse).use(remarkGfm);

/** Where the Markdown reader, the same one that will draw the message, finds
    code, raw HTML and link addresses. */
function untouchable(text: string): Range[] {
  const ranges: Range[] = [];
  const span = (node: Node): Range | undefined => {
    const { start, end } = node.position ?? { start: {}, end: {} };
    return start.offset === undefined || end.offset === undefined ? undefined : [start.offset, end.offset];
  };
  // A stack, not recursion, so deeply nested quotes cannot overflow it.
  const stack: Node[] = [reader.parse(text) as Node];
  while (stack.length > 0) {
    const node = stack.pop()!;
    const whole = span(node);
    if (!whole) continue;
    if (node.type === "code" || node.type === "inlineCode" || node.type === "html" || node.type === "image" || node.type === "imageReference") {
      ranges.push(whole);
    } else if (node.type === "link" || node.type === "linkReference") {
      const children = (node.children ?? []).map(span).filter((one): one is Range => one !== undefined);
      // An address shown as its own link ("<https://...>" or a bare one) is
      // all address. Otherwise the text may hold formulas, the rest not.
      const bare = text[whole[0]] === "<" || node.children?.length === 1 && node.children[0].value === node.url;
      if (bare || children.length === 0) {
        ranges.push(whole);
      } else {
        ranges.push([whole[0], children[0][0]], [children[children.length - 1][1], whole[1]]);
        stack.push(...(node.children ?? []));
      }
    } else if (node.children) {
      stack.push(...node.children);
    }
  }
  return ranges.sort((a, b) => a[0] - b[0]);
}

/** The next place at or after `from` where `mark` stands, or Infinity. As
    long as `from` does not go back, each part of the text is read at most
    once. */
function seeker(text: string, mark: string | RegExp): (from: number) => number {
  let found = -1;
  return (from) => {
    if (found >= from) return found;
    if (typeof mark === "string") {
      const at = text.indexOf(mark, from);
      found = at < 0 ? Infinity : at;
    } else {
      mark.lastIndex = from;
      found = mark.exec(text)?.index ?? Infinity;
    }
    return found;
  };
}

/** Whether the character at `at` is escaped: an odd number of backslashes
    stand right before it. */
function escaped(text: string, at: number): boolean {
  let count = 0;
  while (text[at - 1 - count] === "\\") count++;
  return count % 2 === 1;
}

/** Enough dollar signs to fence a formula: one more than the longest run of
    them inside it, and at least `least`. */
function fenceFor(formula: string, least: number): string {
  let longest = 0;
  for (const run of formula.match(/\$+/g) ?? []) longest = Math.max(longest, run.length);
  return "$".repeat(Math.max(least, longest + 1));
}

/** What is known about each line, worked out when first asked for. */
function lines(text: string) {
  const starts = [0];
  for (let at = text.indexOf("\n"); at >= 0; at = text.indexOf("\n", at + 1)) starts.push(at + 1);
  const known = new Map<number, { start: number; prefixEnd: number; last: number; quotes: number }>();
  /** The line holding `at`: where it starts, where the spaces and quote
      marks that open it end, where its last visible character is, and how
      many quote marks open it. */
  return (at: number) => {
    let low = 0;
    let high = starts.length - 1;
    while (low < high) {
      const middle = (low + high + 1) >> 1;
      if (starts[middle] <= at) low = middle;
      else high = middle - 1;
    }
    const cached = known.get(low);
    if (cached) return cached;
    const start = starts[low];
    const end = low + 1 < starts.length ? starts[low + 1] - 1 : text.length;
    let prefixEnd = start;
    let quotes = 0;
    while (prefixEnd < end && /[ \t>]/.test(text[prefixEnd])) quotes += text[prefixEnd++] === ">" ? 1 : 0;
    let last = end - 1;
    while (last >= start && /\s/.test(text[last])) last--;
    const line = { start, prefixEnd, last, quotes };
    known.set(low, line);
    return line;
  };
}

/** A message's text with its formulas marked the one way the Markdown
    reader understands, and how many it holds. */
export function markFormulas(source: string): { text: string; formulas: number } {
  const text = source.replace(/\r\n?/g, "\n");
  const fixed = untouchable(text);
  const lineOf = lines(text);
  const blank = seeker(text, /\n[ \t>]*\n/g);
  const nextClose = seeker(text, "\\)");
  const nextCloseBlock = seeker(text, "\\]");
  const nextDouble = seeker(text, "$$");
  const spaced = (at: number) => /\s/.test(text[at - 1] ?? " ");
  // The next dollar sign that settles whether an open one is a formula: one
  // that can close it, or one with a space before it, which shows the open
  // one was not opening anything. A dollar sign followed by a digit and not
  // spaced settles nothing ("$1$2" is not a formula).
  let decisive = -1;
  const nextDecisive = (from: number) => {
    if (decisive >= from) return decisive;
    for (let at = from; at < text.length; at++) {
      if (text[at] !== "$" || escaped(text, at)) continue;
      if (spaced(at) || !/\d/.test(text[at + 1] ?? "")) return (decisive = at);
    }
    return (decisive = Infinity);
  };

  /** A formula for display from `start` to `end`, written on lines of its
      own if it has its lines to itself, each line opened as its first one
      was, so it stays inside a list item or a quote. */
  const display = (formula: string, start: number, end: number) => {
    const first = lineOf(start);
    const last = lineOf(end - 1);
    const body = unquote(formula, first.quotes).trim();
    const alone = start <= first.prefixEnd && end > last.last;
    const fence = fenceFor(body, 2);
    if (!alone) return `${fence}${body.replace(/\n/g, " ")}${fence}`;
    const prefix = text.slice(first.start, first.prefixEnd).replace(/\t/g, " ");
    // What came before is already written out, so the fence continues its
    // line; every later line repeats it.
    return `${fence}\n${body.split("\n").map((line) => prefix + line.trim()).join("\n")}\n${prefix}${fence}`;
  };

  /** A formula inside a line, fenced to carry its text whole. */
  const inline = (formula: string, start: number) => {
    const body = unquote(formula, lineOf(start).quotes).trim();
    const fence = fenceFor(body, 1);
    return `${fence}${body}${fence}`;
  };

  let out = "";
  let at = 0;
  let next = 0;
  let count = 0;
  while (at < text.length) {
    while (next < fixed.length && fixed[next][1] <= at) next++;
    const range = fixed[next];
    if (range && range[0] <= at) {
      out += text.slice(at, range[1]);
      at = range[1];
      continue;
    }
    // A formula ends before the next untouchable part and the next blank line.
    const stop = Math.min(range ? range[0] : text.length, blank(at));
    const char = text[at];

    if (char === "\\" && (text[at + 1] === "(" || text[at + 1] === "[")) {
      const block = text[at + 1] === "[";
      const end = block ? nextCloseBlock(at + 2) : nextClose(at + 2);
      const formula = end < stop ? text.slice(at + 2, end) : "";
      if (formula.trim() === "") {
        out += text.slice(at, at + 2);
        at += 2;
      } else {
        out += block ? display(formula, at, end + 2) : inline(formula, at);
        at = end + 2;
        count++;
      }
    } else if (char === "\\") {
      // An escaped character, a dollar sign among them, stays escaped.
      out += text.slice(at, at + 2);
      at += 2;
    } else if (char === "$" && text[at + 1] === "$") {
      const end = nextDouble(at + 2);
      const formula = end < stop ? text.slice(at + 2, end) : "";
      if (formula.trim() === "") {
        out += "\\$\\$";
        at += 2;
      } else {
        out += display(formula, at, end + 2);
        at = end + 2;
        count++;
      }
    } else if (char === "$") {
      const end = /\s/.test(text[at + 1] ?? " ") ? Infinity : nextDecisive(at + 1);
      if (end < stop && !spaced(end)) {
        out += inline(text.slice(at + 1, end), at);
        at = end + 1;
        count++;
      } else {
        out += "\\$";
        at += 1;
      }
    } else {
      out += char;
      at += 1;
    }
  }
  return count > mostFormulas ? { text: source, formulas: count } : { text: out, formulas: count };
}

/** A formula's text without the quote marks that open each of its lines
    after the first, which belong to the quote it sits in, not to it. */
function unquote(formula: string, quotes: number): string {
  if (quotes === 0 || !formula.includes("\n")) return formula;
  const opening = new RegExp(`^[ \\t]*(?:>[ \\t]?){0,${quotes}}`);
  return formula
    .split("\n")
    .map((line, index) => (index === 0 ? line : line.replace(opening, "")))
    .join("\n");
}
