import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import styles from "./Menu.module.css";

export interface MenuItem {
  label: string;
  onSelect: () => void;
  /** Shown, but cannot be chosen. Its label should say why. */
  disabled?: boolean;
}

interface Props {
  /** Where the menu was asked for, in the window. */
  at: { x: number; y: number };
  items: MenuItem[];
  /** Called once the menu has closed, however that happened. */
  onClose: () => void;
}

/** A short menu at the pointer, as a right click gives. It is a popover, which
    brings closing on Escape and on a press anywhere else. */
export function Menu({ at, items, onClose }: Props) {
  const menu = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState(at);

  useEffect(() => {
    // Focus goes back to where it was when the menu closes, as with a dialog.
    const opener = document.activeElement;
    if (!menu.current?.matches(":popover-open")) menu.current?.showPopover();
    menu.current?.querySelector<HTMLElement>("button:not([aria-disabled=true])")?.focus();
    return () => {
      if (opener instanceof HTMLElement) opener.focus();
    };
  }, []);

  // Asked for near the right or bottom edge, the menu is moved back inside the
  // window before it is painted.
  useLayoutEffect(() => {
    if (!menu.current) return;
    const { width, height } = menu.current.getBoundingClientRect();
    setPlace({
      x: Math.max(0, Math.min(at.x, innerWidth - width)),
      y: Math.max(0, Math.min(at.y, innerHeight - height)),
    });
  }, [at.x, at.y]);

  function onKeyDown(event: KeyboardEvent) {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const choices = [...(menu.current?.querySelectorAll<HTMLElement>("button") ?? [])];
    const from = choices.indexOf(document.activeElement as HTMLElement);
    const step = event.key === "ArrowDown" ? 1 : -1;
    choices[(from + step + choices.length) % choices.length]?.focus();
  }

  return (
    <div
      ref={menu}
      popover="auto"
      role="menu"
      className={styles.menu}
      style={{ left: place.x, top: place.y }}
      onKeyDown={onKeyDown}
      onToggle={(event) => event.newState === "closed" && onClose()}
    >
      {items.map((item) => (
        <button
          key={item.label}
          role="menuitem"
          className={styles.item}
          aria-disabled={item.disabled}
          onClick={() => {
            if (item.disabled) return;
            menu.current?.hidePopover();
            item.onSelect();
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
