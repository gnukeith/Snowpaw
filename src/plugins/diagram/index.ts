import type { Plugin } from "../types.ts";

export const diagram: Plugin = {
  id: "diagram",
  name: "Diagrams",
  about: "Draws Mermaid diagrams inside messages.",
  blocks: { mermaid: () => import("./Diagram.tsx") },
};
