import type { ReactNode } from "react";
import styles from "./Row.module.css";

interface Props {
  label: string;
  hint: string;
  /** The control that changes the setting. */
  children?: ReactNode;
}

/** One setting: what it is and what it does on one side, its control on the other. */
export function Row({ label, hint, children }: Props) {
  return (
    <div className={styles.row}>
      <div className={styles.text}>
        <h3 className={styles.label}>{label}</h3>
        <p className={styles.hint}>{hint}</p>
      </div>
      {children}
    </div>
  );
}
