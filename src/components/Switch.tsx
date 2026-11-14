import styles from "./Switch.module.css";

interface Props {
  /** What it switches, for assistive technology. */
  label: string;
  on: boolean;
  onChange: (on: boolean) => void;
}

/** On or off, at once: there is nothing to save afterwards. */
export function Switch({ label, on, onChange }: Props) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      className={styles.switch}
      onClick={() => onChange(!on)}
    />
  );
}
