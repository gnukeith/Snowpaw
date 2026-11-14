import assert from "node:assert/strict";
import { test } from "node:test";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { markFormulas } from "../src/data/formulas.ts";

/* Each case is read the way a message is: marked, then parsed by the same
   Markdown reader with math switched on. What matters is what the reader
   sees, not the marked text itself. */
const reader = unified().use(remarkParse).use(remarkGfm).use(remarkMath);

/** The formulas, code and text the reader finds, in order, as [type, value]. */
function read(source) {
  const found = [];
  const walk = (node, inList) => {
    if (node.type === "inlineMath" || node.type === "math" || node.type === "code" || node.type === "inlineCode") {
      found.push([node.type, node.value, ...(inList ? ["in list"] : [])]);
      return;
    }
    if (node.type === "text" && node.value.trim()) found.push(["text", node.value.trim(), ...(inList ? ["in list"] : [])]);
    for (const child of node.children ?? []) walk(child, inList || node.type === "listItem");
  };
  walk(reader.parse(markFormulas(source)), false);
  return found;
}

test("a formula between dollar signs is a formula", () => {
  assert.deepEqual(read("so $x^2 + 1$ is positive"), [["text", "so"], ["inlineMath", "x^2 + 1"], ["text", "is positive"]]);
  assert.deepEqual(read("$a$ and $b$"), [["inlineMath", "a"], ["text", "and"], ["inlineMath", "b"]]);
});

test("prices are not formulas", () => {
  assert.deepEqual(read("between $5 and $10"), [["text", "between $5 and $10"]]);
  assert.deepEqual(read("About **$164,413**, of which $96,000 is yours."), [
    ["text", "About"],
    ["text", "$164,413"],
    ["text", ", of which $96,000 is yours."],
  ]);
  assert.deepEqual(read("pay $5, then $x$"), [["text", "pay $5, then"], ["inlineMath", "x"]]);
  assert.deepEqual(read("| a | b |\n| - | - |\n| $24,000 | $27,202 |").filter(([type]) => type !== "text" || /\$/.test(type)), []);
});

test("a dollar sign inside a formula stays inside it", () => {
  assert.deepEqual(read("$\\text{price \\$5}$ ok"), [["inlineMath", "\\text{price {\\char36}5}"], ["text", "ok"]]);
  assert.deepEqual(read("\\(\\text{price \\$5}\\)"), [["inlineMath", "\\text{price {\\char36}5}"]]);
  assert.deepEqual(read("$a\\$b$"), [["inlineMath", "a{\\char36}b"]]);
  assert.deepEqual(read("\\$5 and $x$"), [["text", "$5 and"], ["inlineMath", "x"]]);
});

test("a formula does not reach across a blank line", () => {
  assert.deepEqual(read("$a\n\nb$"), [["text", "$a"], ["text", "b$"]]);
  assert.deepEqual(read("$a\r\n\r\nb$"), [["text", "$a"], ["text", "b$"]]);
  assert.deepEqual(read("\\(a\r\n\r\nb\\)"), [["text", "(a"], ["text", "b)"]]);
  assert.deepEqual(read("$a\nb$"), [["inlineMath", "a\nb"]]);
});

test("round brackets with a backslash are a formula in a line", () => {
  assert.deepEqual(read("so \\( x^2 \\) is"), [["text", "so"], ["inlineMath", "x^2"], ["text", "is"]]);
  assert.deepEqual(read("an open \\( bracket"), [["text", "an open ( bracket"]]);
});

test("a formula with its line to itself is drawn on lines of its own", () => {
  assert.deepEqual(read("then\n$$x = 1$$\nso"), [["text", "then"], ["math", "x = 1"], ["text", "so"]]);
  assert.deepEqual(read("\\[\n  x = 1\n\\]"), [["math", "x = 1"]]);
  assert.deepEqual(read("$$\na\nb\n$$"), [["math", "a\nb"]]);
});

test("a display formula in the middle of a line stays in the line", () => {
  assert.deepEqual(read("so $$x = 1$$ holds"), [["text", "so"], ["inlineMath", "x = 1"], ["text", "holds"]]);
  assert.deepEqual(read("$$x$$ holds"), [["inlineMath", "x"], ["text", "holds"]]);
  assert.deepEqual(read("two $$ signs"), [["text", "two $$ signs"]]);
});

test("a formula in a list item or a quote stays in it", () => {
  assert.deepEqual(read("- result\n\n  $$x^2$$\n\n  still in item"), [
    ["text", "result", "in list"],
    ["math", "x^2", "in list"],
    ["text", "still in item", "in list"],
  ]);
  assert.deepEqual(read("1. step\n\n   \\[\n   y = 2\n   \\]\n\n   more"), [
    ["text", "step", "in list"],
    ["math", "y = 2", "in list"],
    ["text", "more", "in list"],
  ]);
  assert.deepEqual(read("> $$z$$"), [["math", "z"]]);
});

test("code is never touched", () => {
  const code = (source) => read(source).filter(([type]) => type === "code" || type === "inlineCode");
  assert.deepEqual(code("run `echo $HOME $PATH` now"), [["inlineCode", "echo $HOME $PATH"]]);
  assert.deepEqual(code("```sh\necho $HOME\ncost=$5 \\(x\\)\n```"), [["code", "echo $HOME\ncost=$5 \\(x\\)"]]);
  assert.deepEqual(code("    echo $HOME"), [["code", "echo $HOME"]]);
  assert.deepEqual(code("1. Example\n\n    ~~~sh\n    echo $HOME\n    ~~~"), [["code", "echo $HOME", "in list"]]);
  assert.deepEqual(code("> ~~~sh\n> echo $HOME\n> ~~~"), [["code", "echo $HOME"]]);
  assert.deepEqual(code("`a ``` $HOME `"), [["inlineCode", "a ``` $HOME "]]);
  assert.deepEqual(code("``a ` $b$ `` and $5"), [["inlineCode", "a ` $b$ "]]);
  assert.deepEqual(code("```\n$5 and $6"), [["code", "$5 and $6"]]);
});

test("text with nothing to mark comes back unchanged", () => {
  for (const text of ["", "plain", "line one\nline two\n", "a\n\nb", "\n", "\n\n"]) {
    assert.equal(markFormulas(text), text);
  }
});

test("the work grows with the message and no faster", () => {
  // Each of these made an earlier version search the rest of the message
  // again for every dollar sign or bracket in it.
  for (const unit of ["$1", "\\(", "\\[", "$a ", "$$a"]) {
    const time = (count) => {
      const text = unit.repeat(count);
      const begun = performance.now();
      markFormulas(text);
      return performance.now() - begun;
    };
    time(2000);
    const small = time(4000);
    const large = time(32000);
    // Eight times the text: linear work takes about eight times as long,
    // quadratic about sixty-four. Allow plenty for a busy machine.
    assert.ok(large < Math.max(small, 1) * 24, `${unit}: ${small.toFixed(1)} ms then ${large.toFixed(1)} ms`);
  }
});
