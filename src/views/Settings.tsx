import { useState, type ReactNode } from "react";
import { Dialog } from "../components/Dialog";
import { modes, type Theme } from "../theme/theme";
import styles from "./Settings.module.css";

interface Props {
  theme: Theme;
  onThemeChange: (theme: Theme) => void;
  onClose: () => void;
}

/* To add a category, add an entry here. */
const categories = [{ id: "appearance", label: "Appearance", Panel: Appearance }] as const;

export function Settings(props: Props) {
  const [current, setCurrent] = useState<(typeof categories)[number]>(categories[0]);

  return (
    <Dialog title="Settings" wide onClose={props.onClose}>
      <div className={styles.settings}>
        <nav className={styles.categories} aria-label="Settings categories">
          {categories.map((category) => (
            <button
              key={category.id}
              className={styles.category}
              aria-current={category === current ? "page" : undefined}
              onClick={() => setCurrent(category)}
            >
              {category.label}
            </button>
          ))}
        </nav>
        <section className={styles.content}>
          <h2 className={styles.heading}>{current.label}</h2>
          <current.Panel {...props} />
        </section>
      </div>
    </Dialog>
  );
}

function Appearance({ theme, onThemeChange }: Props) {
  return (
    <>
      <Row label="Theme" hint="System follows your desktop's light or dark setting.">
        <div className={styles.segmented} role="radiogroup" aria-label="Theme">
          {modes.map((mode) => (
            <label key={mode} className={styles.segment}>
              <input
                type="radio"
                name="theme-mode"
                checked={theme.mode === mode}
                onChange={() => onThemeChange({ ...theme, mode })}
              />
              {mode}
            </label>
          ))}
        </div>
      </Row>
      <Row label="Accent" hint="One hue tints the whole app.">
        <input
          className={styles.hue}
          type="range"
          min={0}
          max={360}
          value={theme.hue}
          aria-label="Accent hue"
          onChange={(event) => onThemeChange({ ...theme, hue: event.target.valueAsNumber })}
        />
      </Row>
    </>
  );
}

function Row({ label, hint, children }: { label: string; hint: string; children: ReactNode }) {
  return (
    <div className={styles.row}>
      <div>
        <h3 className={styles.label}>{label}</h3>
        <p className={styles.hint}>{hint}</p>
      </div>
      {children}
    </div>
  );
}
