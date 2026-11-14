/** A part of a shell command, by what it is, so each kind can have a colour. */
export interface Token {
  kind: "command" | "flag" | "string" | "variable" | "operator" | "comment" | "plain";
  text: string;
}

/* A command comes from an agent's environment and can be any size. One
   longer than this is shown as it is, uncoloured. */
export const maxCommandLength = 10_000;

/* One part of a command, tried in this order at each position: space, a
   comment, a quoted string (closed or not), a variable or the start of a
   command substitution, an operator or redirection, and a bare word. Every
   branch moves forward without going back over what it has read, so the time
   taken grows with the length of the command and no faster. */
const part = new RegExp(
  [
    /(\s+)/,
    /(#.*)/,
    /('[^']*'?|"(?:[^"\\]|\\[\s\S])*"?)/,
    /(\$\{[^}]*\}?|\$\(|\$[A-Za-z_][A-Za-z0-9_]*|\$[0-9@*#?$!-])/,
    /(\|\||&&|;;|[|;&(){}]|\d*(?:>>|<<|[<>])(?:&\d*)?)/,
    /((?:[^\s'"$|;&(){}<>\\]|\\[\s\S]?)+)/,
  ]
    .map((branch) => branch.source)
    .join("|"),
  "y",
);

/** After these, the next word is the name of a command. */
const startsCommand = new Set(["|", "||", "&&", ";", ";;", "&", "(", "{", "$("]);

/** `NAME=value` in front of a command sets a variable for it. */
const assignment = /^[A-Za-z_][A-Za-z0-9_]*=/;

/**
 * Splits a shell command into parts for colouring. It reads enough of the
 * shell's grammar to tell a command's name from its flags, strings, variables
 * and operators, and no more: it never decides what a command does. The
 * parts, joined, are always exactly the text it was given.
 */
export function shellTokens(source: string): Token[] {
  if (source.length > maxCommandLength) return [{ kind: "plain", text: source }];
  const tokens: Token[] = [];
  // Whether the next word names a command, as the first one does.
  let naming = true;
  let at = 0;
  while (at < source.length) {
    part.lastIndex = at;
    const [text, space, comment, string, variable, operator, word] = part.exec(source) ?? [source[at]];
    at += text.length;
    let kind: Token["kind"] = "plain";
    if (space !== undefined) {
      // A new line starts a new command.
      naming ||= text.includes("\n");
    } else if (comment !== undefined) {
      kind = "comment";
    } else if (operator !== undefined) {
      kind = "operator";
      if (startsCommand.has(text)) naming = true;
    } else if (variable !== undefined) {
      kind = "variable";
      naming = text === "$(";
    } else if (string !== undefined) {
      kind = "string";
      naming = false;
    } else if (word !== undefined) {
      if (naming) {
        // Variables set for a command come before its name.
        if (!assignment.test(text)) {
          kind = "command";
          naming = false;
        }
      } else if (text.startsWith("-")) {
        kind = "flag";
      }
    }
    tokens.push({ kind, text });
  }
  return tokens;
}
