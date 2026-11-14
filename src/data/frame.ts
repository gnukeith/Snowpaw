export const windowButtons = ["minimize", "maximize", "close"] as const;
export type WindowButton = (typeof windowButtons)[number];

/** The window buttons the app draws, by the side of the window they go on. */
export interface ButtonLayout {
  start: WindowButton[];
  end: WindowButton[];
}

/**
 * Reads the desktop's button layout as GTK writes it, such as
 * `icon:minimize,maximize,close`: what goes left of the colon is on the
 * left. Only the three buttons the app can draw are kept, once each. The
 * desktop's choice is followed even when it is to have no buttons at all.
 */
export function parseButtonLayout(layout: string): ButtonLayout {
  const seen = new Set<string>();
  const [start, end] = layout.split(":").map((side) =>
    side
      .split(",")
      .map((name) => name.trim())
      .filter((name): name is WindowButton => {
        const fresh = windowButtons.includes(name as WindowButton) && !seen.has(name);
        seen.add(name);
        return fresh;
      }),
  );
  return { start: start ?? [], end: end ?? [] };
}
