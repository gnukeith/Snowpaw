import type { ButtonHTMLAttributes } from "react";
import styles from "./Button.module.css";

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** The main action of a view. At most one per view. */
  primary?: boolean;
}

export function Button({ primary, ...rest }: Props) {
  return <button {...rest} className={primary ? styles.primary : styles.button} />;
}
