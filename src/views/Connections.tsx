import { useEffect, useState } from "react";
import { Button } from "../components/Button";
import { Input } from "../components/Input";
import { Row } from "../components/Row";
import { describeFailure, hostLabel, search, type Connection } from "../data/connections";
import { forgetKey, hasKey, saveKey, testSearch } from "../data/keyring";
import { ConnectionForm } from "./ConnectionForm";
import styles from "./Connections.module.css";

interface ModelsProps {
  connections: Connection[];
  onChange: (connections: Connection[]) => void;
}

/** The model providers Snowpaw is connected to, and the form that adds one. */
export function Models({ connections, onChange }: ModelsProps) {
  // The id of the connection in the form, "new" for one being added, or null
  // for the list. With nothing connected there is no list to show, only the form.
  const [editing, setEditing] = useState<string | null>(null);
  const open = editing ?? (connections.length === 0 ? "new" : null);

  if (open) {
    return (
      <>
        {connections.length === 0 && (
          <p className={styles.lead}>
            Agents think with a model. Connect a provider you have a key for, or a server of your own.
          </p>
        )}
        <ConnectionForm
          // A new form for each connection, so one's half-typed key never
          // carries over to another.
          key={open}
          connection={connections.find((other) => other.id === open)}
          onSave={(saved) => {
            const known = connections.some((other) => other.id === saved.id);
            onChange(known ? connections.map((other) => (other.id === saved.id ? saved : other)) : [...connections, saved]);
            // The form stays as it is: what was "new" is now this connection.
            setEditing((current) => current ?? "new");
          }}
          onRemove={(removed) => {
            onChange(connections.filter((other) => other.id !== removed.id));
            setEditing(null);
          }}
          onClose={connections.length > 0 ? () => setEditing(null) : undefined}
        />
      </>
    );
  }

  return (
    <>
      <p className={styles.lead}>The providers your agents can think with.</p>
      {connections.map((connection) => (
        <Row
          key={connection.id}
          label={connection.name}
          hint={`${connection.model || "No model chosen"} at ${hostLabel(connection.address)}`}
        >
          <Button onClick={() => setEditing(connection.id)}>Edit</Button>
        </Row>
      ))}
      <div className={styles.actions}>
        <Button onClick={() => setEditing("new")}>Connect another</Button>
      </div>
    </>
  );
}

type Outcome =
  | { state: "idle" }
  | { state: "working" }
  | { state: "connected" }
  | { state: "failed"; why: string };

/** The key for web search. One provider for now, so there is no list. */
export function Search() {
  const [key, setKey] = useState("");
  const [saved, setSaved] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>({ state: "idle" });
  const working = outcome.state === "working";

  useEffect(() => {
    let current = true;
    hasKey(search.id, search.address).then(
      (has) => current && setSaved(has),
      () => {},
    );
    return () => {
      current = false;
    };
  }, []);

  async function connect() {
    setOutcome({ state: "working" });
    let has = saved;
    try {
      if (key) {
        await saveKey(search.id, search.address, key);
        has = true;
        setKey("");
        setSaved(true);
      }
      await testSearch();
      setOutcome({ state: "connected" });
    } catch (failure) {
      setOutcome({ state: "failed", why: describeFailure(failure, has) });
    }
  }

  async function forget() {
    setOutcome({ state: "idle" });
    try {
      await forgetKey(search.id);
      setSaved(false);
    } catch (failure) {
      setOutcome({ state: "failed", why: describeFailure(failure) });
    }
  }

  return (
    <>
      <p className={styles.lead}>
        With a search key, agents can look things up on the web. Without one they work from what they know and what
        you give them.
      </p>
      <Row label={search.name} hint="Make a key in Brave's API dashboard.">
        <div className={styles.field}>
          <Input
            type="password"
            value={key}
            aria-label={`${search.name} key`}
            placeholder={saved ? "Saved. Type to replace it." : "Paste your key"}
            disabled={working}
            onChange={(event) => setKey(event.target.value)}
          />
        </div>
      </Row>
      <div className={styles.actions}>
        <p className={styles.status} role="status" data-state={outcome.state}>
          {outcome.state === "connected" && "Connected. A test search came back."}
          {outcome.state === "failed" && outcome.why}
        </p>
        {saved && (
          <Button onClick={forget} disabled={working}>
            Forget the key
          </Button>
        )}
        <Button primary={!saved} onClick={connect} disabled={working || (!key && !saved)}>
          {working ? "Connecting" : saved && !key ? "Test" : "Connect"}
        </Button>
      </div>
      <p className={styles.note}>
        The key is kept in your desktop's keyring and sent only to Brave. A test uses one search from your allowance.
      </p>
    </>
  );
}
