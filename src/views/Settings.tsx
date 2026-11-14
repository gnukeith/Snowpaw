import { useState, type ReactNode } from "react";
import { Avatar } from "../components/Avatar";
import { Button } from "../components/Button";
import { Dialog } from "../components/Dialog";
import { Input } from "../components/Input";
import { PictureField } from "../components/PictureField";
import { Segmented } from "../components/Segmented";
import { cleanName, initials, maxNameLength } from "../data/agents";
import { modes, type Theme } from "../theme/theme";
import styles from "./Settings.module.css";

interface Props {
  /** The name the user chose for themselves. Empty if they have not. */
  name: string;
  /** What is shown while they have not: this computer's name. */
  defaultName: string;
  onNameChange: (name: string) => void;
  /** The picture the user chose for themselves, if any. */
  picture: string | undefined;
  onPictureChange: (picture: string | undefined) => void;
  theme: Theme;
  onThemeChange: (theme: Theme) => void;
  /** Present in development builds only. */
  developer?: { load: () => void; remove: () => void };
  onClose: () => void;
}

interface Category {
  id: string;
  label: string;
  Panel: (props: Props) => ReactNode;
}

/* To add a category, add an entry here. */
const categories: Category[] = [
  { id: "general", label: "General", Panel: General },
  { id: "appearance", label: "Appearance", Panel: Appearance },
];
if (import.meta.env.DEV) categories.push({ id: "developer", label: "Developer", Panel: Developer });

export function Settings(props: Props) {
  const [current, setCurrent] = useState(categories[0]);

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

function General({ name, defaultName, onNameChange, picture, onPictureChange }: Props) {
  return (
    <>
      <Row label="Your picture" hint="Shown beside what you write in a conversation.">
        <PictureField hasPicture={picture !== undefined} onChange={onPictureChange}>
          <Avatar who={{ picture }} initials={initials(cleanName(name) || defaultName)} size="lg" />
        </PictureField>
      </Row>
      <Row label="Your name" hint="Left empty, it is this computer's name.">
        <div className={styles.field}>
          <Input
            value={name}
            placeholder={defaultName}
            maxLength={maxNameLength}
            aria-label="Your name"
            onChange={(event) => onNameChange(event.target.value)}
          />
        </div>
      </Row>
    </>
  );
}

function Appearance({ theme, onThemeChange }: Props) {
  return (
    <>
      <Row label="Theme" hint="System follows your desktop's light or dark setting.">
        <Segmented
          label="Theme"
          options={modes}
          value={theme.mode}
          onChange={(mode) => onThemeChange({ ...theme, mode })}
        />
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

function Developer({ developer }: Props) {
  return (
    <Row label="Sample agents" hint="Agents with made-up work, to see every part of the app filled in.">
      <div className={styles.buttons}>
        <Button onClick={developer?.load}>Load</Button>
        <Button onClick={developer?.remove}>Remove</Button>
      </div>
    </Row>
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
