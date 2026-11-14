import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "../components/Button";
import { Dialog } from "../components/Dialog";
import { Row } from "../components/Row";
import { hostLabel } from "../data/connections";
import { Models, Search } from "./Connections";
import {
  Appearance,
  Profile,
  type AppearanceProps,
  type ConnectionsProps,
  type ProfileProps,
} from "./Settings";
import form from "../components/Form.module.css";
import settings from "./Settings.module.css";
import styles from "./Setup.module.css";

interface Props extends ProfileProps, AppearanceProps, ConnectionsProps {
  /** Called when the steps are finished or skipped. `makeAgent` is true when
      the user asked to go on to making their first agent. */
  onDone: (makeAgent: boolean) => void;
}

interface Step {
  id: string;
  /** In the list of steps. */
  label: string;
  /** Above the step itself. */
  heading: string;
  Panel: (props: Props) => ReactNode;
}

/* To add a step, add an entry here. Every step can be skipped: what it sets
   is in Settings too. */
const steps: Step[] = [
  { id: "you", label: "You", heading: "Who you are to your agents", Panel: Profile },
  { id: "look", label: "Look", heading: "How Snowpaw looks", Panel: Appearance },
  {
    id: "model",
    label: "Model",
    heading: "A model to think with",
    Panel: ({ connections, onConnectionsChange }) => <Models connections={connections} onChange={onConnectionsChange} />,
  },
  { id: "search", label: "Search", heading: "Web search", Panel: Search },
  { id: "ready", label: "Ready", heading: "Ready", Panel: Ready },
];

/** The steps shown the first time Snowpaw opens: who you are, how it looks,
    and what it can connect to. Laid out like Settings, which holds the same
    things afterwards. */
export function Setup(props: Props) {
  const [index, setIndex] = useState(0);
  const step = steps[index];
  const last = index === steps.length - 1;
  const heading = useRef<HTMLHeadingElement>(null);
  // Whether a step has been moved to: the first is shown with focus where
  // the dialog puts it, and each one after takes focus on its heading, so
  // that it is read out and the keyboard starts from the top of it.
  const moved = useRef(false);

  useEffect(() => {
    if (moved.current) heading.current?.focus();
    moved.current = true;
  }, [index]);

  return (
    <Dialog title="Welcome to Snowpaw" wide onClose={() => props.onDone(false)}>
      <div className={settings.settings}>
        <nav className={settings.categories} aria-label="Setup steps">
          {steps.map((other, at) => (
            <button
              key={other.id}
              className={settings.category}
              aria-current={other === step ? "step" : undefined}
              onClick={() => setIndex(at)}
            >
              {other.label}
            </button>
          ))}
        </nav>
        <div className={styles.step}>
          <section className={settings.content}>
            <h2 ref={heading} tabIndex={-1} className={settings.heading}>
              {step.heading}
            </h2>
            <step.Panel {...props} />
          </section>
          <footer className={styles.footer}>
            <Button onClick={() => props.onDone(false)}>{last ? "Not now" : "Skip setup"}</Button>
            <span className={form.spacer} />
            {index > 0 && <Button onClick={() => setIndex(index - 1)}>Back</Button>}
            {last ? (
              <Button primary onClick={() => props.onDone(true)}>
                Make an agent
              </Button>
            ) : (
              <Button primary onClick={() => setIndex(index + 1)}>
                Next
              </Button>
            )}
          </footer>
        </div>
      </div>
    </Dialog>
  );
}

function Ready({ connections }: Props) {
  const [first] = connections;
  return (
    <>
      <p className={form.lead}>
        That is all Snowpaw needs to know for now. Everything here can be changed in Settings: click your name at the
        bottom of the sidebar.
      </p>
      <Row
        label="Model"
        hint={
          first
            ? `${first.name}: ${first.model || "no model chosen"} at ${hostLabel(first.address)}`
            : "None connected. Agents will have nothing to think with until one is."
        }
      />
      {/* True until agents can run. Take this row out when they can. */}
      <Row
        label="What comes next"
        hint="Agents cannot answer yet: that part of Snowpaw is still being built. You can make one, name it and look around."
      />
    </>
  );
}
