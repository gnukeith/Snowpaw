import type { ComponentProps } from "react";
import { Icon } from "./Icon";
import styles from "./Select.module.css";

/** A choice of one from a list too long to lay out as a `Segmented`. */
export function Select(props: Omit<ComponentProps<"select">, "className">) {
  return (
    <span className={styles.wrap}>
      <select {...props} className={styles.select} />
      <Icon name="chevron" />
    </span>
  );
}
