import assert from "node:assert/strict";
import { test } from "node:test";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { mostFormulas, remarkFormulas } from "../src/data/formulaSyntax.ts";

/* Each case is read the way a message is, by the same reader with the same
   settings, and what it finds is compared. */
const reader = unified().use(remarkParse).use(remarkGfm).use(remarkMath, { singleDollarTextMath: false }).use(remarkFormulas);

/** The formulas, code, links and text the reader finds, in order, as
    [type, value], with "in list" or "in quote" after what is inside one. */
function read(source) {
  const found = [];
  const walk = (node, where) => {
    const tag = where ? [where] : [];
    if (["inlineMath", "math", "code", "inlineCode"].includes(node.type)) {
      found.push([node.type, node.value, ...tag]);
      return;
    }
    if (node.type === "link" || node.type === "definition") found.push([node.type, node.url]);
    if (node.type === "text" && node.value.trim()) found.push(["text", node.value.trim(), ...tag]);
    const inside = node.type === "listItem" ? "in list" : node.type === "blockquote" ? "in quote" : where;
    for (const child of node.children ?? []) walk(child, inside);
  };
  walk(reader.runSync(reader.parse(source), source), undefined);
  return found;
}

test("a formula between dollar signs is a formula", () => {
  assert.deepEqual(read("so $x^2 + 1$ is positive"), [["text", "so"], ["inlineMath", "x^2 + 1"], ["text", "is positive"]]);
  assert.deepEqual(read("$a$ and $b$"), [["inlineMath", "a"], ["text", "and"], ["inlineMath", "b"]]);
  assert.deepEqual(read("$a\nb$"), [["inlineMath", "a\nb"]]);
});

test("prices are not formulas", () => {
  assert.deepEqual(read("between $5 and $10"), [["text", "between $5 and $10"]]);
  assert.deepEqual(read("About **$164,413**, of which $96,000 is yours."), [
    ["text", "About"],
    ["text", "$164,413"],
    ["text", ", of which $96,000 is yours."],
  ]);
  assert.deepEqual(read("pay $5, then $x$"), [["text", "pay $5, then"], ["inlineMath", "x"]]);
  assert.deepEqual(read("costs $5 per unit, so $n$ units"), [["text", "costs $5 per unit, so"], ["inlineMath", "n"], ["text", "units"]]);
  assert.deepEqual(read("$1$2"), [["text", "$1$2"]]);
  assert.deepEqual(read("| a | b |\n| - | - |\n| $24,000 | $27,202 |").filter(([type]) => type === "inlineMath"), []);
});

test("what is inside a formula reaches it exactly as written", () => {
  assert.deepEqual(read("$\\text{price \\$5}$ ok"), [["inlineMath", "\\text{price \\$5}"], ["text", "ok"]]);
  assert.deepEqual(read("$a\\$b$"), [["inlineMath", "a\\$b"]]);
  assert.deepEqual(read("\\(\\text{$x$}\\)"), [["inlineMath", "\\text{$x$}"]]);
  assert.deepEqual(read("\\(\\text{a\\\\$x$}\\)"), [["inlineMath", "\\text{a\\\\$x$}"]]);
  assert.deepEqual(read("\\($\\)"), [["inlineMath", "$"]]);
  assert.deepEqual(read("\\(\\$\\)"), [["inlineMath", "\\$"]]);
  assert.deepEqual(read("\\[\\text{$$x$$}\\]"), [["math", "\\text{$$x$$}"]]);
  // Two backslashes are an escaped backslash: the dollar sign after them closes.
  assert.deepEqual(read("$a\\\\$ then"), [["inlineMath", "a\\\\"], ["text", "then"]]);
  assert.deepEqual(read("\\$5 and $x$"), [["text", "$5 and"], ["inlineMath", "x"]]);
});

test("formulas next to each other stay apart", () => {
  assert.deepEqual(read("\\(a\\)\\(b\\)"), [["inlineMath", "a"], ["inlineMath", "b"]]);
  assert.deepEqual(read("\\(a\n\\text{$x$}\\)\nordinary next line"), [["inlineMath", "a\n\\text{$x$}"], ["text", "ordinary next line"]]);
});

test("a formula does not reach across a blank line", () => {
  assert.deepEqual(read("$a\n\nb$"), [["text", "$a"], ["text", "b$"]]);
  assert.deepEqual(read("$a\r\n\r\nb$"), [["text", "$a"], ["text", "b$"]]);
  assert.deepEqual(read("\\(a\n\nb\\)"), [["text", "(a"], ["text", "b)"]]);
});

test("brackets with nothing in them, or unclosed, are brackets", () => {
  assert.deepEqual(read("an empty \\(\\) pair"), [["text", "an empty () pair"]]);
  assert.deepEqual(read("an open \\( bracket"), [["text", "an open ( bracket"]]);
});

test("a formula with its paragraph to itself is drawn on lines of its own", () => {
  assert.deepEqual(read("\\[\n  x = 1\n\\]"), [["math", "x = 1"]]);
  assert.deepEqual(read("$$\na\nb\n$$"), [["math", "a\nb"]]);
  assert.deepEqual(read("$$x$$"), [["math", "x"]]);
  assert.deepEqual(read("so $$x = 1$$ holds"), [["text", "so"], ["inlineMath", "x = 1"], ["text", "holds"]]);
  assert.deepEqual(read("so \\[x = 1\\] holds"), [["text", "so"], ["inlineMath", "x = 1"], ["text", "holds"]]);
  assert.deepEqual(read("two $$ signs"), [["text", "two $$ signs"]]);
});

