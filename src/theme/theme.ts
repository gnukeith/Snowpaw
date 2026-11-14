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
  localStorage.setItem(storageKey, JSON.stringify(theme));
}

/** Puts the theme on the root element, where tokens.css picks it up. */
export function applyTheme(theme: Theme) {
  const root = document.documentElement;
  if (theme.mode === "system") delete root.dataset.theme;
  else root.dataset.theme = theme.mode;
  root.style.setProperty("--hue", String(theme.hue));
}
