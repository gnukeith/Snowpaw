import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Paw } from "./Paw";
import styles from "./Ripples.module.css";

interface Ripple {
  id: number;
  x: number;
  y: number;
  shape: "paw" | "heart";
  /** How far the shape leans, in degrees, so no two look stamped. */
  tilt: number;
}

/** Clicks that come faster than this many ripples can fade are not each answered. */
const most = 8;

/** What a click is meant for when it lands on one of these, and not for play. */
const busy = "button, a, input, textarea, select, summary, label, [role=button]";

let made = 0;

function Heart({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 21 3.5 12.5a5 5 0 0 1 7.1-7.1L12 6.8l1.4-1.4a5 5 0 0 1 7.1 7.1z" />
    </svg>
  );
}

/**
 * A ripple where a surface is clicked, with a paw or a heart in it, one or
 * the other by chance. It is only for delight: it takes no clicks itself,
 * stays out of the way of buttons and of text being selected, and is not
 * drawn at all for someone who has asked their desktop for less motion.
 *
 * This is the layer the ripples are drawn in. It goes beside the surface,
 * which is marked `data-ripples`, inside the same element, and `className`
 * lays it over that surface. It listens for the clicks itself and keeps its
 * ripples to itself, so that drawing one redraws nothing else.
 */
export function Ripples({ className }: { className: string }) {
  const [ripples, setRipples] = useState<Ripple[]>([]);
  const layer = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const around = layer.current?.parentElement;
    if (!around) return;
    function onClick(event: MouseEvent) {
      const target = event.target as Element;
      if (!layer.current || !target.closest("[data-ripples]") || target.closest(busy)) return;
      // A click that ends a drag across text was made to select it.
      if (getSelection()?.isCollapsed === false) return;
      if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      const box = layer.current.getBoundingClientRect();
      const ripple: Ripple = {
        id: ++made,
        x: event.clientX - box.left,
        y: event.clientY - box.top,
        shape: Math.random() < 0.5 ? "paw" : "heart",
        tilt: Math.round(Math.random() * 40 - 20),
      };
      setRipples((all) => [...all.slice(1 - most), ripple]);
    }
    around.addEventListener("click", onClick);
    return () => around.removeEventListener("click", onClick);
  }, []);

  return (
    <span ref={layer} className={`${styles.layer} ${className}`} aria-hidden="true">
      {ripples.map(({ id, x, y, shape, tilt }) => {
        const Shape = shape === "paw" ? Paw : Heart;
        return (
          <span
            key={id}
            className={styles.ripple}
            style={{ "--x": `${x}px`, "--y": `${y}px`, "--tilt": `${tilt}deg` } as CSSProperties}
            // Its ring and its shape take the same time: whichever ends, it is over.
            onAnimationEnd={() => setRipples((all) => all.filter((other) => other.id !== id))}
          >
            <Shape className={styles.shape} />
          </span>
        );
      })}
    </span>
  );
}
