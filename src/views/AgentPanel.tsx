import { useEffect, useRef, useState, type ReactNode, type Ref } from "react";
import { Avatar } from "../components/Avatar";
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
  /** The panel's outermost element, for whoever needs to measure it. */
  ref?: Ref<HTMLElement>;
  agent: Agent;
  work: Work;
  /** The window's buttons: while the panel is open, it is in the window's corner. */
  windowButtons: ReactNode;
  onClose: () => void;
}

/* To add a tab, add its name here and its view below. */
const tabs = ["changes", "activity", "computer", "scheduled"] as const;

/** What an agent is doing, beside its conversation. */
export function AgentPanel({ ref, agent, work, windowButtons, onClose }: Props) {
  const panel = useRef<HTMLElement>(null);
  const [tab, setTab] = useState<(typeof tabs)[number]>(tabs[0]);
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
    <aside
      ref={(element) => {
        panel.current = element;
        if (typeof ref === "function") ref(element);
        else if (ref) ref.current = element;
      }}
      className={styles.side}
      aria-label={`What ${agent.name} is doing`}
    >
      <div className={styles.panel}>
        {/* Full screen, there is no window to move: the panel is the screen. */}
        <header className={styles.header} data-window-drag={full ? undefined : ""}>
          {/* Says whose work this is when the conversation is not beside it:
              in a narrow window and in full screen. */}
          <Avatar who={agent} size="sm" />
          <h2 className={styles.name}>{agent.name}</h2>
          <IconButton
            icon={full ? "collapse" : "expand"}
            label={full ? "Leave full screen" : "Full screen"}
            onClick={toggleFull}
          />
          {!full && <IconButton icon="panel" label="Close panel" onClick={onClose} />}
          {!full && windowButtons}
        </header>
        <div className={styles.tabs}>
          <Segmented fill label="Show" options={tabs} value={tab} onChange={setTab} />
        </div>
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
