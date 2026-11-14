import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type RefObject,
} from "react";
import styles from "./PanelResizer.module.css";

interface Props {
  /** The panel this edge belongs to. */
  panel: RefObject<HTMLElement | null>;
  /** That panel's id and name, so the edge is announced as its edge. */
  controls: string;
  label: string;
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
export function PanelResizer({ panel, controls, label, onResize }: Props) {
  // The drag under way: which pointer, where it began, the panel's width then.
  const drag = useRef<{ pointer: number; x: number; width: number }>(undefined);
  // The panel's width as the layout has it, and the room it sits in. The
  // layout decides both, so they are read back, not remembered.
  const [size, setSize] = useState({ width: 0, room: 0 });

  useEffect(() => {
    const element = panel.current;
    const frame = element?.parentElement;
    if (!element || !frame) return;
    const read = () => setSize({ width: element.offsetWidth, room: frame.clientWidth });
    const watcher = new ResizeObserver(read);
    watcher.observe(element);
    watcher.observe(frame);
    read();
    return () => watcher.disconnect();
  }, [panel]);

  const measure = () => panel.current?.offsetWidth ?? 0;

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || drag.current) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { pointer: event.pointerId, x: event.clientX, width: measure() };
  }

  function onPointerMove(event: PointerEvent) {
    if (event.pointerId !== drag.current?.pointer) return;
    // A button let go where this never heard of it ends the drag here.
    if (!(event.buttons & 1)) finish(event);
    // The panel is on the right, so moving left makes it wider.
    else onResize(drag.current.width + drag.current.x - event.clientX);
  }

  /** Ends the drag, however it ended: let go, cancelled, or taken away. */
  function finish(event: PointerEvent) {
    if (event.pointerId !== drag.current?.pointer) return;
    drag.current = undefined;
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
      aria-controls={controls}
      aria-label={label}
      // As a share of the room, which is the scale a separator is read on,
      // and in pixels for anyone who wants the number.
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={size.room ? Math.round((size.width / size.room) * 100) : 0}
      aria-valuetext={`${size.width} pixels wide`}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={finish}
      onPointerCancel={finish}
      onLostPointerCapture={finish}
      onDoubleClick={() => onResize(undefined)}
      onKeyDown={onKeyDown}
    />
  );
}
