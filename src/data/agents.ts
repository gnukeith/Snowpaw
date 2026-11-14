export interface Agent {
  id: string;
  name: string;
  /** Hue of the avatar shown until the agent has a picture, in degrees. */
  hue: number;
  /** A small square image as a data URL, made by `toPicture`. */
  picture?: string;
  pinned: boolean;
}

export const maxPinned = 3;
export const maxNameLength = 40;

const storageKey = "snowpaw.agents";

/** A name as it is stored: no stray whitespace, never longer than the limit. */
export function cleanName(name: unknown): string {
  if (typeof name !== "string") return "";
  return name.trim().replace(/\s+/g, " ").slice(0, maxNameLength).trim();
}

export function newAgent(name: string, picture?: string): Agent {
  return {
    id: crypto.randomUUID(),
    name: cleanName(name),
    hue: Math.floor(Math.random() * 360),
    picture,
    pinned: false,
  };
}

/** Whether one more agent may be pinned. */
export function canPin(agents: Agent[]): boolean {
  return agents.filter((agent) => agent.pinned).length < maxPinned;
}

/** Up to two letters that stand for a name, for when there is no picture of it. */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return words
    .slice(0, 2)
    .map((word) => [...word][0].toUpperCase())
    .join("");
}

/**
 * Turns whatever was in storage into agents. Entries that are malformed or
 * repeat an id are dropped, and pins beyond the limit are released, so the
 * rest of the app can rely on what it gets.
 */
export function parseAgents(saved: unknown): Agent[] {
  if (!Array.isArray(saved)) return [];
  const agents: Agent[] = [];
  const ids = new Set<string>();
  let pins = 0;
  for (const entry of saved) {
    if (typeof entry !== "object" || entry === null) continue;
    const { id, hue, picture, pinned } = entry;
    const name = cleanName(entry.name);
    if (typeof id !== "string" || !id || ids.has(id) || !name) continue;
    ids.add(id);
    const pin = pinned === true && pins < maxPinned;
    if (pin) pins += 1;
    agents.push({
      id,
      name,
      hue: Number.isFinite(hue) ? hue : 0,
      picture: typeof picture === "string" && picture.startsWith("data:image/") ? picture : undefined,
      pinned: pin,
    });
  }
  return agents;
}

export function loadAgents(): Agent[] {
  try {
    return parseAgents(JSON.parse(localStorage.getItem(storageKey) ?? "[]"));
  } catch {
    return [];
  }
}

/** Returns false when storage is denied or full, so the caller can say so. */
export function saveAgents(agents: Agent[]): boolean {
  try {
    localStorage.setItem(storageKey, JSON.stringify(agents));
    return true;
  } catch {
    return false;
  }
}
