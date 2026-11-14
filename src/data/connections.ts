import { cleanName } from "./agents.ts";

/** A model provider Snowpaw can talk to: where it is and what to ask it for.
    Its key is not here. The key is kept in the desktop's keyring by the Rust
    side and never comes back to the page. */
export interface Connection {
  id: string;
  /** The entry of `presets` it was made from. */
  preset: string;
  name: string;
  /** Where requests go: the address an OpenAI-compatible client is given. */
  address: string;
  /** The model to use unless something asks for another. Empty until chosen. */
  model: string;
}

/** A provider the form can fill in, so nobody has to look up an address. */
export interface Preset {
  id: string;
  name: string;
  /** Empty for the one where the address is the user's to type. */
  address: string;
  /** Whether the provider asks for a key. A server of your own often has none. */
  key: "needed" | "optional";
  /** A path that answers only to a good key, for a provider whose list of
      models answers to anyone. */
  proof?: string;
}

export const custom = "custom";

/* To offer another provider, add an entry here. Each one speaks the
   OpenAI-compatible API at the address given. The addresses were checked
   against each provider's own documentation on 2026-11-14. */
export const presets: readonly Preset[] = [
  { id: "openai", name: "OpenAI", address: "https://api.openai.com/v1", key: "needed" },
  { id: "google", name: "Google Gemini", address: "https://generativelanguage.googleapis.com/v1beta/openai", key: "needed" },
  { id: "xai", name: "xAI", address: "https://api.x.ai/v1", key: "needed" },
  { id: "deepseek", name: "DeepSeek", address: "https://api.deepseek.com", key: "needed" },
  { id: "groq", name: "Groq", address: "https://api.groq.com/openai/v1", key: "needed" },
  { id: "openrouter", name: "OpenRouter", address: "https://openrouter.ai/api/v1", key: "needed", proof: "/key" },
  { id: "ollama", name: "Ollama on this computer", address: "http://localhost:11434/v1", key: "optional" },
  { id: "lmstudio", name: "LM Studio on this computer", address: "http://localhost:1234/v1", key: "optional" },
  { id: custom, name: "My own server", address: "", key: "optional" },
];

export function presetOf(id: string): Preset {
  return presets.find((preset) => preset.id === id) ?? presets[presets.length - 1];
}

/** A connection not yet made, under `id`: a new one unless given. */
export function newConnection(preset: Preset = presets[0], id: string = crypto.randomUUID()): Connection {
  return {
    id,
    preset: preset.id,
    name: preset.id === custom ? "" : preset.name,
    address: preset.address,
    model: "",
  };
}

/** The key the search provider's key is kept under, and where it is sent. */
export const search = { id: "search", name: "Brave Search", address: "https://api.search.brave.com" };

/** How an address with its scheme written out starts: "https://". */
const scheme = /^[a-z][a-z0-9+.-]*:\/\//i;

/** How an address starts when its scheme is written but mistyped, as in
    "https:/host" or "https:host". A word, a colon and then a digit is a
    host and its port instead: "gpu-box:8000". */
const brokenScheme = /^[a-z][a-z0-9+.-]*:(?!\/\/|\d)/i;

/** A host name with any port taken off, in lower case, and without the dot
    a fully written name may end with, or "" if there is none. */
function hostOf(typed: string): string {
  try {
    return new URL(scheme.test(typed) ? typed : `http://${typed}`).hostname.toLowerCase().replace(/\.$/, "");
  } catch {
    return "";
  }
}

/** Whether a host is this computer. What is sent there never leaves it. An
    IPv4 address written as IPv6 ("::ffff:127.0.0.1") reads "::ffff:7fxx:xxxx"
    once parsed. */
function isThisComputer(host: string): boolean {
  return (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    /^127(\.\d+){3}$/.test(host) ||
    host === "[::1]" ||
    /^\[::ffff:7f[0-9a-f]{2}:[0-9a-f]{1,4}\]$/.test(host)
  );
}

/** Whether a host is on the same network as this computer, as far as a name
    can tell: a private address, or a name with no dot or a local ending. A
    name is not proof of where it leads, so this only chooses what to add when
    no scheme was typed; the warning about keys in the clear does not rely on it. */
function isNearby(host: string): boolean {
  return (
    isThisComputer(host) ||
    /^10(\.\d+){3}$/.test(host) ||
    /^192\.168(\.\d+){2}$/.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])(\.\d+){2}$/.test(host) ||
    // IPv6 unique local (fc00::/7) and link local (fe80::/10).
    /^\[(f[cd][0-9a-f]{2}|fe[89ab][0-9a-f]):/.test(host) ||
    /\.(local|lan|internal|home\.arpa)$/.test(host) ||
    (host !== "" && !host.includes(".") && !host.startsWith("["))
  );
}

