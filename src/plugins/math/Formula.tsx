import katex from "katex";
import { useLayoutEffect, useRef, useState } from "react";
import type { BlockProps } from "../types";
import styles from "./Formula.module.css";

/* The formula is written by an agent that may have read anything, so KaTeX
   is held to its safe settings: no links, images or raw HTML (`trust`), and
   limits on how far a macro may expand and how large anything may be made. */
const limits = { trust: false, maxExpand: 1000, maxSize: 20, throwOnError: true, strict: "ignore" } as const;

/** A formula, drawn as MathML: the browser lays it out with the desktop's
    math font. KaTeX's own layout needs inline styles, which the app's
    security policy does not let a message carry. */
export default function Formula({ source, inline }: BlockProps) {
  const place = useRef<HTMLSpanElement>(null);
  const [failure, setFailure] = useState<Error>();

  useLayoutEffect(() => {
    if (!place.current) return;
    try {
      // KaTeX builds the elements itself, so no HTML text is ever parsed.
      katex.render(source, place.current, { ...limits, output: "mathml", displayMode: !inline });
      setFailure(undefined);
    } catch (error) {
      setFailure(new Error(reason(error)));
    }
  }, [source, inline]);

  // Thrown while drawing, where the conversation catches it and shows the
  // formula as it was written.
  if (failure) throw failure;
  return <span ref={place} className={inline ? styles.inline : styles.display} />;
}

/** KaTeX's own message without its prefix, which names the library. */
function reason(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  return message.replace(/^KaTeX parse error: /, "").trim() || "This formula could not be read.";
}
