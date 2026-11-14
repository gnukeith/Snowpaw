import { useRef, type KeyboardEvent, type PointerEvent } from "react";
import styles from "./PanelResizer.module.css";

interface Props {
  /** Finds how wide the panel is on screen right now, in pixels. */
  measure: () => number;
  /** Asks for a width. The layout keeps it within what fits. */
  onResize: (width: number | undefined) => void;
}

/** How far one press of an arrow key moves the edge, in pixels. */
const step = 16;

/**
 * The edge between the conversation and the agent's panel, for dragging the
 * panel wider or narrower. The arrow keys do the same, and a double press
 * puts the panel back to the width it comes with.
 */
export function PanelResizer({ measure, onResize }: Props) {
  // Where the drag began: the pointer's place and the panel's width then.
  const from = useRef<{ x: number; width: number }>(undefined);

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    from.current = { x: event.clientX, width: measure() };
  }

  function onPointerMove(event: PointerEvent) {
    // The panel is on the right, so moving left makes it wider.
    if (from.current) onResize(from.current.width + from.current.x - event.clientX);
  }

  function onPointerUp() {
    if (!from.current) return;
    from.current = undefined;
    // What is kept is the width the layout settled on, not how far the
    // pointer went past it.
    onResize(measure());
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    onResize(measure() + (event.key === "ArrowLeft" ? step : -step));
  }

  return (
    <div
      className={styles.resizer}
      role="separator"
      aria-orientation="vertical"
      aria-label="Panel width"
      aria-valuenow={Math.round(measure())}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={() => onResize(undefined)}
      onKeyDown={onKeyDown}
    />
  );
}
