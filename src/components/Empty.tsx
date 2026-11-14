import type { ReactNode } from "react";
import styles from "./Empty.module.css";

interface Props {
  title: string;
  hint: string;
  /** What to do about it, if anything. */
  children?: ReactNode;
}

/** What a view shows while it has nothing to show. */
export function Empty({ title, hint, children }: Props) {
  return (
    <div className={styles.empty}>
      <p className={styles.title}>{title}</p>
      <p className={styles.hint}>{hint}</p>
      {children}
    </div>
  );
}
