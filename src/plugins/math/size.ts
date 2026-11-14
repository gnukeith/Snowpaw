/* KaTeX's `maxSize` caps most sizes in a formula, but not all of them: a
   raised box's offset and a negative kern or rule pass straight through to
   the MathML it builds. A formula is therefore checked after it is built and
   before it is shown, and refused if any size in it is out of bounds. */

/** The largest size, up or down, a formula may ask for, in ems. KaTeX's own
    limit is set to the same. */
export const largest = 20;

/** The MathML attributes that hold a length or a list of them. */
const sized = new Set(["width", "height", "depth", "voffset", "lspace", "rspace", "minsize", "maxsize", "mathsize", "rowspacing", "columnspacing"]);

/** Roughly how many ems one of each unit is, at a 10 point font. */
const ems: Record<string, number> = { em: 1, ex: 0.5, mu: 1 / 18, pt: 0.1, bp: 0.1, px: 1 / 16, pc: 1.2, dd: 0.107, cc: 1.28, mm: 0.285, cm: 2.85, in: 7.23, sp: 0.1 / 65536 };

/** The size, in ems, of the largest length in an attribute's value, or 0 if
    it holds none. A percentage or a word ("infinity") counts as too large. */
export function sizeOf(name: string, value: string): number {
  if (!sized.has(name)) return 0;
  let most = 0;
  for (const part of value.trim().split(/\s+/)) {
    if (part === "" || part === "0") continue;
    const match = /^([+-]?(?:\d+\.?\d*|\.\d+))(em|ex|mu|pt|bp|px|pc|dd|cc|mm|cm|in|sp)?$/.exec(part);
    if (!match) return Infinity;
    most = Math.max(most, Math.abs(Number(match[1])) * ems[match[2] ?? "em"]);
  }
  return most;
}
