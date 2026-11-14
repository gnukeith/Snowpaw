/* Finding the formulas in a message before it is read as Markdown.

   Models mark formulas four ways: $x$ and \(x\) inside a line, $$x$$ and
   \[x\] on lines of their own. The Markdown reader knows only the dollar
   forms, and reads every pair of dollar signs as a formula, so "$5 and $10"
   would turn into one. This rewrites a message so that the reader sees a
   formula exactly where there is one: the bracket forms become dollar forms,
   and a dollar sign that is not part of a formula is escaped.

   The text is written by an agent that may have read anything, so every
   search here only moves forward: the work grows with the length of the
   message and no faster, whatever it holds. */

import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";

/** Where code is, as [start, end) offsets: never rewritten. */
type Range = [number, number];

const reader = unified().use(remarkParse).use(remarkGfm);

/** The code in a message, found by the same Markdown reader that will draw
    it, so that indented code, fences inside lists and quotes, and code spans
    with long runs of backticks are all found as it will find them. */
function codeIn(text: string): Range[] {
  const ranges: Range[] = [];
  // A stack, not recursion, so deeply nested quotes cannot overflow it.
  const stack: unknown[] = [reader.parse(text)];
  while (stack.length > 0) {
    const node = stack.pop() as { type: string; children?: unknown[]; position?: { start: { offset?: number }; end: { offset?: number } } };
    const { start, end } = node.position ?? { start: {}, end: {} };
    if ((node.type === "code" || node.type === "inlineCode" || node.type === "html") && start.offset !== undefined && end.offset !== undefined) {
      ranges.push([start.offset, end.offset]);
    } else if (node.children) {
      stack.push(...node.children);
    }
  }
  return ranges.sort((a, b) => a[0] - b[0]);
}

/** The next place at or after `from` where `mark` stands, or Infinity. Asked
    only with `from` that never goes back, it reads each part of the text at
    most once. */
function seeker(text: string, mark: string | RegExp): (from: number) => number {
  let found = -1;
  return (from) => {
    if (found >= from || found === Infinity) return found;
    if (typeof mark === "string") {
      const at = text.indexOf(mark, from);
      found = at < 0 ? Infinity : at;
    } else {
      mark.lastIndex = from;
      const match = mark.exec(text);
      found = match ? match.index : Infinity;
    }
    return found;
  };
}

/** A dollar sign inside a formula, written so that the Markdown reader does
    not take it for the end of the formula. KaTeX draws it as `\$`. */
const dollar = "{\\char36}";

function inside(formula: string): string {
  return formula.replace(/\\?\$/g, dollar);
}

/**
 * A message's text with its formulas marked the one way the Markdown reader
 * understands. Code is left exactly as it is.
 *
 * A dollar sign opens a formula only if what follows it is not a space, and
 * the dollar sign that closes it has no space before it and no digit after
 * it. That is the rule pandoc uses, and it keeps prices out. A formula does
 * not reach across a blank line or into code.
 */
export function markFormulas(source: string): string {
  const text = source.replace(/\r\n?/g, "\n");
  const code = codeIn(text);
  const blank = seeker(text, /\n[ \t]*\n/g);
  const nextClose = seeker(text, "\\)");
  const nextCloseBlock = seeker(text, "\\]");
  const nextDouble = seeker(text, "$$");
  const nextLine = seeker(text, "\n");
  // Where the line holding `at` starts. `at` never goes back, so neither
  // does the search.
  let lineStart = 0;
  const startOfLine = (at: number) => {
    for (let newline = nextLine(lineStart); newline < at; newline = nextLine(lineStart)) lineStart = newline + 1;
    return lineStart;
  };
  /** What stands before a formula on its first line and after it on its
      last, which decides whether it has its lines to itself. */
  const around = (start: number, end: number): [string, string] => [
    text.slice(startOfLine(start), start),
    text.slice(end, Math.min(nextLine(end), text.length)),
  ];
  const spaced = (at: number) => /\s/.test(text[at - 1] ?? " ");
  // The next dollar sign that settles whether an open one is a formula:
  // one that can close it, or one with a space before it, which shows the
  // open one was not opening anything.
  let decisive = -1;
  const nextDecisive = (from: number) => {
    if (decisive >= from) return decisive;
    for (let at = from; at < text.length; at++) {
      if (text[at] !== "$" || text[at - 1] === "\\") continue;
      if (spaced(at) || !/\d/.test(text[at + 1] ?? "")) return (decisive = at);
    }
    return (decisive = Infinity);
  };

  let out = "";
  let at = 0;
  let next = 0;
  while (at < text.length) {
    while (next < code.length && code[next][1] <= at) next++;
    const range = code[next];
    if (range && range[0] <= at) {
      out += text.slice(at, range[1]);
      at = range[1];
      continue;
    }
    // A formula ends before the next code and the next blank line.
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
        out += block ? display(formula, ...around(at, end + 2)) : `$${inside(formula.trim())}$`;
        at = end + 2;
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
        out += display(formula, ...around(at, end + 2));
        at = end + 2;
      }
    } else if (char === "$") {
      const end = /\s/.test(text[at + 1] ?? " ") ? Infinity : nextDecisive(at + 1);
      if (end < stop && !spaced(end)) {
        out += `$${inside(text.slice(at + 1, end))}$`;
        at = end + 1;
      } else {
        out += "\\$";
        at += 1;
      }
    } else {
      out += char;
      at += 1;
    }
  }
  return out;
}

/**
 * A formula marked for display. One with its line to itself goes on lines of
 * its own, each starting with what started its line, so a formula in a list
 * item or a quote stays in it. Any other stays in its line.
 */
function display(formula: string, before: string, after: string): string {
  // Only spaces and quote marks can come before it: after a list marker the
  // lines that follow would need the item's own indentation.
  const alone = /^[ \t>]*$/.test(before) && after.trim() === "";
  const body = inside(formula.trim());
  if (!alone) return `$$${body.replace(/\n/g, " ")}$$`;
  const prefix = before.replace(/[^\s>]/g, " ");
  // What came before is already written out, so the opening marks continue
  // its line; every later line repeats it.
  const lines = body.split("\n").map((line) => prefix + line.trim());
  return `$$\n${lines.join("\n")}\n${prefix}$$`;
}
