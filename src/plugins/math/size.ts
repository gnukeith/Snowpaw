/* KaTeX's `maxSize` caps most sizes in a formula, but not all of them: a
   raised box's offset and a negative kern or rule pass straight through to
   the MathML it builds, and sizes compound when they are nested: eight
   \Huge inside each other make a letter about 1,500 times its size. A
   formula is therefore checked after it is built and before it is shown,
   following sizes down the tree as the browser will, and refused if
   anything in it ends up out of bounds. */

/** The largest size or shift, up or down, anything in a formula may reach,
    in ems of the text around it. KaTeX's own limit is set to the same. */
export const largest = 20;

/** How many times larger than the text around it anything may be drawn. */
export const largestScale = 4;

/** The MathML attributes that hold a length or a list of them. */
const sized = new Set([
  "width", "height", "depth", "voffset", "lspace", "rspace", "minsize", "maxsize",
  "rowspacing", "columnspacing", "linethickness",
]);

/** Roughly how many ems one of each unit is, at a 10 point font. */
const ems: Record<string, number> = {
  em: 1, ex: 0.5, mu: 1 / 18, pt: 0.1, bp: 0.1, px: 1 / 16, pc: 1.2, dd: 0.107, cc: 1.28,
  mm: 0.285, cm: 2.85, in: 7.23, sp: 0.1 / 65536,
};

/** The size, in ems, of the largest length in an attribute's value, or 0 if
    it holds none. A length relative to the element's own content ("-0.5width",
    as \clap makes, or "50%") is bounded by that content and counts as 0 while
    it is no more than twice it. Anything else that cannot be read counts as
    too large. */
export function sizeOf(name: string, value: string): number {
  if (!sized.has(name)) return 0;
  let most = 0;
  for (const part of value.trim().split(/\s+/)) {
    if (part === "" || part === "0") continue;
    const match = /^([+-]?(?:\d+\.?\d*|\.\d+))(em|ex|mu|pt|bp|px|pc|dd|cc|mm|cm|in|sp|width|height|depth|%)?$/.exec(part);
    if (!match) return Infinity;
    const amount = Math.abs(Number(match[1]));
    const unit = match[2] ?? "em";
    if (unit === "width" || unit === "height" || unit === "depth") {
      if (amount > 2) return Infinity;
    } else if (unit === "%") {
      if (amount > 200) return Infinity;
    } else {
      most = Math.max(most, amount * ems[unit]);
    }
  }
  return most;
}

/** How many times larger a `mathsize` makes what is inside it. Only ems and
    percentages are read; anything else counts as too large, so that it can
    never shrink the scale to nothing and wave what is inside it through. */
function scaleOf(value: string): number {
  const match = /^\s*(\d+\.?\d*|\.\d+)(em|%)?\s*$/.exec(value);
  if (!match) return Infinity;
  return Number(match[1]) / (match[2] === "%" ? 100 : 1);
}

/** Just enough of an element to check it: its attributes and children. */
export interface Checked {
  attributes: Iterable<{ name: string; value: string }>;
  children: Iterable<Checked>;
}

/**
 * Throws if anything in the tree, once nested sizes and shifts are added up,
 * is larger than `largest` or scaled past `largestScale`.
 */
export function checkSizes(root: Checked): void {
  const stack: { element: Checked; scale: number; shift: number }[] = [{ element: root, scale: 1, shift: 0 }];
  while (stack.length > 0) {
    const { element, scale: outer, shift: outerShift } = stack.pop()!;
    let scale = outer;
    let shift = outerShift;
    const lengths: number[] = [];
    for (const { name, value } of element.attributes) {
      // A size given to this element scales what is inside it.
      if (name === "mathsize") scale = outer * scaleOf(value);
      else if (name === "voffset") shift = outerShift + sizeOf(name, value) * outer;
      else lengths.push(sizeOf(name, value));
    }
    const tooLarge =
      scale > largestScale ||
      Math.abs(shift) > largest ||
      lengths.some((length) => length * scale > largest);
    if (tooLarge) throw new Error("This formula asks for more room than a message has.");
    for (const child of element.children) stack.push({ element: child, scale, shift });
  }
}
