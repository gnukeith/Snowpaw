/* Formulas, as the Markdown reader finds them.

   Models mark formulas four ways: $x$ and \(x\) inside a line, $$x$$ and
   \[x\] for display. remark-math reads the double dollar forms; this teaches
   the same reader the other two, and the single dollar form by the rule
   pandoc uses, so that prices stay prices: a dollar sign opens a formula
   only if what follows it is not a space, and one closes it only if it has
   no space before it and no digit after it.

   It works inside the reader's own tokenizer, not on the raw text, so the
   reader has already set aside what is code, a link's address, a link
   definition, a list marker or a quote mark, and a formula is never looked
   for in any of them. What is between the marks reaches the formula exactly
   as it was written. */

import type { Plugin } from "unified";

/* The few parts of micromark's tokenizer this needs, typed here so that the
   app does not depend on micromark's own type package. Characters are
   numbers; line endings are negative, below -2; null is the end. */
type Code = number | null;
type State = (code: Code) => State | undefined;
interface Effects {
  enter(type: string): unknown;
  exit(type: string): unknown;
  consume(code: Code): void;
  check(construct: Construct, ok: State, nok: State): State;
}
interface Construct {
  name: string;
  tokenize: (this: unknown, effects: Effects, ok: State, nok: State) => State;
  previous?: (this: unknown, code: Code) => boolean;
  partial?: boolean;
}

const dollar = 36;
const backslash = 92;

const isLineEnding = (code: Code) => code !== null && code < -2;
const isSpace = (code: Code) => code !== null && (code < 0 || code === 32);
const isDigit = (code: Code) => code !== null && code >= 48 && code <= 57;

/** The longest formula looked for, in characters: past it the marks are
    read as text. */
const longest = 10_000;

/** A dollar sign that closes a formula: one with no digit after it. Only
    looked at, never kept. */
const closing: Construct = {
  name: "formulaClosing",
  partial: true,
  tokenize(effects, ok, nok) {
    return (code) => {
      effects.consume(code);
      return (after) => (isDigit(after) ? nok(after) : ok(after));
    };
  },
};

/* Every attempt to read a formula stops at the first delimiter it reaches,
   which either closes it or shows it was not a formula. The stretches that
   failed attempts read therefore never overlap, and the work stays in
   proportion to the message however its delimiters are arranged. */

/** Writes a formula's text: line endings as the reader's own, and the rest
    as math text, opened only when there is something to put in it, since
    the reader allows no empty token. */
function writer(effects: Effects) {
  let open = false;
  return {
    text(code: Code) {
      if (!open) effects.enter("mathTextData");
      open = true;
      effects.consume(code);
    },
    lineEnding(code: Code) {
      if (open) effects.exit("mathTextData");
      open = false;
      effects.enter("lineEnding");
      effects.consume(code);
      effects.exit("lineEnding");
    },
    end() {
      if (open) effects.exit("mathTextData");
      open = false;
    },
  };
}

/** $x$, inside a line. */
const single: Construct = {
  name: "formulaDollar",
  // Not the second of two dollar signs: those are remark-math's.
  previous: (code) => code !== dollar,
  tokenize(effects, ok, nok) {
    const write = writer(effects);
    let size = 0;
    let spaced = false;
    let previous: Code = null;
    const inside: State = (code) => {
      if (code === null || ++size > longest) return nok(code);
      // "](" is where a link's text ends and its address begins: a formula
      // does not run on into it, as a price in a link's text otherwise would.
      if (code === 40 && previous === 93) return nok(code);
      previous = code;
      if (isLineEnding(code)) {
        write.lineEnding(code);
        spaced = true;
        return inside;
      }
      if (code === backslash) {
        write.text(code);
        // Whatever follows a backslash is part of the formula, a dollar
        // sign included.
        return (escaped) => {
          if (escaped === null || isLineEnding(escaped)) return inside(escaped);
          write.text(escaped);
          spaced = false;
          return inside;
        };
      }
      if (code === dollar) {
        // The first unescaped dollar sign settles it: it closes the formula,
        // or, with a space before it or a digit after it, shows the first one
        // was not opening one ("$5 and $10", "$1$2").
        if (spaced) return nok(code);
        return effects.check(closing, close, nok)(code);
      }
      write.text(code);
      spaced = isSpace(code);
      return inside;
    };
    const close: State = (code) => {
      write.end();
      effects.enter("mathTextSequence");
      effects.consume(code);
      effects.exit("mathTextSequence");
      effects.exit("mathText");
      return ok;
    };
    return (code) => {
      effects.enter("mathText");
      effects.enter("mathTextSequence");
      effects.consume(code);
      effects.exit("mathTextSequence");
      // "$$" is remark-math's, and "$ " is not a formula.
      return (first) => (first === dollar || first === null || isSpace(first) ? nok(first) : inside(first));
    };
  },
};

