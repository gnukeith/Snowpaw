import { useId } from "react";
import styles from "./Segmented.module.css";

interface Props<Option extends string> {
  /** What is being chosen, for assistive technology. */
  label: string;
  /** Shown with a capital letter. */
  options: readonly Option[];
  value: Option;
  onChange: (value: Option) => void;
}

/** A choice of one from a few, drawn as one pill. The options are real radio
    inputs, so the arrow keys move between them. */
export function Segmented<Option extends string>({ label, options, value, onChange }: Props<Option>) {
  const name = useId();
  return (
    <div className={styles.segmented} role="radiogroup" aria-label={label}>
      {options.map((option) => (
        <label key={option} className={styles.segment}>
          <input
            type="radio"
            name={name}
            checked={option === value}
            onChange={() => onChange(option)}
          />
          {option}
        </label>
      ))}
    </div>
  );
}