test("a formula in a list item or a quote stays in it", () => {
  assert.deepEqual(read("- result\n\n  $$x^2$$\n\n  still in item"), [
    ["text", "result", "in list"],
    ["math", "x^2", "in list"],
    ["text", "still in item", "in list"],
  ]);
  assert.deepEqual(read("> $$\n> x\n> $$"), [["math", "x", "in quote"]]);
  assert.deepEqual(read("> \\[\n> y = 1\n> \\]"), [["math", "y = 1", "in quote"]]);
  assert.deepEqual(read("- > $$\n  > x\n  > $$"), [["math", "x", "in quote"]]);
  assert.deepEqual(read("- > \\[\n  > x\n  > \\]"), [["math", "x", "in quote"]]);
  // A ">" that belongs to the formula stays in it.
  assert.deepEqual(read("$$\na\n> b\n$$"), [["math", "a\n> b"]]);
});

test("code is never touched", () => {
  const code = (source) => read(source).filter(([type]) => type === "code" || type === "inlineCode");
  assert.deepEqual(code("run `echo $HOME $PATH` now"), [["inlineCode", "echo $HOME $PATH"]]);
  assert.deepEqual(code("```sh\necho $HOME\ncost=$5 \\(x\\)\n```"), [["code", "echo $HOME\ncost=$5 \\(x\\)"]]);
  assert.deepEqual(code("    echo $HOME"), [["code", "echo $HOME"]]);
  assert.deepEqual(code("1. Example\n\n    ~~~sh\n    echo $HOME\n    ~~~"), [["code", "echo $HOME", "in list"]]);
  assert.deepEqual(code("> ~~~sh\n> echo $HOME\n> ~~~"), [["code", "echo $HOME", "in quote"]]);
  assert.deepEqual(code("`a ``` $HOME `"), [["inlineCode", "a ``` $HOME "]]);
  assert.deepEqual(code("$x$`$HOME`$y$"), [["inlineCode", "$HOME"]]);
});

test("links keep their addresses, and their text may hold formulas", () => {
  assert.deepEqual(read("[price $5](https://e.test/$HOME)"), [["link", "https://e.test/$HOME"], ["text", "price $5"]]);
  assert.deepEqual(read("[area $x^2$](https://e.test/a)"), [["link", "https://e.test/a"], ["text", "area"], ["inlineMath", "x^2"]]);
  assert.deepEqual(read("<https://e.test/$HOME>"), [["link", "https://e.test/$HOME"], ["text", "https://e.test/$HOME"]]);
  assert.deepEqual(read("[label][price $5]\n\n[price $5]: https://e.test/a").filter(([type]) => type === "definition"), [["definition", "https://e.test/a"]]);
  assert.deepEqual(read("[label][ref]\n\n[ref]: https://e.test/\\(x\\)").filter(([type]) => type === "definition"), [["definition", "https://e.test/(x)"]]);
});

test("a message with too many formulas shows every one as written", () => {
  const many = "$x$ ".repeat(mostFormulas + 1).trim();
  const found = read(many);
  assert.equal(found.filter(([type]) => type === "inlineMath").length, 0);
  assert.ok(found.some(([type, value]) => type === "text" && value.includes("$x$")));
  // Fenced math blocks count too, and become plain code.
  const blocks = read("```math\nx\n```\n\n".repeat(mostFormulas + 1));
  assert.equal(blocks.filter(([type]) => type === "code").length, mostFormulas + 1);
  assert.ok(blocks.every(([type]) => type !== "math"));
  assert.equal(read("$x$ ".repeat(mostFormulas)).filter(([type]) => type === "inlineMath").length, mostFormulas);
});

test("the work grows with the message and no faster", () => {
  // Each of these made an earlier version search the rest of the message
  // again for every dollar sign or bracket in it. The fastest of three runs
  // is used, so a busy machine does not fail it.
  const cases = {
    "$1": (n) => "$1".repeat(n),
    "\\(": (n) => "\\(".repeat(n),
    "$a ": (n) => "$a ".repeat(n),
    "$$a": (n) => "$$a".repeat(n),
    "prefix": (n) => "a\n" + " ".repeat(6 * n) + "$$x$$".repeat(n),
  };
  for (const [name, make] of Object.entries(cases)) {
    const time = (count) => {
      const text = make(count);
      let best = Infinity;
      for (let run = 0; run < 3; run++) {
        const begun = performance.now();
        reader.runSync(reader.parse(text), text);
        best = Math.min(best, performance.now() - begun);
      }
      return best;
    };
    time(500);
    const small = time(1000);
    const large = time(8000);
    // Eight times the text: linear work takes about eight times as long,
    // quadratic about sixty-four.
    assert.ok(large < Math.max(small, 1) * 24, `${name}: ${small.toFixed(1)} ms then ${large.toFixed(1)} ms`);
  }
});
