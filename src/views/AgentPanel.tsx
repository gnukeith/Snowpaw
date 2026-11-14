import { useEffect, useRef, useState } from "react";
import { IconButton } from "../components/IconButton";
import { Segmented } from "../components/Segmented";
import type { Agent } from "../data/agents";
import type { Work } from "../data/conversation";
import { Activity } from "./Activity";
import { Changes } from "./Changes";
import styles from "./AgentPanel.module.css";
import { Computer } from "./Computer";
import { Scheduled } from "./Scheduled";

interface Props {
  agent: Agent;
  work: Work;
  onClose: () => void;
}

/* To add a tab, add its name here and its view below. */
const tabs = ["computer", "activity", "changes", "scheduled"] as const;

/** What an agent is doing, beside its conversation. */
export function AgentPanel({ agent, work, onClose }: Props) {
  const panel = useRef<HTMLElement>(null);
  const [tab, setTab] = useState<(typeof tabs)[number]>("computer");
  const [full, setFull] = useState(false);

  // Opening the panel moves focus into it. In a narrow window the panel takes
  // the conversation's place, and what had focus is no longer on screen.
  useEffect(() => {
    panel.current?.querySelector<HTMLElement>("input:checked")?.focus();
  }, []);

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
          <Segmented label="Show" options={tabs} value={tab} onChange={setTab} />
          <span className={styles.spacer} />
          <IconButton
            icon={full ? "collapse" : "expand"}
            label={full ? "Leave full screen" : "Full screen"}
            onClick={toggleFull}
          />
          {!full && <IconButton icon="close" label="Close panel" onClick={onClose} />}
        </header>
        <div className={styles.body}>
          {tab === "computer" && <Computer />}
          {tab === "activity" && <Activity agent={agent} steps={work.steps} />}
          {tab === "changes" && <Changes agent={agent} diff={work.diff} />}
          {tab === "scheduled" && <Scheduled agent={agent} tasks={work.tasks} />}
        </div>
      </div>
    </aside>
  );
}