/** \(x\) inside a line, and \[x\] for display. */
const bracket: Construct = {
  name: "formulaBracket",
  tokenize(effects, ok, nok) {
    const write = writer(effects);
    let shut = 0;
    let size = 0;
    let empty = true;
    const inside: State = (code) => {
      if (code === null || ++size > longest) return nok(code);
      if (isLineEnding(code)) {
        write.lineEnding(code);
        return inside;
      }
      if (code === backslash) {
        // \( or \[ cannot stand inside a formula, so meeting one means this
        // was not a formula, and the reading stops there.
        return effects.check(openingBracket, nok, () => effects.check(closingBracket(shut), close, (other) => {
          // A backslash and what follows it are part of the formula, so
          // "\\)" is a line break and a bracket, not the end.
          write.text(other);
          empty = false;
          return (escaped) => {
            if (escaped === null || isLineEnding(escaped)) return inside(escaped);
            write.text(escaped);
            return inside;
          };
        })(code))(code);
      }
      write.text(code);
      if (!isSpace(code)) empty = false;
      return inside;
    };
    const close: State = (code) => {
      if (empty) return nok(code);
      write.end();
      effects.enter("mathTextSequence");
      effects.consume(code);
      return (bracketCode) => {
        effects.consume(bracketCode);
        effects.exit("mathTextSequence");
        effects.exit("mathText");
        return ok;
      };
    };
    return (code) => {
      effects.enter("mathText");
      effects.enter("mathTextSequence");
      effects.consume(code);
      return (open) => {
        if (open !== 40 && open !== 91) return nok(open);
        shut = open === 40 ? 41 : 93;
        effects.consume(open);
        effects.exit("mathTextSequence");
        return inside;
      };
    };
  },
};

/** A backslash followed by a bracket that opens a formula. */
const openingBracket: Construct = {
  name: "formulaOpeningBracket",
  partial: true,
  tokenize(effects, ok, nok) {
    return (code) => {
      effects.consume(code);
      return (next) => (next === 40 || next === 91 ? ok(next) : nok(next));
    };
  },
};

/** A backslash followed by the bracket that closes this formula. */
function closingBracket(shut: number): Construct {
  return {
    name: "formulaClosingBracket",
    partial: true,
    tokenize(effects, ok, nok) {
      return (code) => {
        effects.consume(code);
        return (next) => (next === shut ? ok(next) : nok(next));
      };
    },
  };
}

/** The most formulas one message may have drawn. More, and every one is
    shown as written: each formula costs a render of its own. */
export const mostFormulas = 500;

interface Node {
  type: string;
  value?: string;
  lang?: string | null;
  children?: Node[];
  data?: Record<string, unknown>;
  position?: { start: { offset?: number }; end: { offset?: number } };
}

/** A formula that came from \[x\] or $$x$$ and has its paragraph to itself:
    it is drawn on lines of its own. */
function displayed(paragraph: Node, source: string): Node | undefined {
  const parts = (paragraph.children ?? []).filter((child) => !(child.type === "text" && !child.value?.trim()));
  const [only] = parts;
  if (parts.length !== 1 || only.type !== "inlineMath") return undefined;
  const start = only.position?.start.offset;
  if (start === undefined) return undefined;
  const opening = source.slice(start, start + 2);
  if (opening !== "\\[" && opening !== "$$") return undefined;
  const value = (only.value ?? "").trim();
  // As remark-math builds a block formula, so it is drawn the same way.
  return {
    type: "math",
    value,
    position: paragraph.position,
    data: {
      hName: "pre",
      hChildren: [{ type: "element", tagName: "code", properties: { className: ["language-math", "math-display"] }, children: [{ type: "text", value }] }],
    },
  };
}

/** Teaches the reader the formula forms above, draws a formula that has its
    paragraph to itself on lines of its own, and past `mostFormulas` shows
    every formula as it was written. Use after remark-math, set to leave
    single dollar signs alone. */
export const remarkFormulas: Plugin<[]> = function () {
  const data = this.data() as { micromarkExtensions?: unknown[] };
  (data.micromarkExtensions ??= []).push({ text: { [dollar]: single, [backslash]: bracket } });

  return (root, file) => {
    const tree = root as Node;
    const source = String(file.value);
    const formulas: { node: Node; parent: Node; index: number }[] = [];
    // A stack, not recursion, so deeply nested quotes cannot overflow it.
    const stack: Node[] = [tree];
    while (stack.length > 0) {
      const node = stack.pop()!;
      const children = node.children ?? [];
      children.forEach((child, index) => {
        if (child.type === "paragraph") {
          const display = displayed(child, source);
          if (display) children[index] = child = display;
        }
        const formula = child.type === "inlineMath" || child.type === "math" || (child.type === "code" && child.lang === "math");
        if (formula) formulas.push({ node: child, parent: node, index });
        else if (child.children) stack.push(child);
      });
    }
    if (formulas.length <= mostFormulas) return;
    for (const { node, parent, index } of formulas) {
      const { start, end } = node.position ?? { start: {}, end: {} };
      const written = start.offset !== undefined && end.offset !== undefined ? source.slice(start.offset, end.offset) : (node.value ?? "");
      // In a line, the formula's text; on lines of its own, a block of code.
      parent.children![index] = node.type === "inlineMath" ? { type: "text", value: written } : { type: "code", lang: null, value: node.value ?? "" };
    }
  };
};
