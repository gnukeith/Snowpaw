import { useEffect, useId, useRef, type ReactNode } from "react";
import styles from "./Dialog.module.css";
import { IconButton } from "./IconButton";

interface Props {
  title: string;
  /** Called once the dialog has closed, however that happened. */
  onClose: () => void;
  /** Room for a list of categories beside the content, instead of a short form. */
  wide?: boolean;
  children: ReactNode;
}

/** A modal on the native dialog element, which brings focus trapping, Escape
    to close and the return of focus to whatever opened it. */
export function Dialog({ title, onClose, wide, children }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useId();

  // What had focus when the dialog opened. Kept in a ref because development
  // builds run the effect below twice, and the second run would find focus
  // already inside the dialog.
  const opener = useRef<Element | null>(null);

  useEffect(() => {
    opener.current ??= document.activeElement;
    if (!dialog.current?.open) dialog.current?.showModal();
    // Closing the dialog hands focus back by itself. Taking the dialog off the
    // page does not, so return it by hand. If what opened the dialog has gone
    // too, there is nothing to return it to.
    return () => {
      if (opener.current instanceof HTMLElement) opener.current.focus();
    };
  }, []);

  return (
    <dialog
      ref={dialog}
      className={wide ? styles.wide : styles.dialog}
      aria-labelledby={heading}
      onClose={onClose}
      // The dialog has no padding of its own, so a click that lands on it
      // and not on something inside it is a click on the dimmed backdrop.
      onClick={(event) => event.target === event.currentTarget && event.currentTarget.close()}
    >
      <header className={styles.header}>
        <h1 id={heading} className={styles.title}>
          {title}
        </h1>
        <IconButton icon="close" label="Close" onClick={() => dialog.current?.close()} />
      </header>
      {children}
    </dialog>
  );
}
