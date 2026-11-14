import { useEffect, useRef, useState, type FormEvent } from "react";
import { Button } from "../components/Button";
import form from "../components/Form.module.css";
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
  /** The connection's id. A new one has its id before it is kept. */
  id: string;
  /** The connection as it is kept, or nothing while it is new. */
  connection?: Connection;
  /** Called with a connection once its server has answered, and again with
      each change to its name or model afterwards. Nothing else needs saving. */
  onSave: (connection: Connection) => void;
  /** Called once a kept connection's key has been forgotten. */
  onRemove: (id: string) => void;
  /** Leaves the form. Absent when there is nowhere to go back to. */
  onClose?: () => void;
  /** Takes focus when shown, for when it replaces what had focus. */
  autoFocus?: boolean;
}

/** What the last press of Connect or Remove came to. */
type Outcome =
  | { state: "idle" }
  | { state: "working" }
  | { state: "connected"; models: string[] }
  | { state: "failed"; why: string };

/** How long the address is left alone before asking whether it has a key. */
const settleMs = 300;

/**
 * Where a model provider is, its key, and the model to use.
 *
 * The key is typed into a box the page does not keep: it is read once, when
 * Connect is pressed, handed to the keyring, and the box is emptied at once,
 * whatever happens next. A key is bound to the address it is saved for, so
 * once a connection is kept its provider and address are fixed; a different
 * server is a different connection.
 */
