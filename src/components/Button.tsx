import type { ComponentProps } from "react";
import styles from "./Button.module.css";

/** A native button's props, minus `className`: every button looks the same. */
interface Props extends Omit<ComponentProps<"button">, "className"> {
  /** The main action of a view. At most one per view. */
  primary?: boolean;
  /** An action that destroys something. */
  danger?: boolean;
}

export function Button({ primary, danger, type = "button", ...rest }: Props) {
  const look = primary ? styles.primary : danger ? styles.danger : styles.button;
  return <button {...rest} type={type} className={look} />;
}
