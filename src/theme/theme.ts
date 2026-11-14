import { invoke } from "@tauri-apps/api/core";

export const modes = ["system", "light", "dark"] as const;
export type Mode = (typeof modes)[number];

export interface Theme {
  mode: Mode;
  /** Accent hue in degrees, 0 to 360. Drives every colour in tokens.css. */
  hue: number;
}

const storageKey = "snowpaw.theme";
const fallback: Theme = { mode: "system", hue: 250 };

/** Reads the saved theme. Anything missing or malformed falls back to the default. */
export function loadTheme(): Theme {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) ?? "{}");
    return {
      mode: modes.includes(saved.mode) ? saved.mode : fallback.mode,
      hue: Number.isFinite(saved.hue) ? Math.min(360, Math.max(0, saved.hue)) : fallback.hue,
    };
  } catch {
    return fallback;
  }
}

export function saveTheme(theme: Theme) {
  try {
    localStorage.setItem(storageKey, JSON.stringify(theme));
  } catch {
    // Storage is denied or full. The theme still applies until the app closes.
  }
}

/** Puts the theme on the root element, where tokens.css picks it up. */
export function applyTheme(theme: Theme) {
  const root = document.documentElement;
  if (theme.mode === "system") delete root.dataset.theme;
  else root.dataset.theme = theme.mode;
  root.style.setProperty("--hue", String(theme.hue));
}

/**
 * Tells the window what colour the page's background is, so that it can paint
 * itself the same behind the page. A window that grows faster than the page
 * can be redrawn shows through for a moment, and should not show another colour.
 */
export function tintWindow() {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  const context = canvas.getContext("2d");
  if (!context) return;
  // Drawn and read back: the colour is written in a form only the page
  // understands, and the window wants plain red, green and blue.
  context.fillStyle = getComputedStyle(document.body).backgroundColor;
  context.fillRect(0, 0, 1, 1);
  const [red, green, blue] = context.getImageData(0, 0, 1, 1).data;
  // Without the app around it, as in a browser, there is no window to tell.
  invoke("window_tint", { red, green, blue }).catch(() => {});
}
