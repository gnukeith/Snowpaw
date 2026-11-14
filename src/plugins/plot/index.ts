import type { Plugin } from "../types.ts";

export const plot: Plugin = {
  id: "plot",
  name: "Plots",
  about: "Draw functions, parametric curves and data from a plot block in a message.",
  blocks: { plot: () => import("./Plot") },
};
