/* Finding the formulas in a message before it is read as Markdown.

   Models mark formulas four ways: $x$ and \(x\) inside a line, $$x$$ and
   \[x\] on lines of their own. The Markdown reader knows only the dollar
   forms, and reads every pair of dollar signs as a formula, so "$5 and $10"
   would turn into one. This rewrites a message so that the reader sees a
   formula exactly where there is one: the bracket forms become dollar forms,
   and a dollar sign that is not part of a formula is escaped. */

/** How a line that opens or closes a fenced block of code starts. */
const fence = /^ {0,3}(`{3,}|~{3,})/;

/**
 * A message's text with its formulas marked the one way the Markdown reader
 * understands. Code, fenced or in a line, is left exactly as it is.
 *
 * A dollar sign opens a formula only if what follows it is not a space, and
 * the dollar sign that closes it has no space before it and no digit after
 * it. That is the rule pandoc uses, and it keeps prices out.
 */
export function markFormulas(text: string): string {
  const out: string[] = [];
  // Lines outside fenced code, gathered so that a formula may span them.
  let run: string[] = [];
  // The fence that opened the block of code being copied, if one is open.
  let open: string | undefined;
  const flush = () => {
    if (run.length > 0) out.push(prose(run.join("\n")));
    run = [];
  };
  for (const line of text.split("\n")) {
    const mark = fence.exec(line)?.[1];
    if (open) {
      out.push(line);
      if (mark?.startsWith(open) && line.trim() === mark) open = undefined;
    } else if (mark) {
      flush();
      open = mark;
      out.push(line);
    } else {
      run.push(line);
    }
  }
  flush();
  return out.join("\n");
}

/** The same, for text that is known to hold no fenced code. */
function prose(text: string): string {
  let out = "";
  let at = 0;
  /** Where `mark` next stands at or after `from`, before any blank line. */
  const find = (mark: string, from: number) => {
    const end = text.indexOf(mark, from);
    return end < 0 || /\n[ \t]*\n/.test(text.slice(from, end)) ? -1 : end;
  };
  /** A formula on lines of its own if it has its line to itself, else in the line. */
  const display = (inner: string, start: number, end: number) => {
    const lineEnd = text.indexOf("\n", end);
    const before = text.slice(text.lastIndexOf("\n", start - 1) + 1, start);
    const after = text.slice(end, lineEnd < 0 ? text.length : lineEnd);
    const alone = before.trim() === "" && after.trim() === "";
    return alone ? `\n$$\n${inner.trim()}\n$$\n` : `$$${inner.trim()}$$`;
  };

  while (at < text.length) {
    const char = text[at];
    if (char === "`") {
      // Code in a line: from a run of backticks to the next run as long.
      const ticks = /^`+/.exec(text.slice(at))![0];
      const end = text.indexOf(ticks, at + ticks.length);
      const stop = end < 0 ? at + ticks.length : end + ticks.length;
      out += text.slice(at, stop);
      at = stop;
    } else if (char === "\\" && (text[at + 1] === "(" || text[at + 1] === "[")) {
      const block = text[at + 1] === "[";
      const end = find(block ? "\\]" : "\\)", at + 2);
      const inner = end < 0 ? "" : text.slice(at + 2, end);
      if (inner.trim() === "") {
        out += text.slice(at, at + 2);
        at += 2;
      } else {
        out += block ? display(inner, at, end + 2) : `$${inner.trim()}$`;
        at = end + 2;
      }
    } else if (char === "\\") {
      // An escaped character, a dollar sign among them, stays escaped.
      out += text.slice(at, at + 2);
      at += 2;
    } else if (char === "$" && text[at + 1] === "$") {
      const end = find("$$", at + 2);
      const inner = end < 0 ? "" : text.slice(at + 2, end);
      if (inner.trim() === "") {
        out += "\\$\\$";
        at += 2;
      } else {
        out += display(inner, at, end + 2);
        at = end + 2;
      }
    } else if (char === "$") {
      const end = closing(text, at, find);
      if (end < 0) {
        out += "\\$";
        at += 1;
      } else {
        out += text.slice(at, end + 1);
        at = end + 1;
      }
    } else {
      out += char;
      at += 1;
    }
  }
  return out;
}

/** Where the dollar sign that closes the formula opened at `start` stands, or
    -1 if the one at `start` does not open a formula. */
function closing(text: string, start: number, find: (mark: string, from: number) => number): number {
  const first = text[start + 1];
  if (first === undefined || /\s/.test(first)) return -1;
  let from = start + 1;
  for (;;) {
    const end = find("$", from);
    if (end < 0) return -1;
    const escaped = text[end - 1] === "\\";
    const spaced = /\s/.test(text[end - 1]);
    if (!escaped && !spaced && !/\d/.test(text[end + 1] ?? "")) return end;
    // A dollar sign with a space before it cannot close a formula, and it
    // means the one at `start` was not opening one either.
    if (!escaped && spaced) return -1;
    from = end + 1;
  }
}
