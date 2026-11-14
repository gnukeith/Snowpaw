import assert from "node:assert/strict";
import { test } from "node:test";
import { maxDiffLength, maxDiffRows, parseDiff } from "../src/data/diff.ts";

/** The files of a diff small enough to be read whole. */
function read(text) {
  const { files, truncated } = parseDiff(text);
  assert.equal(truncated, false);
  return files;
}

const gitDiff = `diff --git a/src/parse.ts b/src/parse.ts
index 1f2e3d4..5a6b7c8 100644
--- a/src/parse.ts
+++ b/src/parse.ts
@@ -10,5 +10,6 @@ export function parse(text: string) {
   const ms = Date.parse(text);
-  if (!(ms > 0)) return null;
+  // Dates before 1970 are negative, and valid.
+  if (Number.isNaN(ms)) return null;
   return new Date(ms);
 }

diff --git a/notes.md b/notes.md
new file mode 100644
--- /dev/null
+++ b/notes.md
@@ -0,0 +1,2 @@
+# Notes
+Fixed.
`;

test("a git diff is split into files, hunks and numbered lines", () => {
  const [parse, notes] = read(gitDiff);

  assert.equal(parse.path, "src/parse.ts");
  assert.equal(parse.added, 2);
  assert.equal(parse.removed, 1);
  assert.equal(parse.hunks.length, 1);
  assert.equal(parse.hunks[0].header, "@@ -10,5 +10,6 @@ export function parse(text: string) {");
  assert.deepEqual(parse.hunks[0].lines, [
    { kind: "context", text: "  const ms = Date.parse(text);", before: 10, after: 10 },
    { kind: "remove", text: "  if (!(ms > 0)) return null;", before: 11 },
    { kind: "add", text: "  // Dates before 1970 are negative, and valid.", after: 11 },
    { kind: "add", text: "  if (Number.isNaN(ms)) return null;", after: 12 },
    { kind: "context", text: "  return new Date(ms);", before: 12, after: 13 },
    { kind: "context", text: "}", before: 13, after: 14 },
    { kind: "context", text: "", before: 14, after: 15 },
  ]);

  assert.equal(notes.path, "notes.md");
  assert.equal(notes.added, 2);
  assert.deepEqual(notes.hunks[0].lines.map((line) => line.after), [1, 2]);
});

test("a deleted file keeps the name it had", () => {
  const [file] = read(`diff --git a/old.txt b/old.txt
deleted file mode 100644
--- a/old.txt
+++ /dev/null
@@ -1 +0,0 @@
-gone
`);
  assert.equal(file.path, "old.txt");
  assert.equal(file.removed, 1);
  assert.deepEqual(file.hunks[0].lines, [{ kind: "remove", text: "gone", before: 1 }]);
});

test("a rename with no text changes is a file with no hunks", () => {
  const [file] = read(`diff --git a/before.txt b/after.txt
similarity index 100%
rename from before.txt
rename to after.txt
`);
  assert.equal(file.path, "after.txt");
  assert.deepEqual(file.hunks, []);
});

test("paths that git quotes are read back as they are", () => {
  const files = read(String.raw`diff --git "a/caf\303\251 \"old\".txt" "b/caf\303\251 \"new\".txt"
similarity index 100%
rename from "caf\303\251 \"old\".txt"
rename to "caf\303\251 \"new\".txt"
diff --git "a/tab\there.txt" "b/tab\there.txt"
--- "a/tab\there.txt"
+++ "b/tab\there.txt"
@@ -1 +1 @@
-a
+b
diff --git "a/pic \"1\".png" "b/pic \"1\".png"
Binary files "a/pic \"1\".png" and "b/pic \"1\".png" differ
diff --git a/my file.txt b/my file.txt
--- a/my file.txt\t
+++ b/my file.txt\t
@@ -1 +1 @@
-a
+b
`.replaceAll("\\t\n", "\t\n"));
  assert.deepEqual(files.map((file) => file.path), [
    'café "new".txt',
    "tab\there.txt",
    'pic "1".png',
    "my file.txt",
  ]);
});

test("quoting that cannot be undone leaves the path as written", () => {
  const [file] = read(String.raw`--- "a/bad\377.txt"
+++ "b/bad\377.txt"
@@ -1 +1 @@
-a
+b
`);
  assert.equal(file.path, String.raw`"b/bad\377.txt"`);
});

