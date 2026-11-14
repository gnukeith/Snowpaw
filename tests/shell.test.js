import assert from "node:assert/strict";
import { test } from "node:test";
import { maxCommandLength, shellTokens } from "../src/data/shell.ts";

/** A command's parts as "kind:text", without the space between them. */
const parts = (source) =>
  shellTokens(source)
    .filter((token) => token.text.trim())
    .map((token) => `${token.kind}:${token.text}`);

test("a command's name, flags and arguments are told apart", () => {
  assert.deepEqual(parts("pnpm test --filter dates -v ./src"), [
    "command:pnpm",
    "plain:test",
    "flag:--filter",
    "plain:dates",
    "flag:-v",
    "plain:./src",
  ]);
});

test("each command in a pipeline or a list is named", () => {
  assert.deepEqual(parts("cd app && cargo test 2>&1 | tail -n 5; echo done &"), [
    "command:cd",
    "plain:app",
    "operator:&&",
    "command:cargo",
    "plain:test",
    "operator:2>&1",
    "operator:|",
    "command:tail",
    "flag:-n",
    "plain:5",
    "operator:;",
    "command:echo",
    "plain:done",
    "operator:&",
  ]);
  assert.deepEqual(parts("make\nls -a"), ["command:make", "command:ls", "flag:-a"]);
});

test("strings, variables and comments are found", () => {
  assert.deepEqual(parts(`NAME=x echo "it's $HOME" 'a "b" c' \${USER} $1 # say it | not a pipe`), [
    "plain:NAME=x",
    "command:echo",
    `string:"it's $HOME"`,
    `string:'a "b" c'`,
    "variable:${USER}",
    "variable:$1",
    "comment:# say it | not a pipe",
  ]);
  assert.deepEqual(parts(String.raw`grep "a \" b" file\ name > out.txt`), [
    "command:grep",
    String.raw`string:"a \" b"`,
    String.raw`plain:file\ name`,
    "operator:>",
    "plain:out.txt",
  ]);
  assert.deepEqual(parts("echo $(date -u) a#b"), [
    "command:echo",
    "variable:$(",
    "command:date",
    "flag:-u",
    "operator:)",
    "plain:a#b",
  ]);
});

test("the parts of any text, joined, are that text", () => {
  const texts = [
    "",
    " ",
    "ls",
    `echo "never closed`,
    "echo 'never closed",
    "a $ b ${ c \\",
    "\\",
    "$",
    "naïve --flag=値 'ünï' 🙂 | ☃",
    "if [ -f x ]; then\n  cat x\nfi",
    "\ud800 lone",
    '"'.repeat(999),
    "\\".repeat(999),
    "$".repeat(999),
    "${".repeat(999),
  ];
  for (const text of texts) {
    assert.equal(shellTokens(text).map((token) => token.text).join(""), text);
  }
});

test("a command too long to be worth colouring is left plain", () => {
  const long = "echo ".repeat(maxCommandLength / 5 + 1);
  assert.deepEqual(shellTokens(long), [{ kind: "plain", text: long }]);
  assert.equal(shellTokens("x".repeat(maxCommandLength))[0].kind, "command");
});

test("text made to be slow to read is read in time that grows with its length", () => {
  const started = performance.now();
  for (const piece of ['"\\', "'", "$(", "${", "\\x", "a#", ">&", "2"]) {
    shellTokens(piece.repeat(maxCommandLength / piece.length));
  }
  assert.ok(performance.now() - started < 1000);
});
