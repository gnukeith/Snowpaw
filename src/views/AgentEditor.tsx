import { useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { Avatar } from "../components/Avatar";
import { Button } from "../components/Button";
import { Dialog } from "../components/Dialog";
import { Input } from "../components/Input";
import { cleanName, maxNameLength, newAgent, type Agent } from "../data/agents";
import { toPicture } from "../data/picture";
import styles from "./AgentEditor.module.css";

interface Props {
  /** The agent to change, or nothing to make a new one. */
  agent?: Agent;
  onSave: (agent: Agent) => void;
  onDelete: (agent: Agent) => void;
  onClose: () => void;
}

export function AgentEditor({ agent, onSave, onDelete, onClose }: Props) {
  // A new agent is made once, so its preview keeps one hue while it is edited.
  const [draft, setDraft] = useState(() => agent ?? newAgent(""));
  const [error, setError] = useState<string | null>(null);
  // Deleting takes two presses: the first only asks.
  const [confirming, setConfirming] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  // Goes up with every change to the picture. A file takes a moment to turn
  // into a picture, and one that finishes after a later change is dropped.
  const change = useRef(0);
  // True while the latest file is being turned into a picture.
  const [working, setWorking] = useState(false);

  async function choose(event: ChangeEvent<HTMLInputElement>) {
    const chosen = event.target.files?.[0];
    // Cleared so that choosing the same file again still counts as a change.
    event.target.value = "";
    if (!chosen) return;
    const mine = ++change.current;
    setWorking(true);
    let picture: string | undefined;
    try {
      picture = await toPicture(chosen);
    } catch {
      // Reported below, if this is still the latest change.
    }
    if (mine !== change.current) return;
    setWorking(false);
    setError(picture ? null : "That file could not be used as a picture.");
    if (picture) setDraft((current) => ({ ...current, picture }));
  }

  function removePicture() {
    change.current += 1;
    setWorking(false);
    setDraft((current) => ({ ...current, picture: undefined }));
  }

  // Saving waits for a picture that is on its way, so it is not left behind.
  const name = cleanName(draft.name);
  const ready = name !== "" && !working;

  function save(event: FormEvent) {
    event.preventDefault();
    if (ready) onSave({ ...draft, name });
  }

  return (
    <Dialog title={agent ? "Edit agent" : "New agent"} onClose={onClose}>
      <form className={styles.form} onSubmit={save}>
        <div className={styles.picture}>
          <Avatar agent={draft} size="xl" />
          <div className={styles.pictureActions}>
            <Button onClick={() => file.current?.click()}>Choose picture</Button>
            {draft.picture && (
              <Button onClick={removePicture}>Remove</Button>
            )}
          </div>
          <input ref={file} type="file" accept="image/*" hidden onChange={choose} />
        </div>
        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
        <label className={styles.field}>
          <span className={styles.label}>Name</span>
          <Input
            data-focus-first
            required
            maxLength={maxNameLength}
            value={draft.name}
            placeholder="Launch Bot"
            onChange={(event) => setDraft({ ...draft, name: event.target.value })}
          />
        </label>
        <footer className={styles.actions}>
          {agent && (
            <Button danger onClick={() => (confirming ? onDelete(agent) : setConfirming(true))}>
              {confirming ? "Delete it and its conversation" : "Delete"}
            </Button>
          )}
          <span className={styles.spacer} />
          <Button primary type="submit" disabled={!ready}>
            {agent ? "Save" : "Create"}
          </Button>
        </footer>
      </form>
    </Dialog>
  );
}