/**
 * An address as it is stored and sent: a full http or https address with no
 * trailing slash, query or fragment. Typed without "https://", a server on
 * this computer or network gets "http://" and anything else "https://".
 * Returns "" for what is not an address, and for one with a name and password
 * in it: a key belongs in the key box, where it is kept safe. A mistyped
 * scheme or a control character is refused, not guessed at, because a guess
 * would send the key somewhere the person did not mean.
 */
export function cleanAddress(text: unknown): string {
  if (typeof text !== "string") return "";
  let typed = text.trim();
  // The parser would quietly drop a line break inside a host name and join
  // the two halves into another name.
  if (!typed || /[\u0000-\u001f\u007f]/.test(typed) || brokenScheme.test(typed)) return "";
  if (!scheme.test(typed)) {
    typed = `${isNearby(hostOf(typed)) ? "http" : "https"}://${typed}`;
  }
  let url: URL;
  try {
    url = new URL(typed);
  } catch {
    return "";
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return "";
  if (url.username || url.password || !url.hostname) return "";
  return url.origin + url.pathname.replace(/\/+$/, "");
}

/** Whether a key sent to this address would cross a network unencrypted. */
export function sendsKeyInTheClear(address: string): boolean {
  const clean = cleanAddress(address);
  return clean.startsWith("http://") && !isThisComputer(hostOf(clean));
}

/** The part of an address a person recognises it by: "api.openai.com". */
export function hostLabel(address: string): string {
  try {
    return new URL(address).host;
  } catch {
    return address;
  }
}

const maxModelLength = 200;

/** How every connection's id looks: `crypto.randomUUID` made it. Any other
    could be the search key's ("search") and forget it on removal. */
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Turns whatever was in storage into connections. Entries that are malformed,
 * have no usable address or repeat an id are dropped, so the rest of the app
 * can rely on what it gets.
 */
export function parseConnections(saved: unknown): Connection[] {
  if (!Array.isArray(saved)) return [];
  const connections: Connection[] = [];
  const ids = new Set<string>();
  for (const entry of saved) {
    if (typeof entry !== "object" || entry === null) continue;
    const { id, preset, model } = entry;
    const name = cleanName(entry.name);
    const address = cleanAddress(entry.address);
    if (typeof id !== "string" || !uuid.test(id) || ids.has(id) || !name || !address) continue;
    ids.add(id);
    connections.push({
      id,
      preset: presetOf(typeof preset === "string" ? preset : custom).id,
      name,
      address,
      model: typeof model === "string" ? model.trim().slice(0, maxModelLength) : "",
    });
  }
  return connections;
}

const storageKey = "snowpaw.connections";

export function loadConnections(): Connection[] {
  try {
    return parseConnections(JSON.parse(localStorage.getItem(storageKey) ?? "[]"));
  } catch {
    return [];
  }
}

/** Returns false when storage is denied or full, so the caller can say so. */
export function saveConnections(connections: Connection[]): boolean {
  try {
    localStorage.setItem(storageKey, JSON.stringify(connections));
    return true;
  } catch {
    return false;
  }
}

/** Why the Rust side could not do what was asked, as it reports it. */
export interface Failure {
  kind: string;
  /** The HTTP status the server answered with, when it answered. */
  status?: number;
}

/** What went wrong, in words a person can act on. Anything that is not one of
    the failures the Rust side reports gets the last sentence. */
export function describeFailure(failure: unknown, keySaved = true): string {
  const { kind, status } = (typeof failure === "object" && failure !== null ? failure : {}) as Partial<Failure>;
  switch (kind) {
    case "address":
      return "That is not an address Snowpaw can use.";
    case "keyring":
      return "No keyring is running on this desktop, so there is nowhere safe to keep a key.";
    case "locked":
      return "The keyring is locked. Unlock it and try again.";
    case "unreachable":
      return "Nothing answered at that address.";
    case "timeout":
      return "The server took too long to answer.";
    case "certificate":
      return "The server's certificate could not be checked, so nothing was sent.";
    case "refused":
      return keySaved ? "The server turned the key down." : "The server wants a key.";
    case "missing":
      return keySaved
        ? "The server answered, but not at that address. Check the end of it: it is often /v1."
        : "Nothing was found there. The provider may want a key, or the end of the address may be wrong.";
    case "limit":
      return "The provider says this key has used up its allowance for now.";
    case "server":
      return `The server reported an error of its own${typeof status === "number" ? ` (${status})` : ""}.`;
    case "answer":
      return "The server answered with something Snowpaw did not expect.";
    case "redirect":
      return "The server pointed to another address. Snowpaw did not follow it, so the key stayed here.";
    default:
      return "It did not work, and Snowpaw could not tell why.";
  }
}
