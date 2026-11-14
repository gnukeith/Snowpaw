const storageKey = "snowpaw.name";

/** The name the user chose for themselves, or an empty string if they chose none. */
export function loadName(): string {
  try {
    return localStorage.getItem(storageKey) ?? "";
  } catch {
    return "";
  }
}

export function saveName(name: string) {
  try {
    localStorage.setItem(storageKey, name);
  } catch {
    // Storage is denied or full. The name still shows until the app closes.
  }
}
