import { useEffect, useRef, useState, type FormEvent } from "react";
import { Button } from "../components/Button";
import { Input } from "../components/Input";
import { Select } from "../components/Select";
import { cleanName, maxNameLength } from "../data/agents";
import {
  cleanAddress,
  describeFailure,
  hostLabel,
  newConnection,
  presetOf,
  presets,
  sendsKeyInTheClear,
  type Connection,
} from "../data/connections";
import { forgetKey, hasKey, listModels, saveKey } from "../data/keyring";
import styles from "./ConnectionForm.module.css";

interface Props {
  /** The connection to change, or nothing to make a new one. */
  connection?: Connection;
  /** Called with a connection once its server has answered, and again with
      each thing chosen for it afterwards. Nothing else needs saving. */
  onSave: (connection: Connection) => void;
  onRemove: (connection: Connection) => void;
  /** Leaves the form. Absent when there is nowhere to go back to. */
  onClose?: () => void;
}

/** What the last press of Connect came to. */
type Outcome =
  | { state: "idle" }
  | { state: "working" }
  | { state: "connected"; models: string[] }
  | { state: "failed"; why: string };

/** How long the address is left alone before asking whether it has a key. */
const settleMs = 300;

/** Where a model provider is, its key, and the model to use. The key goes
    straight to the keyring: this form can replace it but never shows it. A
    connection is kept from the moment its server answers, like every other
    setting, so there is no Save to forget. */
export function ConnectionForm({ connection, onSave, onRemove, onClose }: Props) {
  const [draft, setDraft] = useState(() => connection ?? newConnection());
  const [key, setKey] = useState("");
  // Whether the keyring holds a key for this connection at this address.
  const [keySaved, setKeySaved] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>({ state: "idle" });
  // Removing takes two presses: the first only asks.
  const [confirming, setConfirming] = useState(false);
  // The address the connection is kept with: the last one that answered.
  const [kept, setKept] = useState(connection?.address);
  // A key saved for a connection that never answered must not stay behind.
  const orphan = useRef(false);

  const preset = presetOf(draft.preset);
  const address = cleanAddress(draft.address);
  const working = outcome.state === "working";
  const models = outcome.state === "connected" ? outcome.models : [];

  useEffect(() => {
    // A key is saved for one address, so a new address is asked about afresh.
    setKeySaved(false);
    if (!address) return;
    let current = true;
    const timer = setTimeout(() => {
      hasKey(draft.id, address).then(
        (saved) => current && setKeySaved(saved),
        () => {},
      );
    }, settleMs);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [draft.id, address]);

  useEffect(
    () => () => {
      if (orphan.current) forgetKey(draft.id).catch(() => {});
    },
    [draft.id],
  );

  /** The draft as it is kept: tidied, and at the address that answered. */
  function keep(next: Connection, at: string) {
    onSave({ ...next, name: cleanName(next.name) || presetOf(next.preset).name, address: at, model: next.model.trim() });
  }

  /** A change to something that needs no server to check it. */
  function change(part: Partial<Connection>) {
    const next = { ...draft, ...part };
    setDraft(next);
    if (kept) keep(next, kept);
  }

  function choose(id: string) {
    const next = presetOf(id);
    setDraft({ ...draft, preset: next.id, address: next.address, name: "" });
    setOutcome({ state: "idle" });
  }

  async function connect(event: FormEvent) {
    event.preventDefault();
    if (!address || working) return;
    setOutcome({ state: "working" });
    let saved = keySaved;
    try {
      if (key) {
        await saveKey(draft.id, address, key);
        saved = true;
        orphan.current = !kept;
        setKey("");
        setKeySaved(true);
      }
      const found = await listModels(draft.id, address, preset.proof);
      const next = { ...draft, address, model: found.includes(draft.model) ? draft.model : (found[0] ?? "") };
      setDraft(next);
      setKept(address);
      orphan.current = false;
      keep(next, address);
      setOutcome({ state: "connected", models: found });
    } catch (failure) {
      setOutcome({ state: "failed", why: describeFailure(failure, saved) });
    }
  }

  function remove() {
    if (!confirming) return setConfirming(true);
    forgetKey(draft.id).catch(() => {});
    onRemove(draft);
  }

  return (
    <form className={styles.form} onSubmit={connect}>
      <label className={styles.field}>
        <span className={styles.label}>Provider</span>
        <Select data-focus-first value={draft.preset} disabled={working} onChange={(event) => choose(event.target.value)}>
          {presets.map((option) => (
            <option key={option.id} value={option.id}>
              {option.name}
            </option>
          ))}
        </Select>
      </label>
      {preset.key === "optional" && (
        <label className={styles.field}>
          <span className={styles.label}>Address</span>
          <Input
            required
            value={draft.address}
            placeholder="http://localhost:8000/v1"
            disabled={working}
            onChange={(event) => {
              setDraft({ ...draft, address: event.target.value });
              setOutcome({ state: "idle" });
            }}
          />
        </label>
      )}
      <div className={styles.field}>
        <label className={styles.label} htmlFor={`${draft.id}-key`}>
          Key
        </label>
        <div className={styles.line}>
          <Input
            id={`${draft.id}-key`}
            type="password"
            value={key}
            placeholder={
              keySaved ? "Saved. Type to replace it." : preset.key === "needed" ? "Paste your key" : "Leave empty if it has none"
            }
            disabled={working}
            onChange={(event) => setKey(event.target.value)}
          />
          <Button primary={!kept} type="submit" disabled={!address || working}>
            {working ? "Connecting" : "Connect"}
          </Button>
        </div>
        <p className={styles.status} role="status" data-state={outcome.state}>
          {outcome.state === "connected"
            ? models.length === 1
              ? "Connected. It has 1 model."
              : `Connected. It has ${models.length} models.`
            : outcome.state === "failed"
              ? outcome.why
              : sendsKeyInTheClear(address) && (key || keySaved)
                ? "This address is not encrypted, so the key would cross your network in the clear."
                : `Kept in your desktop's keyring and sent only to ${address ? hostLabel(address) : "this address"}. Snowpaw never shows it again.`}
        </p>
      </div>
      {kept && (
        <>
          <label className={styles.field}>
            <span className={styles.label}>Model</span>
            {models.length > 0 ? (
              <Select value={draft.model} onChange={(event) => change({ model: event.target.value })}>
                {models.map((model) => (
                  <option key={model} value={model}>
                    {model}
                  </option>
                ))}
              </Select>
            ) : (
              <Input
                value={draft.model}
                placeholder="Connect to choose from a list, or type its name"
                onChange={(event) => change({ model: event.target.value })}
              />
            )}
          </label>
          <label className={styles.field}>
            <span className={styles.label}>Name</span>
            <Input
              value={draft.name}
              maxLength={maxNameLength}
              placeholder={preset.name}
              onChange={(event) => change({ name: event.target.value })}
            />
          </label>
        </>
      )}
      {(kept || onClose) && (
        <footer className={styles.actions}>
          {kept && (
            <Button danger onClick={remove}>
              {confirming ? "Remove it and forget its key" : "Remove"}
            </Button>
          )}
          <span className={styles.spacer} />
          {onClose && <Button onClick={onClose}>{kept ? "Done" : "Cancel"}</Button>}
        </footer>
      )}
    </form>
  );
}