test("a plain unified diff, without git's lines, is read too", () => {
  const files = read(`--- one.txt\t2026-01-01 10:00:00
+++ one.txt\t2026-01-02 10:00:00
@@ -1,2 +1,2 @@
 same
-old
+new
--- two.txt
+++ two.txt
@@ -1 +1 @@
-a
+b
`);
  assert.deepEqual(files.map((file) => file.path), ["one.txt", "two.txt"]);
  assert.deepEqual(files.map((file) => [file.added, file.removed]), [
    [1, 1],
    [1, 1],
  ]);
});

test("a removed line that looks like a file header stays a removed line", () => {
  const [file, ...rest] = read(`--- list.md
+++ list.md
@@ -1,2 +1,2 @@
--- a divider
+++ a divider
 kept
`);
  assert.deepEqual(rest, []);
  assert.deepEqual(file.hunks[0].lines, [
    { kind: "remove", text: "-- a divider", before: 1 },
    { kind: "add", text: "++ a divider", after: 1 },
    { kind: "context", text: "kept", before: 2, after: 2 },
  ]);
});

test("the note about a missing final newline is not a line", () => {
  const [file] = read(`--- a.txt
+++ a.txt
@@ -1 +1 @@
-old
\\ No newline at end of file
+new
\\ No newline at end of file
`);
  assert.deepEqual(file.hunks[0].lines.map((line) => line.kind), ["remove", "add"]);
});

test("text that is not a diff gives nothing, and never throws", () => {
  assert.deepEqual(read(""), []);
  assert.deepEqual(read("hello\n@@ -1 +1 @@\n+orphan\n"), []);
  assert.deepEqual(read("@@ -1,99999999999 +1,99999999999 @@\n"), []);
});

test("a hunk that promises more lines than it has ends where the next file starts", () => {
  const files = read(`diff --git a/one.txt b/one.txt
--- a/one.txt
+++ b/one.txt
@@ -1,9 +1,9 @@
 same
-old
+new
diff --git a/two.txt b/two.txt
--- a/two.txt
+++ b/two.txt
@@ -1 +1 @@
-a
+b
`);
  assert.deepEqual(files.map((file) => file.path), ["one.txt", "two.txt"]);
  assert.deepEqual(files[0].hunks[0].lines.map((line) => line.kind), ["context", "remove", "add"]);
  assert.deepEqual(files[1].hunks[0].lines.map((line) => line.kind), ["remove", "add"]);
});

test("a hunk that promises more lines than follow just ends", () => {
  const [file] = read("--- a\n+++ a\n@@ -1,50 +1,50 @@\n-x\n+y");
  assert.deepEqual(file.hunks[0].lines.map((line) => line.kind), ["remove", "add"]);
});

test("reading stops at the row limit and says so", () => {
  const { files, truncated } = parseDiff(`--- a\n+++ a\n@@ -0,0 +1,${maxDiffRows * 2} @@\n${"+x\n".repeat(maxDiffRows * 2)}`);
  assert.equal(truncated, true);
  // The file and the hunk are rows too.
  assert.equal(files[0].hunks[0].lines.length, maxDiffRows - 2);
});

test("files without hunks count towards the row limit", () => {
  const { files, truncated } = parseDiff("diff --git a/x b/x\n".repeat(maxDiffRows * 2));
  assert.equal(truncated, true);
  assert.equal(files.length, maxDiffRows);
});

test("text beyond the length limit is not read", () => {
  const line = `+${"x".repeat(999)}\n`;
  const count = Math.ceil(maxDiffLength / line.length) + 10;
  const { files, truncated } = parseDiff(`--- a\n+++ a\n@@ -0,0 +1,${count} @@\n${line.repeat(count)}`);
  assert.equal(truncated, true);
  assert.ok(files[0].hunks[0].lines.length < count);
});

test("a diff exactly at the limits is read whole", () => {
  const { files, truncated } = parseDiff(`--- a\n+++ a\n@@ -0,0 +1,${maxDiffRows - 2} @@\n${"+x\n".repeat(maxDiffRows - 2)}`);
  assert.equal(truncated, false);
  assert.equal(files[0].added, maxDiffRows - 2);
});
