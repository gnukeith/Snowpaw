import { invoke } from "@tauri-apps/api/core";
import { createContext, useEffect } from "react";
import type { ButtonLayout, WindowButton } from "../data/frame";
import { IconButton } from "./IconButton";
import styles from "./WindowButtons.module.css";

const actions = {
  minimize: { label: "Minimize", command: "window_minimize" },
  maximize: { label: "Maximize or restore", command: "window_toggle_maximize" },
  close: { label: "Close window", command: "window_close" },
};

/** The window buttons the app draws, for parts of it that are not handed them:
    a dialog covers the ones on the page. Undefined where the desktop still
    draws the title bar, and with it the buttons. */
export const WindowFrame = createContext<ButtonLayout | undefined>(undefined);

/** The window's own buttons, drawn by the app because the window has no title
    bar to carry them. Which ones, and in what order, is the desktop's choice. */
export function WindowButtons({ buttons }: { buttons: WindowButton[] }) {
  if (buttons.length === 0) return null;
  return (
    <div className={styles.buttons}>
      {buttons.map((button) => (
        <IconButton
          key={button}
          quiet
          icon={button}
          label={actions[button].label}
          onClick={() => ask(actions[button].command)}
        />
      ))}
    </div>
  );
}

/** Things inside a header that are for pressing, not for moving the window by. */
const controls = "button, a, input, textarea, select, label, summary";

/** How far the pointer travels, in pixels, before a press counts as a drag.
    The distance GTK itself uses unless the desktop says otherwise. */
const dragDistance = 8;

/**
 * Lets the app's header rows stand in for the title bar: dragging an empty
 * part of one moves the window, and pressing it twice maximises the window
 * or puts it back. A header row opts in with `data-window-drag`.
 *
 * The move is asked for once the pointer has travelled, not on the press, as
 * a real title bar does. A press that goes nowhere must stay an ordinary
 * press: the desktop takes the pointer over when a move starts, and the
 * second press of a double press would never arrive.
 */
export function useWindowDrag(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    // Where the press that may become a drag went down.
    let from: { x: number; y: number } | undefined;

    const onMouseDown = (event: MouseEvent) => {
      const target = event.target;
      from = undefined;
      if (event.button !== 0 || !(target instanceof Element)) return;
      if (!target.closest("[data-window-drag]") || target.closest(controls)) return;
      event.preventDefault();
      if (event.detail === 2) ask("window_toggle_maximize");
      else from = { x: event.screenX, y: event.screenY };
    };
    const onMouseMove = (event: MouseEvent) => {
      if (!from) return;
      // The button has to be down still: the desktop only moves a window for
      // a press it can see is going on.
      if (!(event.buttons & 1)) from = undefined;
      else if (Math.hypot(event.screenX - from.x, event.screenY - from.y) >= dragDistance) {
        from = undefined;
        ask("window_drag");
      }
    };

    // A press that ended, here or while the window was not looking, is over.
    const forget = () => {
      from = undefined;
    };

    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", forget);
    window.addEventListener("blur", forget);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", forget);
      window.removeEventListener("blur", forget);
    };
  }, [enabled]);
}

/** The Rust side logs what goes wrong, and there is nothing the page could add. */
function ask(command: string) {
  invoke(command).catch(() => {});
}
