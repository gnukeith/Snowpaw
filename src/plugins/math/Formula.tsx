import katex from "katex";
import { useContext, useEffect, useLayoutEffect, useRef, useState } from "react";
import { MessageBudget } from "../budget";
import type { BlockProps } from "../types";
import styles from "./Formula.module.css";
import { checkSizes, definesCommands, largest, longestFormula } from "./size.ts";

/* The formula is written by an agent that may have read anything, so KaTeX
   is held to its safe settings: no links, images or raw HTML (`trust`), and
   limits on how far a macro may expand and how large anything may be made. */
const limits = { trust: false, maxExpand: 1000, maxSize: largest, throwOnError: true, strict: "ignore" } as const;

/** A formula, drawn as MathML: the browser lays it out with the desktop's
    math font. KaTeX's own layout needs inline styles, which the app's
    security policy does not let a message carry. */
/** The most elements one formula may build. */
const mostElements = 3000;


export default function Formula({ source, inline }: BlockProps) {
  const place = useRef<HTMLSpanElement>(null);
  const [failure, setFailure] = useState<Error>();
  const budget = useContext(MessageBudget);
  // What this formula's claim on its message's budget is filed under.
  const owner = useRef({}).current;

  useEffect(() => () => budget?.release(owner), [budget, owner]);

  useLayoutEffect(() => {
    if (!place.current) return;
    try {
      if (source.length > longestFormula) throw new Error("This formula is too long to draw.");
      if (definesCommands.test(source)) throw new Error("This formula defines commands of its own, which are not drawn.");
      if (budget && !budget.mayWork()) throw new Error("This message has more mathematics in it than it can show.");
      // Built away from the page and checked before any of it is shown.
      // KaTeX makes the elements itself, so no HTML text is ever parsed.
      const built = document.createElement("span");
      katex.render(source, built, { ...limits, output: "mathml", displayMode: !inline });
      const elements = built.querySelectorAll("*").length;
      budget?.worked(elements);
      checkSizes(built);
      if (elements > mostElements || (budget && !budget.claim(owner, elements))) {
        throw new Error("This message has more mathematics in it than it can show.");
      }
      place.current.replaceChildren(...built.childNodes);
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
