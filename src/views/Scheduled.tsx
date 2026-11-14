import { Empty } from "../components/Empty";
import type { Agent } from "../data/agents";
import { taskLine, type Task } from "../data/conversation";
import styles from "./Scheduled.module.css";

/** What an agent is set to do later, soonest first. */
export function Scheduled({ agent, tasks }: { agent: Agent; tasks: Task[] }) {
  if (tasks.length === 0) {
    return (
      <Empty
        title="Nothing scheduled"
        hint={`Tasks ${agent.name} will run later, and reminders it will give you, will appear here.`}
      />
    );
  }
  return (
    <ul className={styles.tasks}>
      {[...tasks]
        .sort((a, b) => a.at - b.at)
        .map((task) => (
          <li key={task.id} className={styles.task}>
            <p className={styles.title}>{task.title}</p>
            <p className={styles.when}>{taskLine(task)}</p>
          </li>
        ))}
    </ul>
  );
}
