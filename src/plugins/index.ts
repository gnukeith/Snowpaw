import { math } from "./math/index.ts";
import type { Block, Plugin } from "./types.ts";

/* The plugins Snowpaw ships with. To add one, add it here. */
export const plugins: readonly Plugin[] = [math];

const storageKey = "snowpaw.plugins.off";

/** The ids of the plugins that are switched off, from whatever was in storage. */
export function parseOff(saved: unknown): string[] {
  if (!Array.isArray(saved)) return [];
  const known = new Set(plugins.map((plugin) => plugin.id));
  return [...new Set(saved.filter((id): id is string => typeof id === "string" && known.has(id)))];
}

export function loadOff(): string[] {
  try {
    return parseOff(JSON.parse(localStorage.getItem(storageKey) ?? "[]"));
  } catch {
    return [];
  }
}

export function saveOff(off: string[]) {
  try {
    localStorage.setItem(storageKey, JSON.stringify(off));
  } catch {
    // Storage is denied or full. The choice still holds until the app closes.
  }
}

/** What loads the block for a fence's word, if a plugin that is switched on
    draws it. The first plugin in the list to claim a word has it. */
export function blockFor(word: string, off: readonly string[]): (() => Promise<{ default: Block }>) | undefined {
  for (const plugin of plugins) {
    if (!off.includes(plugin.id) && Object.hasOwn(plugin.blocks, word)) return plugin.blocks[word];
  }
  return undefined;
}
