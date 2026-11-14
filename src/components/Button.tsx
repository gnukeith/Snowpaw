import type { ComponentProps } from "react";
import styles from "./Button.module.css";

/** A native button's props, minus `className`: every button looks the same. */
interface Props extends Omit<ComponentProps<"button">, "className"> {
  /** The main action of a view. At most one per view. */
  primary?: boolean;
}

export function Button({ primary, ...rest }: Props) {
  return <button {...rest} className={primary ? styles.primary : styles.button} />;
}
