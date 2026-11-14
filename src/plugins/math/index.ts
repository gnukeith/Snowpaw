import type { Plugin } from "../types.ts";

export const math: Plugin = {
  id: "math",
  name: "Math",
  about: "Draws formulas written in LaTeX, between $ signs or in a math block.",
  blocks: { math: () => import("./Formula.tsx") },
};
