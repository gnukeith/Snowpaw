export interface DiffLine {
  kind: "add" | "remove" | "context";
  text: string;
  /** Its line number in the old file. An added line has none. */
  before?: number;
  /** Its line number in the new file. A removed line has none. */
  after?: number;
}

export interface Hunk {
  /** The `@@ -1,4 +1,5 @@` line that opens it. */
  header: string;
  lines: DiffLine[];
}

export interface FileDiff {
  path: string;
  added: number;
  removed: number;
  /** Empty for a change with no text to show, such as a rename or a binary file. */
  hunks: Hunk[];
}

export interface Diff {
  files: FileDiff[];
  /** True when the diff was too large and only its start was read. */
  truncated: boolean;
}

/* A diff comes from outside the app and can be any size. Reading stops at
   these limits, so a huge one costs a bounded amount of work to read and to
   draw. Rows are files, hunks and lines: everything that takes space on screen. */
export const maxDiffLength = 1_000_000;
export const maxDiffRows = 5_000;

const hunkHeader = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

const escapes: Record<string, string> = {
  a: "\x07",
  b: "\b",
  f: "\f",
  n: "\n",
  r: "\r",
  t: "\t",
  v: "\v",
};

/** Undoes the quoting git gives a path with unusual characters in it:
    `"caf\303\251 \"x\".txt"` is `café "x".txt`. A path that is not quoted,
    or not validly so, comes back as it was. */
function unquote(text: string): string {
  if (!/^".*"$/.test(text)) return text;
  try {
    // A byte written in octal is one byte of UTF-8, so the whole path is
    // turned into percent escapes and decoded in one go. Both steps throw on
    // text that is not valid, such as half of a surrogate pair.
    return decodeURIComponent(
      text
        .slice(1, -1)
        .replace(/\\([0-7]{3})|\\(.)|([^\\]+)/g, (_, octal, char, plain) =>
          octal
            ? `%${Number.parseInt(octal, 8).toString(16).padStart(2, "0")}`
            : encodeURIComponent(char ? (escapes[char] ?? char) : plain),
        ),
    );
  } catch {
    return text;
  }
}

/** A path as a `---` or `+++` line writes it, without the `a/` or `b/` git
    puts in front or the timestamp plain `diff` puts behind. */
function path(header: string): string {
  return unquote(header.split("\t")[0]).replace(/^[ab]\//, "");
}

/** The new path from a `diff --git a/old b/new` line. Only a change with no
    `+++` line, such as a binary file, is left with this as its name. */
function gitPath(line: string): string {
  const paths = line.slice("diff --git ".length);
  // Inside a quoted path a quote always has a backslash before it, so a space
  // and then a quote can only be where the second path starts.
  const second = paths.lastIndexOf(paths.endsWith('"') ? ' "' : " b/");
  return second < 0 ? paths : path(paths.slice(second + 1));
}

/**
 * Reads a unified diff, as `git diff` or `diff -u` writes it, into files,
 * hunks and numbered lines. The text comes from an agent's environment, so
 * nothing in it is trusted: lines that fit no part of the format are skipped,
 * the result is only ever shown as text, and reading stops at the limits above.
 */
export function parseDiff(text: string): Diff {
  const files: FileDiff[] = [];
  let truncated = text.length > maxDiffLength;
  let rows = 0;
  /** Takes room for one more row. Once there is none, the diff is cut short. */
  const fits = () => {
    if (rows >= maxDiffRows) {
      truncated = true;
      return false;
    }
    rows += 1;
    return true;
  };
  let file: FileDiff | undefined;
  let hunk: Hunk | undefined;
  // The numbers the next old and new lines get, and how many of each the
  // current hunk still has to come. Counting is what tells a removed line
  // that starts with "-- " from the "--- " that opens the next file.
  let before = 0;
  let after = 0;
  let owedOld = 0;
  let owedNew = 0;

  const open = (name: string) => {
    if (!fits()) return false;
    file = { path: name, added: 0, removed: 0, hunks: [] };
    files.push(file);
    hunk = undefined;
    return true;
  };

  for (const line of text.slice(0, maxDiffLength).split("\n")) {
    if (file && hunk && (owedOld > 0 || owedNew > 0)) {
      const body = line.slice(1);
      if (line[0] === "+") {
        if (!fits()) break;
        hunk.lines.push({ kind: "add", text: body, after: after++ });
        file.added += 1;
        owedNew -= 1;
        continue;
      }
      if (line[0] === "-") {
        if (!fits()) break;
        hunk.lines.push({ kind: "remove", text: body, before: before++ });
        file.removed += 1;
        owedOld -= 1;
        continue;
      }
      // An unchanged line starts with a space. Some tools trim that space off
      // an empty line, so an empty line counts as one too.
      if (line[0] === " " || line === "") {
        if (!fits()) break;
        hunk.lines.push({ kind: "context", text: body, before: before++, after: after++ });
        owedOld -= 1;
        owedNew -= 1;
        continue;
      }
      // "\ No newline at end of file" is a note, not a line.
      if (line[0] === "\\") continue;
      // Nothing else belongs in a hunk: its header promised more lines than
      // it has. End it here and read this line as whatever comes next.
      owedOld = owedNew = 0;
    }

    if (line.startsWith("diff --git ")) {
      if (!open(gitPath(line))) break;
    } else if (line.startsWith("rename to ")) {
      if (file) file.path = unquote(line.slice("rename to ".length));
    } else if (line.startsWith("--- ")) {
      // In a plain diff, with no "diff --git" lines, this is what opens a file.
      if ((!file || file.hunks.length > 0) && !open("")) break;
      if (file && line !== "--- /dev/null") file.path = path(line.slice(4));
    } else if (line.startsWith("+++ ")) {
      if (file && line !== "+++ /dev/null") file.path = path(line.slice(4));
    } else if (file) {
      const match = hunkHeader.exec(line);
      if (match) {
        if (!fits()) break;
        before = Number(match[1]);
        owedOld = Number(match[2] ?? 1);
        after = Number(match[3]);
        owedNew = Number(match[4] ?? 1);
        hunk = { header: line, lines: [] };
        file.hunks.push(hunk);
      }
    }
  }
  return { files, truncated };
}
