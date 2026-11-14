import { useEffect, useLayoutEffect, useRef, useState, type UIEvent } from "react";

/** Within this many pixels of its end, a view counts as being at its end. */
const nearEnd = 48;

/**
 * Keeps a scrolling view at its end while what it shows grows, as a chat
 * does. Once the reader scrolls back it stays where they put it, until they
 * come back to the end. `shown` is whatever changes when there is more to
 * show. The view takes `ref` and `onScroll`.
 */
export function useFollow<View extends HTMLElement>(shown: unknown) {
  // Held as state, so that a view that appears later is followed from then.
  const [view, setView] = useState<View | null>(null);
  const following = useRef(true);

  useLayoutEffect(() => {
    if (following.current && view) view.scrollTop = view.scrollHeight;
  }, [shown, view]);

  // A view that changes size lays its text out again, which moves its end.
  useEffect(() => {
    if (!view) return;
    const observer = new ResizeObserver(() => {
      if (following.current) view.scrollTop = view.scrollHeight;
    });
    observer.observe(view);
    return () => observer.disconnect();
  }, [view]);

  return {
    ref: setView,
    onScroll({ currentTarget }: UIEvent<View>) {
      following.current =
        currentTarget.scrollHeight - currentTarget.scrollTop - currentTarget.clientHeight < nearEnd;
    },
    /** Follows again from the next change, wherever the reader had got to. */
    follow() {
      following.current = true;
    },
  };
}
