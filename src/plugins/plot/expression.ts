export type Expression =
  | { kind: "number"; value: number }
  | { kind: "variable" }
  | { kind: "unary"; sign: string; value: Expression }
  | { kind: "binary"; op: string; left: Expression; right: Expression }
  | { kind: "call"; fn: (...values: number[]) => number; args: Expression[] };

const constants = new Map([
  ["pi", Math.PI], ["e", Math.E], ["tau", 2 * Math.PI],
]);

// Only these functions can be called; names never reach JavaScript's objects.
const functions = new Map<string, { arity: number; run: (...values: number[]) => number }>([
  ["sin", { arity: 1, run: Math.sin }], ["cos", { arity: 1, run: Math.cos }],
  ["tan", { arity: 1, run: Math.tan }], ["asin", { arity: 1, run: Math.asin }],
  ["acos", { arity: 1, run: Math.acos }], ["atan", { arity: 1, run: Math.atan }],
  ["sinh", { arity: 1, run: Math.sinh }], ["cosh", { arity: 1, run: Math.cosh }],
  ["tanh", { arity: 1, run: Math.tanh }], ["exp", { arity: 1, run: Math.exp }],
  ["ln", { arity: 1, run: Math.log }], ["log", { arity: 1, run: Math.log }],
  ["log2", { arity: 1, run: Math.log2 }], ["log10", { arity: 1, run: Math.log10 }],
  ["sqrt", { arity: 1, run: Math.sqrt }], ["cbrt", { arity: 1, run: Math.cbrt }],
  ["abs", { arity: 1, run: Math.abs }], ["floor", { arity: 1, run: Math.floor }],
  ["ceil", { arity: 1, run: Math.ceil }], ["round", { arity: 1, run: Math.round }],
  ["sign", { arity: 1, run: Math.sign }],
  ["min", { arity: 2, run: Math.min }], ["max", { arity: 2, run: Math.max }],
  ["atan2", { arity: 2, run: Math.atan2 }], ["pow", { arity: 2, run: Math.pow }],
]);

export function fail(line: number, message: string): never {
  throw new Error(`Line ${line}: ${message}`);
}

/** Reads arithmetic without running code from the message. Each recursive
    part has a depth limit, and the length limit also bounds the tree's size. */
export function parseExpression(source: string, variable?: "x" | "t", line = 1): Expression {
  if (source.length > 200) fail(line, "Shorten this expression to 200 characters or fewer.");
  const tokens: { text: string; kind: "number" | "name" | "symbol" }[] = [];
  let offset = 0;
  while (offset < source.length) {
    const rest = source.slice(offset);
    const space = /^\s+/.exec(rest);
    if (space) { offset += space[0].length; continue; }
    const number = /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/.exec(rest);
    const name = /^[A-Za-z_][A-Za-z_0-9]*/.exec(rest);
    const text = number?.[0] ?? name?.[0] ?? rest[0];
    if (!number && !name && !"+-*/^(),".includes(text)) {
      fail(line, "Use only numbers, names, arithmetic signs and round brackets in expressions.");
    }
    tokens.push({ text, kind: number ? "number" : name ? "name" : "symbol" });
    offset += text.length;
  }
  let at = 0;
  let depth = 0;
  const peek = () => tokens[at]?.text;
  const take = (text: string) => peek() === text ? (at++, true) : false;
  const nested = (read: () => Expression): Expression => {
    if (++depth > 64) fail(line, "Use no more than 64 nested brackets, powers or signs.");
    const result = read();
    depth--;
    return result;
  };
  const binary = (op: string, left: Expression, right: Expression): Expression => ({ kind: "binary", op, left, right });

  function sum(): Expression {
    let value = product();
    while (peek() === "+" || peek() === "-") {
      const op = tokens[at++].text;
      value = binary(op, value, product());
    }
    return value;
  }

  function product(): Expression {
    let value = unary();
    while (true) {
      if (peek() === "*" || peek() === "/") {
        const op = tokens[at++].text;
        value = binary(op, value, unary());
      } else if (tokens[at - 1]?.kind === "number" && (tokens[at]?.kind === "name" || peek() === "(")) {
        value = binary("*", value, unary());
      } else return value;
    }
  }

  function unary(): Expression {
    if (peek() === "+" || peek() === "-") {
      const sign = tokens[at++].text;
      return { kind: "unary", sign, value: nested(unary) };
    }
    return power();
  }

  function power(): Expression {
    const value = atom();
    // Reading a unary expression on the right permits 2^-3 and makes powers
    // associate to the right, while -x^2 keeps the minus outside the power.
    return take("^") ? binary("^", value, nested(unary)) : value;
  }

  function atom(): Expression {
    const token = tokens[at++];
    if (!token) fail(line, "Add a number or expression here.");
    if (token.kind === "number") {
      const value = Number(token.text);
      if (!Number.isFinite(value)) fail(line, "Use a smaller number here.");
      return { kind: "number", value };
    }
    if (token.text === "(") {
      const value = nested(sum);
      if (!take(")")) fail(line, "Close each opening bracket with a closing bracket.");
      return value;
    }
    if (token.kind !== "name") fail(line, "Put a number, name or opening bracket here.");
    if (token.text === variable) return { kind: "variable" };
    const constant = constants.get(token.text);
    if (constant !== undefined) return { kind: "number", value: constant };
    const fn = functions.get(token.text);
    if (!fn) fail(line, `Replace the unknown name ${token.text} with a supported function, constant or variable.`);
    const arityMessage = `${token.text} needs ${fn.arity === 1 ? "one number" : "two numbers separated by a comma"} in its brackets.`;
    if (!take("(")) fail(line, arityMessage);
    const args: Expression[] = [];
    if (!take(")")) {
      do {
        if (peek() === ")" || peek() === "," || peek() === undefined) fail(line, arityMessage);
        args.push(nested(sum));
      } while (take(","));
      if (!take(")")) fail(line, "Close each function's brackets after its numbers.");
    }
    if (args.length !== fn.arity) fail(line, arityMessage);
    return { kind: "call", fn: fn.run, args };
  }

  const result = sum();
  if (at !== tokens.length) fail(line, "Separate expressions with an arithmetic sign and check the brackets.");
  return result;
}

export function evaluate(tree: Expression, variable = 0): number {
  switch (tree.kind) {
    case "number": return tree.value;
    case "variable": return variable;
    case "unary": return (tree.sign === "-" ? -1 : 1) * evaluate(tree.value, variable);
    case "call": return tree.fn(...tree.args.map((arg) => evaluate(arg, variable)));
    case "binary": {
      const left = evaluate(tree.left, variable);
      const right = evaluate(tree.right, variable);
      switch (tree.op) {
        case "+": return left + right;
        case "-": return left - right;
        case "*": return left * right;
        case "/": return left / right;
        case "^": return left ** right;
      }
    }
  }
  return NaN;
}
