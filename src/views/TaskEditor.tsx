import { useState, type FormEvent } from "react";
import { Button } from "../components/Button";
import { Dialog } from "../components/Dialog";
import { Input } from "../components/Input";
import { Segmented } from "../components/Segmented";
import type { TaskDraft } from "../data/conversation";
import styles from "./TaskEditor.module.css";

interface Props {
  /** The task as the agent proposed it. */
  task: TaskDraft;
  onSchedule: (task: TaskDraft) => void;
  onClose: () => void;
}

const kinds = ["task", "reminder"] as const;

/** A moment as a date-and-time field writes it: local time, to the minute. */
function toField(at: number): string {
  const local = new Date(at - new Date(at).getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

/** Changing a task an agent proposed, before agreeing to it. */
export function TaskEditor({ task, onSchedule, onClose }: Props) {
  const [draft, setDraft] = useState(task);
  // Kept as the field holds it, because half-typed text is not a moment yet.
  const [when, setWhen] = useState(() => toField(task.at));

  const at = new Date(when).getTime();
  const title = draft.title.trim();
  const ready = title !== "" && Number.isFinite(at);

  function schedule(event: FormEvent) {
    event.preventDefault();
    if (ready) onSchedule({ ...draft, title, at, repeats: draft.repeats?.trim() || undefined });
  }

  return (
    <Dialog title="Edit before scheduling" onClose={onClose}>
      <form className={styles.form} onSubmit={schedule}>
        <label className={styles.field}>
          <span className={styles.label}>What</span>
          <Input
            data-focus-first
            required
            value={draft.title}
            onChange={(event) => setDraft({ ...draft, title: event.target.value })}
          />
        </label>
        <label className={styles.field}>
          <span className={styles.label}>When</span>
          <Input
            type="datetime-local"
            required
            value={when}
            onChange={(event) => setWhen(event.target.value)}
          />
        </label>
        <label className={styles.field}>
          <span className={styles.label}>How often</span>
          <Input
            value={draft.repeats ?? ""}
            placeholder="Once"
            onChange={(event) => setDraft({ ...draft, repeats: event.target.value })}
          />
        </label>
        <footer className={styles.actions}>
          <Segmented
            label="Kind"
            options={kinds}
            value={draft.kind}
            onChange={(kind) => setDraft({ ...draft, kind })}
          />
          <span className={styles.spacer} />
          <Button primary type="submit" disabled={!ready}>
            Schedule it
          </Button>
        </footer>
      </form>
    </Dialog>
  );
}
