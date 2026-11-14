import { useEffect, useRef, useState, type Dispatch, type FormEvent, type SetStateAction } from "react";
import { Button } from "../components/Button";
import form from "../components/Form.module.css";
import { Input } from "../components/Input";
import { Row } from "../components/Row";
import { describeFailure, hostLabel, search, type Connection } from "../data/connections";
import { forgetKey, hasKey, saveKey, testSearch } from "../data/keyring";
import { ConnectionForm } from "./ConnectionForm";
import styles from "./Connections.module.css";

interface ModelsProps {
  connections: Connection[];
  /** Takes a change to make to the list as it is when the change lands, so
      an answer that arrives late cannot undo what happened meanwhile. */
  onChange: Dispatch<SetStateAction<Connection[]>>;
}

/** The model providers Snowpaw is connected to, and the form that adds one. */
export function Models({ connections, onChange }: ModelsProps) {
  // The id of the connection in the form, or null for the list. A new
  // connection gets its id when its form opens, so the form stays the same
  // one when the connection is kept under that id.
  const [open, setOpen] = useState<string | null>(null);
  // With nothing connected there is no list, only a form: this is its id,
  // made afresh after each removal so a removed connection's form is gone.
  const [first, setFirst] = useState(() => crypto.randomUUID());
  // Whether the list is shown because a form was just closed, so focus can
  // be put back in it.
  const [returned, setReturned] = useState(false);
  const another = useRef<HTMLButtonElement>(null);

  const id = open ?? (connections.length === 0 ? first : null);

  useEffect(() => {
    if (id === null && returned) another.current?.focus();
  }, [id, returned]);

  function close() {
    setOpen(null);
    setReturned(true);
  }

  if (id !== null) {
    return (
      <>
        {connections.length === 0 && (
          <p className={form.lead}>
            Agents think with a model. Connect a provider you have a key for, or a server of your own.
          </p>
        )}
        <ConnectionForm
          key={id}
          id={id}
          connection={connections.find((other) => other.id === id)}
          // Opened from the list, or put back after the last one was removed:
          // either way what had focus has gone.
          autoFocus={open !== null || returned}
          onSave={(saved) => {
            onChange((list) =>
              list.some((other) => other.id === saved.id)
                ? list.map((other) => (other.id === saved.id ? saved : other))
                : [...list, saved],
            );
            // The first connection's form stays open once the list is no
            // longer empty, so its model can still be chosen.
            setOpen(saved.id);
          }}
          onRemove={(removed) => {
            onChange((list) => list.filter((other) => other.id !== removed));
            setFirst(crypto.randomUUID());
            close();
          }}
          onClose={connections.length > 0 ? close : undefined}
        />
      </>
    );
  }

  return (
    <>
      <p className={form.lead}>The providers your agents can think with.</p>
      {connections.map((connection) => (
        <Row
          key={connection.id}
          label={connection.name}
          hint={`${connection.model || "No model chosen"} at ${hostLabel(connection.address)}`}
        >
          <Button aria-label={`Edit ${connection.name}`} onClick={() => setOpen(connection.id)}>
            Edit
          </Button>
        </Row>
      ))}
      <div className={styles.actions}>
        <Button ref={another} onClick={() => setOpen(crypto.randomUUID())}>
          Connect another
        </Button>
      </div>
    </>
  );
}

type Outcome =
  | { state: "idle" }
  | { state: "working" }
  | { state: "connected" }
  | { state: "failed"; why: string };

/** The key for web search. One provider for now, so there is no list. The
    key is handled as a model provider's is: read once, then let go. */
export function Search() {
  const keyBox = useRef<HTMLInputElement>(null);
  const [typed, setTyped] = useState(false);
  // Unknown until the keyring has answered.
  const [saved, setSaved] = useState<boolean>();
  const [outcome, setOutcome] = useState<Outcome>({ state: "idle" });
  // Goes up on every save or forget, so a late answer about whether a key
  // is saved cannot overwrite what it changed.
  const changes = useRef(0);
  // False once the panel has gone, so a save that lands afterwards does not
  // go on to spend a search.
  const shown = useRef(true);
  const working = outcome.state === "working";

  useEffect(() => {
    shown.current = true;
    const asked = changes.current;
    hasKey(search.id, search.address).then(
      (has) => shown.current && changes.current === asked && setSaved(has),
      // Not knowing is said, and Test and Forget stay available to try again.
      (failure) => shown.current && changes.current === asked && setOutcome({ state: "failed", why: describeFailure(failure) }),
    );
    return () => {
      shown.current = false;
    };
  }, []);

  async function connect(event: FormEvent) {
    event.preventDefault();
    if (working) return;
    // Read once and let go of at once, whether or not it works.
    const key = keyBox.current?.value.trim() ?? "";
    if (keyBox.current) keyBox.current.value = "";
    setTyped(false);
    setOutcome({ state: "working" });
    // From here this attempt's outcome is the one shown.
    changes.current += 1;
    let has = saved === true;
    try {
      if (key) {
        await saveKey(search.id, search.address, key);
        has = true;
        if (!shown.current) return;
        setSaved(true);
      }
      await testSearch(() => shown.current);
      if (shown.current) setOutcome({ state: "connected" });
    } catch (failure) {
      if (shown.current) setOutcome({ state: "failed", why: describeFailure(failure, has) });
    }
  }

  async function forget() {
    if (working) return;
    setOutcome({ state: "working" });
    try {
      changes.current += 1;
      await forgetKey(search.id);
      if (!shown.current) return;
      setSaved(false);
      setOutcome({ state: "idle" });
    } catch (failure) {
      if (shown.current) setOutcome({ state: "failed", why: describeFailure(failure) });
    }
  }

  return (
    <form onSubmit={connect}>
      <p className={form.lead}>
        With a search key, agents can look things up on the web. Without one they work from what they know and what
        you give them.
      </p>
      <Row label={search.name} hint="Make a key in Brave's API dashboard.">
        <div className={styles.field}>
          <Input
            ref={keyBox}
            type="password"
            aria-label={`${search.name} key`}
            placeholder={saved ? "Saved. Type to replace it." : "Paste your key"}
            disabled={working}
            onChange={(event) => {
              setTyped(event.target.value.trim() !== "");
              setOutcome({ state: "idle" });
            }}
          />
        </div>
      </Row>
      <div className={styles.actions}>
        <p className={form.status} role="status" data-state={outcome.state}>
          {outcome.state === "working" && "Working on it."}
          {outcome.state === "connected" && "Connected. A test search came back."}
          {outcome.state === "failed" && outcome.why}
        </p>
        {/* While it is not known whether a key is saved, both stay offered. */}
        {saved !== false && (
          <Button onClick={forget} disabled={working}>
            Forget the key
          </Button>
        )}
        <Button primary={!saved} type="submit" disabled={working || (!typed && saved === false)}>
          {saved !== false && !typed ? "Test" : "Connect"}
        </Button>
      </div>
      <p className={styles.note}>
        The key is kept in your desktop's keyring and sent only to Brave. A test uses one search from your allowance.
      </p>
    </form>
  );
}
