import assert from "node:assert/strict";
import { test } from "node:test";
import { markFormulas } from "../src/data/formulas.ts";

test("a formula between dollar signs is left as it is", () => {
  assert.equal(markFormulas("so $x^2 + 1$ is positive"), "so $x^2 + 1$ is positive");
  assert.equal(markFormulas("$a$ and $b$"), "$a$ and $b$");
});

test("prices are not formulas", () => {
  assert.equal(markFormulas("it costs $5"), "it costs \\$5");
  assert.equal(markFormulas("between $5 and $10"), "between \\$5 and \\$10");
  assert.equal(
    markFormulas("About **$164,413**, of which $96,000 is yours."),
    "About **\\$164,413**, of which \\$96,000 is yours.",
  );
  assert.equal(markFormulas("| $24,000 | $27,202 |"), "| \\$24,000 | \\$27,202 |");
  assert.equal(markFormulas("pay $5, then $x$"), "pay \\$5, then $x$");
});

test("a dollar sign that was already escaped stays escaped", () => {
  assert.equal(markFormulas("\\$5 and $x$"), "\\$5 and $x$");
  assert.equal(markFormulas("$a\\$b$"), "$a\\$b$");
});

test("a formula does not reach across a blank line", () => {
  assert.equal(markFormulas("$a\n\nb$"), "\\$a\n\nb\\$");
  assert.equal(markFormulas("$a\nb$"), "$a\nb$");
});

test("round brackets with a backslash are a formula in a line", () => {
  assert.equal(markFormulas("so \\(x^2\\) is"), "so $x^2$ is");
  assert.equal(markFormulas("so \\( x^2 \\) is"), "so $x^2$ is");
  assert.equal(markFormulas("an empty \\(\\) pair"), "an empty \\(\\) pair");
  assert.equal(markFormulas("an open \\( bracket"), "an open \\( bracket");
});

test("a formula with a line to itself goes on lines of its own", () => {
  assert.equal(markFormulas("then\n$$x = 1$$\nso"), "then\n\n$$\nx = 1\n$$\n\nso");
  assert.equal(markFormulas("\\[\n  x = 1\n\\]"), "\n$$\nx = 1\n$$\n");
  assert.equal(markFormulas("  $$x$$  "), "  \n$$\nx\n$$\n  ");
});

test("a display formula in the middle of a line stays in the line", () => {
  assert.equal(markFormulas("so $$x = 1$$ holds"), "so $$x = 1$$ holds");
  assert.equal(markFormulas("so \\[x = 1\\] holds"), "so $$x = 1$$ holds");
  assert.equal(markFormulas("two $$ signs"), "two \\$\\$ signs");
});

test("code is never touched", () => {
  assert.equal(markFormulas("run `echo $HOME $PATH` now"), "run `echo $HOME $PATH` now");
  assert.equal(markFormulas("``a ` $b$ `` and $5"), "``a ` $b$ `` and \\$5");
  const fenced = "```sh\necho $HOME\ncost=$5 \\(x\\)\n```";
  assert.equal(markFormulas(fenced), fenced);
  assert.equal(markFormulas(`pay $5\n${fenced}\npay $6`), `pay \\$5\n${fenced}\npay \\$6`);
  const tildes = "~~~\n$x$ \\[y\\]\n~~~";
  assert.equal(markFormulas(tildes), tildes);
  // A fence that is never closed runs to the end.
  assert.equal(markFormulas("```\n$5 and $6"), "```\n$5 and $6");
});

test("text with nothing to mark comes back unchanged", () => {
  for (const text of ["", "plain", "line one\nline two\n", "a\n\nb", "\n", "\n\n"]) {
    assert.equal(markFormulas(text), text);
  }
});
