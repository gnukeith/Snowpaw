const nameKey = "snowpaw.name";
const pictureKey = "snowpaw.picture";

/** The name the user chose for themselves, or an empty string if they chose none. */
export function loadName(): string {
  try {
    return localStorage.getItem(nameKey) ?? "";
  } catch {
    return "";
  }
}

export function saveName(name: string) {
  try {
    localStorage.setItem(nameKey, name);
  } catch {
    // Storage is denied or full. The name still shows until the app closes.
  }
}

/** The picture the user chose for themselves, as `toPicture` made it, if any. */
export function loadPicture(): string | undefined {
  try {
    const saved = localStorage.getItem(pictureKey);
    return saved?.startsWith("data:image/") ? saved : undefined;
  } catch {
    return undefined;
  }
}

/** Returns false when storage is denied or full, so the caller can say so. */
export function savePicture(picture: string | undefined): boolean {
  try {
    if (picture) localStorage.setItem(pictureKey, picture);
    else localStorage.removeItem(pictureKey);
    return true;
  } catch {
    return false;
  }
}
