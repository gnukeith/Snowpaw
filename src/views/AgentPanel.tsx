import { useEffect, useRef, useState } from "react";
import { IconButton } from "../components/IconButton";
import type { Agent } from "../data/agents";
import styles from "./AgentPanel.module.css";
import { Computer } from "./Computer";

interface Props {
  agent: Agent;
  onClose: () => void;
}

/** What an agent is doing, beside its conversation. */
export function AgentPanel({ agent, onClose }: Props) {
  const panel = useRef<HTMLElement>(null);
  const [full, setFull] = useState(false);

  // Escape and the desktop can leave full screen too, so follow what happened
  // instead of what was asked for.
  useEffect(() => {
    const follow = () => setFull(document.fullscreenElement === panel.current);
    document.addEventListener("fullscreenchange", follow);
    return () => document.removeEventListener("fullscreenchange", follow);
  }, []);

  function toggleFull() {
    // A refusal leaves the panel as it is, which is all there is to do about it.
    const change = full ? document.exitFullscreen() : panel.current?.requestFullscreen();
    change?.catch(() => {});
  }

  return (
    <aside ref={panel} className={styles.side} aria-label={`What ${agent.name} is doing`}>
      <div className={styles.panel}>
        <header className={styles.header}>
          <h2 className={styles.title}>Computer</h2>
          <IconButton
            icon={full ? "collapse" : "expand"}
            label={full ? "Leave full screen" : "Full screen"}
            onClick={toggleFull}
          />
          {!full && <IconButton icon="close" label="Close panel" onClick={onClose} />}
        </header>
        <div className={styles.body}>
          <Computer />
        </div>
      </div>
    </aside>
  );
}
