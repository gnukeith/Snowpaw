import type { ComponentProps } from "react";
import styles from "./Button.module.css";
import { Icon, type IconName } from "./Icon";

interface Props extends Omit<ComponentProps<"button">, "className" | "children" | "aria-label"> {
  icon: IconName;
  /** What the button does. Read out, and shown on hover, in place of visible text. */
  label: string;
  /** The main action of its group, drawn in the accent colour. */
  primary?: boolean;
  /** Stays in the background until pointed at: no fill of its own. */
  quiet?: boolean;
}

/** A round button that shows only an icon. */
export function IconButton({ icon, label, primary, quiet, type = "button", ...rest }: Props) {
  return (
    <button
      {...rest}
      type={type}
      className={primary ? styles.iconPrimary : quiet ? styles.iconQuiet : styles.icon}
      aria-label={label}
      title={label}
    >
      <Icon name={icon} />
    </button>
  );
}
