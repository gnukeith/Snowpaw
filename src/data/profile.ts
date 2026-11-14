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

const panelKey = "snowpaw.panel-width";

/** How wide the user last dragged the agent's panel, in pixels, if they did. */
export function loadPanelWidth(): number | undefined {
  try {
    const saved = Number(localStorage.getItem(panelKey));
    return Number.isFinite(saved) && saved > 0 ? saved : undefined;
  } catch {
    return undefined;
  }
}

export function savePanelWidth(width: number | undefined) {
  try {
    if (width === undefined) localStorage.removeItem(panelKey);
    else localStorage.setItem(panelKey, String(Math.round(width)));
  } catch {
    // Storage is denied or full. The width still holds until the app closes.
  }
}

const setupKey = "snowpaw.setup";

/** Whether the first-run steps have been finished or skipped. */
export function loadSetupDone(): boolean {
  try {
    return localStorage.getItem(setupKey) === "done";
  } catch {
    // Storage is denied. Showing the steps on every start would be worse than never.
    return true;
  }
}

export function saveSetupDone() {
  try {
    localStorage.setItem(setupKey, "done");
  } catch {
    // Storage is denied or full. The steps stay closed until the app does.
  }
}
