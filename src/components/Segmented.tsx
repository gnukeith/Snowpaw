import { useId } from "react";
import styles from "./Segmented.module.css";

interface Props<Option extends string> {
  /** What is being chosen, for assistive technology. */
  label: string;
  /** Shown with a capital letter. */
  options: readonly Option[];
  value: Option;
  onChange: (value: Option) => void;
  /** Takes all the width it is given and shares it between the options. */
  fill?: boolean;
}

/** A choice of one from a few, drawn as one pill. The options are real radio
    inputs, so the arrow keys move between them. */
export function Segmented<Option extends string>(props: Props<Option>) {
  const { label, options, value, onChange, fill } = props;
  const name = useId();
  return (
    <div className={fill ? styles.fill : styles.segmented} role="radiogroup" aria-label={label}>
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
