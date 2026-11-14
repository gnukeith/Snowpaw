import type { ComponentProps } from "react";
import styles from "./Input.module.css";

/** A single line of text. Every text box in the app is this one. */
export function Input(props: Omit<ComponentProps<"input">, "className">) {
  return <input type="text" autoComplete="off" spellCheck={false} {...props} className={styles.input} />;
}
