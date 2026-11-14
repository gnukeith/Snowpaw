import { useMemo } from "react";
import { Empty } from "../components/Empty";
import type { Agent } from "../data/agents";
import { parseDiff } from "../data/diff";
import styles from "./Changes.module.css";

const marks = { add: "+", remove: "−", context: "" };

/** The changes an agent made to files, as a diff to read through. */
export function Changes({ agent, diff }: { agent: Agent; diff: string }) {
  const files = useMemo(() => parseDiff(diff), [diff]);

  if (files.length === 0) {
    return (
      <Empty
        title="No changes"
        hint={`When ${agent.name} changes files, what it added and removed will appear here.`}
      />
    );
  }
  return (
    <div className={styles.changes}>
      {files.map((file, index) => (
        <details key={index} className={styles.file} open>
          <summary className={styles.summary}>
            <span className={styles.path}>{file.path}</span>
            <span className={styles.added}>+{file.added}</span>
            <span className={styles.removed}>−{file.removed}</span>
          </summary>
          {file.hunks.length === 0 ? (
            <p className={styles.note}>No text changes to show.</p>
          ) : (
            <div className={styles.lines}>
              {file.hunks.map((hunk, at) => (
                <div key={at} className={styles.hunk}>
                  <div className={styles.header}>{hunk.header}</div>
                  {hunk.lines.map((line, row) => (
                    <div key={row} className={styles[line.kind]}>
                      <span className={styles.number}>{line.before}</span>
                      <span className={styles.number}>{line.after}</span>
                      <span className={styles.mark}>{marks[line.kind]}</span>
                      <span className={styles.code}>{line.text}</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </details>
      ))}
    </div>
  );
}
