import { Empty } from "../components/Empty";
import type { Agent } from "../data/agents";
import type { Step } from "../data/conversation";
import styles from "./Activity.module.css";

const clock = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });

/** What the agent thought and what came back from what it ran, in order, so
    its answers can be checked against how it got to them. */
export function Activity({ agent, steps }: { agent: Agent; steps: Step[] }) {
  if (steps.length === 0) {
    return (
      <Empty
        title="Nothing to show yet"
        hint={`What ${agent.name} thinks, and the output of what it runs, will appear here as it works.`}
      />
    );
  }
  return (
    <ol className={styles.steps} tabIndex={0} aria-label="Activity">
      {steps.map((step) => (
        <li key={step.id} className={styles.step}>
          <div className={styles.label}>
            <span>{step.kind === "thinking" ? "Thinking" : "Output"}</span>
            <time dateTime={new Date(step.at).toISOString()}>{clock.format(step.at)}</time>
          </div>
          {step.kind === "thinking" ? (
            <p className={styles.thinking}>{step.text}</p>
          ) : (
            <div className={styles.output}>
              {step.source && <code className={styles.source}>{step.source}</code>}
              {/* On one line: a pre keeps every space and line break inside it. */}
              <pre className={styles.text} tabIndex={0}>{step.text}</pre>
            </div>
          )}
        </li>
      ))}
    </ol>
  );
}
