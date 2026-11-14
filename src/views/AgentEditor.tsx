import { useState, type FormEvent } from "react";
import { Avatar } from "../components/Avatar";
import { Button } from "../components/Button";
import { Dialog } from "../components/Dialog";
import { Input } from "../components/Input";
import { PictureField } from "../components/PictureField";
import { cleanName, maxNameLength, newAgent, type Agent } from "../data/agents";
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
  // Deleting takes two presses: the first only asks.
  const [confirming, setConfirming] = useState(false);
  // True while a chosen file is being turned into a picture.
  const [working, setWorking] = useState(false);

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
        <PictureField
          hasPicture={draft.picture !== undefined}
          onChange={(picture) => setDraft((current) => ({ ...current, picture }))}
          onWorking={setWorking}
        >
          <Avatar who={draft} size="xl" />
        </PictureField>
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
