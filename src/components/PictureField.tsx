import { useEffect, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import { toPicture } from "../data/picture";
import { Button } from "./Button";
import styles from "./PictureField.module.css";

interface Props {
  /** The picture as it stands, drawn by the caller: an avatar. */
  children: ReactNode;
  /** Whether there is a picture to take away. */
  hasPicture: boolean;
  onChange: (picture: string | undefined) => void;
  /** Told while a chosen file is being turned into a picture, so that the
      caller can hold off anything that would leave the picture behind. */
  onWorking?: (working: boolean) => void;
}

/** Choosing a picture for an agent or for yourself, and taking it away again. */
export function PictureField({ children, hasPicture, onChange, onWorking }: Props) {
  const [error, setError] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);
  // Goes up with every change to the picture. A file takes a moment to turn
  // into a picture, and one that finishes after a later change is dropped.
  const change = useRef(0);

  // A file still being read when the field goes away is dropped too: by the
  // time it is done, the picture may have been changed from somewhere else.
  useEffect(
    () => () => {
      change.current += 1;
    },
    [],
  );

  async function choose(event: ChangeEvent<HTMLInputElement>) {
    const chosen = event.target.files?.[0];
    // Cleared so that choosing the same file again still counts as a change.
    event.target.value = "";
    if (!chosen) return;
    const mine = ++change.current;
    onWorking?.(true);
    let picture: string | undefined;
    try {
      picture = await toPicture(chosen);
    } catch {
      // Reported below, if this is still the latest change.
    }
    if (mine !== change.current) return;
    onWorking?.(false);
    setError(picture ? null : "That file could not be used as a picture.");
    if (picture) onChange(picture);
  }

  function remove() {
    change.current += 1;
    onWorking?.(false);
    setError(null);
    onChange(undefined);
  }

  return (
    <div className={styles.field}>
      <div className={styles.row}>
        {children}
        <Button onClick={() => file.current?.click()}>Choose picture</Button>
        {hasPicture && <Button onClick={remove}>Remove</Button>}
        <input ref={file} type="file" accept="image/*" hidden onChange={choose} />
      </div>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
