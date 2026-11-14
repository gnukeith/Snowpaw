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

const hunkHeader = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/** A path as a diff header writes it, without the `a/` or `b/` git puts in
    front or the timestamp plain `diff` puts behind. */
function path(header: string): string {
  return header.split("\t")[0].replace(/^[ab]\//, "");
}

/**
 * Reads a unified diff, as `git diff` or `diff -u` writes it, into files,
 * hunks and numbered lines. The text comes from an agent's environment, so
 * nothing in it is trusted: lines that fit no part of the format are skipped,
 * and the result is only ever shown as text.
 */
export function parseDiff(text: string): FileDiff[] {
  const files: FileDiff[] = [];
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
    file = { path: name, added: 0, removed: 0, hunks: [] };
    files.push(file);
    hunk = undefined;
  };

  for (const line of text.split("\n")) {
    if (file && hunk && (owedOld > 0 || owedNew > 0)) {
      const body = line.slice(1);
      if (line[0] === "+") {
        hunk.lines.push({ kind: "add", text: body, after: after++ });
        file.added += 1;
        owedNew -= 1;
        continue;
      }
      if (line[0] === "-") {
        hunk.lines.push({ kind: "remove", text: body, before: before++ });
        file.removed += 1;
        owedOld -= 1;
        continue;
      }
      // An unchanged line starts with a space. Some tools trim that space off
      // an empty line, so an empty line counts as one too.
      if (line[0] === " " || line === "") {
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
      // Provisional: the +++ line below names the file more reliably.
      open(line.slice(line.lastIndexOf(" b/") + 3));
    } else if (line.startsWith("--- ")) {
      // In a plain diff, with no "diff --git" lines, this is what opens a file.
      if (!file || file.hunks.length > 0) open("");
      if (file && line !== "--- /dev/null") file.path = path(line.slice(4));
    } else if (line.startsWith("+++ ")) {
      if (file && line !== "+++ /dev/null") file.path = path(line.slice(4));
    } else if (file) {
      const match = hunkHeader.exec(line);
      if (match) {
        before = Number(match[1]);
        owedOld = Number(match[2] ?? 1);
        after = Number(match[3]);
        owedNew = Number(match[4] ?? 1);
        hunk = { header: line, lines: [] };
        file.hunks.push(hunk);
      }
    }
  }
  return files;
}