export function ConnectionForm({ id, connection, onSave, onRemove, onClose, autoFocus }: Props) {
  const [draft, setDraft] = useState(() => connection ?? newConnection(presets[0], id));
  const keyBox = useRef<HTMLInputElement>(null);
  // Whether the key box has anything in it. The text itself is never held.
  const [typed, setTyped] = useState(false);
  // Whether the keyring holds a key for this connection at this address:
  // unknown until it has answered.
  const [keySaved, setKeySaved] = useState<boolean>();
  const [outcome, setOutcome] = useState<Outcome>({ state: "idle" });
  // Removing takes two presses: the first only asks.
  const [confirming, setConfirming] = useState(false);

  // Goes up on every save or forget, so an answer about whether a key is
  // saved, asked for before one, cannot overwrite what it changed.
  const changes = useRef(0);
  // False once the form has gone, so nothing late acts on its behalf.
  const shown = useRef(true);
  // True while a key is saved for a connection that is not kept: it is
  // forgotten if the form goes before the connection is kept.
  const loose = useRef(false);

  const kept = connection !== undefined;
  const preset = presetOf(draft.preset);
  const address = kept ? connection.address : cleanAddress(draft.address);
  const working = outcome.state === "working";
  const models = outcome.state === "connected" ? outcome.models : [];
  // Shown before anything is sent, and while it is not yet known whether a
  // key is saved: a warning that comes after the key has gone is too late.
  const inTheClear = sendsKeyInTheClear(address) && (typed || keySaved !== false);
  // A provider that wants a key is not tried without one. Most would turn the
  // attempt down, but one whose list of models is public would look connected.
  const needsKey = preset.key === "needed" && !typed && keySaved === false;

  useEffect(() => {
    shown.current = true;
    return () => {
      shown.current = false;
      letGo();
    };
    // Runs when the form comes and goes, and on nothing else.
  }, []);

  useEffect(() => {
    setKeySaved(undefined);
    if (!address) return;
    const asked = changes.current;
    let current = true;
    const timer = setTimeout(() => {
      hasKey(id, address).then(
        (saved) => current && changes.current === asked && setKeySaved(saved),
        // Left unknown, which keeps Connect and any warning offered, and said.
        (failure) => current && changes.current === asked && setOutcome({ state: "failed", why: describeFailure(failure) }),
      );
    }, settleMs);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [id, address]);

  /** Forgets the key of a connection that was never kept. */
  function letGo() {
    if (!loose.current) return;
    loose.current = false;
    changes.current += 1;
    // Nothing is left to report a failure to. The key then stays in the
    // keyring under an id that nothing uses.
    forgetKey(id).catch(() => {});
  }

  /** Empties the key box. */
  function emptyKey() {
    if (keyBox.current) keyBox.current.value = "";
    setTyped(false);
  }

  function choose(presetId: string) {
    const next = presetOf(presetId);
    setDraft({ ...draft, preset: next.id, address: next.address, name: "" });
    // A key typed for one provider is not sent to another.
    emptyKey();
    setOutcome({ state: "idle" });
  }

  /** The name or model of a kept connection, which needs no server to check
      it. Only those two are copied onto what is kept. */
  function change(part: Pick<Partial<Connection>, "name" | "model">) {
    const next = { ...draft, ...part };
    setDraft(next);
    if (connection) onSave(tidy({ ...connection, name: next.name, model: next.model }));
  }

  function tidy(next: Connection): Connection {
    return { ...next, name: cleanName(next.name) || presetOf(next.preset).name, model: next.model.trim() };
  }

  async function connect(event: FormEvent) {
    event.preventDefault();
    if (!address || working) return;
    // Read once and let go of at once, whether or not it works.
    const key = keyBox.current?.value.trim() ?? "";
    emptyKey();
    setOutcome({ state: "working" });
    let saved = keySaved === true;
    try {
      if (key) {
        changes.current += 1;
        await saveKey(id, address, key);
        saved = true;
        if (!kept) loose.current = true;
        if (!shown.current) return letGo();
        setKeySaved(true);
      }
      const found = await listModels(id, address, preset.proof);
      // Gone while it was asking: the clean-up has already run.
      if (!shown.current) return;
      const model = found.includes(draft.model) ? draft.model : (found[0] ?? "");
      setDraft({ ...draft, address, model });
      onSave(tidy({ ...(connection ?? draft), address, model }));
      loose.current = false;
      setOutcome({ state: "connected", models: found });
    } catch (failure) {
      if (shown.current) setOutcome({ state: "failed", why: describeFailure(failure, saved) });
    }
  }

  async function remove() {
    if (!confirming) return setConfirming(true);
    setOutcome({ state: "working" });
    try {
      changes.current += 1;
      await forgetKey(id);
      onRemove(id);
    } catch (failure) {
      // The connection stays, so its key can still be forgotten later.
      if (shown.current) setOutcome({ state: "failed", why: describeFailure(failure) });
    }
  }

  return (
    <form className={form.form} onSubmit={connect}>
      {kept ? (
        <p className={styles.where}>
          {preset.name} at {hostLabel(address)}
        </p>
      ) : (
        <>
          <label className={form.field}>
            <span className={form.label}>Provider</span>
            <Select
              data-focus-first
              autoFocus={autoFocus}
              value={draft.preset}
              disabled={working}
              onChange={(event) => choose(event.target.value)}
            >
              {presets.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name}
                </option>
              ))}
            </Select>
          </label>
          {preset.key === "optional" && (
            <label className={form.field}>
              <span className={form.label}>Address</span>
              <Input
                required
                value={draft.address}
                placeholder="http://localhost:8000/v1"
                disabled={working}
                onChange={(event) => {
                  setDraft({ ...draft, address: event.target.value });
                  // A key typed for one address is not sent to another.
                  emptyKey();
                  setOutcome({ state: "idle" });
                }}
              />
            </label>
          )}
        </>
      )}
      <div className={form.field}>
        <label className={form.label} htmlFor={`${id}-key`}>
          Key
        </label>
        <div className={styles.line}>
          <Input
            ref={keyBox}
            id={`${id}-key`}
            type="password"
            autoFocus={kept && autoFocus}
            placeholder={
              keySaved ? "Saved. Type to replace it." : preset.key === "needed" ? "Paste your key" : "Leave empty if it has none"
            }
            disabled={working}
            onChange={(event) => {
              setTyped(event.target.value !== "");
              setOutcome({ state: "idle" });
            }}
          />
          <Button primary={!kept} type="submit" disabled={!address || working || needsKey}>
            Connect
          </Button>
        </div>
        <p className={styles.note} data-warning={inTheClear || undefined}>
          {inTheClear
            ? "This address is not encrypted, so a key would cross your network in the clear."
            : `Kept in your desktop's keyring and sent only to ${address ? hostLabel(address) : "this address"}. Snowpaw never shows it again.`}
        </p>
        <p className={styles.status} role="status" data-state={outcome.state}>
          {outcome.state === "working" && "Working on it."}
          {outcome.state === "connected" &&
            (models.length === 1 ? "Connected. It has 1 model." : `Connected. It has ${models.length} models.`)}
          {outcome.state === "failed" && outcome.why}
        </p>
      </div>
      {kept && (
        <>
          <label className={form.field}>
            <span className={form.label}>Model</span>
            {models.length > 0 ? (
              <Select value={draft.model} disabled={working} onChange={(event) => change({ model: event.target.value })}>
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
                disabled={working}
                onChange={(event) => change({ model: event.target.value })}
              />
            )}
          </label>
          <label className={form.field}>
            <span className={form.label}>Name</span>
            <Input
              value={draft.name}
              maxLength={maxNameLength}
              placeholder={preset.name}
              disabled={working}
              onChange={(event) => change({ name: event.target.value })}
            />
          </label>
        </>
      )}
      {(kept || onClose) && (
        <footer className={form.actions}>
          {kept && (
            <Button danger onClick={remove} disabled={working}>
              {confirming ? "Remove it and forget its key" : "Remove"}
            </Button>
          )}
          <span className={form.spacer} />
          {onClose && (
            <Button onClick={onClose} disabled={working}>
              {kept ? "Done" : "Cancel"}
            </Button>
          )}
        </footer>
      )}
    </form>
  );
}
