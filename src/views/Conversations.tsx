import styles from "./Conversations.module.css";

export function Conversations() {
  return (
    <div className={styles.empty}>
      <h1 className={styles.title}>No conversations yet</h1>
      <p className={styles.hint}>Conversations with your agents will appear here.</p>
    </div>
  );
}
