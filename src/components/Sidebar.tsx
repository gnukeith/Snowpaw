import { useState, type MouseEvent, type ReactNode } from "react";
import { initials, maxPinned, type Agent } from "../data/agents";
import { workOf, type AllWork } from "../data/conversation";
import { Avatar } from "./Avatar";
import { IconButton } from "./IconButton";
import { Input } from "./Input";
import { Menu } from "./Menu";
import { Paw } from "./Paw";
import styles from "./Sidebar.module.css";

interface Props {
  agents: Agent[];
  work: AllWork;
  selected?: Agent;
  /** The person using the app. */
  user: { name: string; picture?: string };
  /** Set when agents or the user's picture could not be written to storage. */
  unsaved: boolean;
  /** The window's buttons, when the desktop puts them on this side. */
  windowButtons: ReactNode;
  /** Whether one more agent may be pinned. */
  canPin: boolean;
  onTogglePin: (agent: Agent) => void;
  onEdit: (agent: Agent) => void;
  onSelect: (agent: Agent) => void;
  onCreate: () => void;
  onOpenSettings: () => void;
}

export function Sidebar(props: Props) {
  const { agents, work, selected, user, unsaved } = props;
  // `null` while the search box is closed.
  const [query, setQuery] = useState<string | null>(null);
  // The agent whose menu is open, and where it was asked for.
  const [menu, setMenu] = useState<{ agent: Agent; x: number; y: number }>();

  // A right click, or the keyboard's menu key, on an agent.
  const openMenu = (agent: Agent) => (event: MouseEvent) => {
    event.preventDefault();
    // Asked for from the keyboard there is no pointer, so the menu goes under
    // the agent instead.
    const box = event.currentTarget.getBoundingClientRect();
    const pointed = event.clientX !== 0 || event.clientY !== 0;
    setMenu({
      agent,
      x: pointed ? event.clientX : box.left,
      y: pointed ? event.clientY : box.bottom,
    });
  };

  const wanted = query?.trim().toLowerCase();
  const shown = wanted ? agents.filter((agent) => agent.name.toLowerCase().includes(wanted)) : agents;
  const pinned = shown.filter((agent) => agent.pinned);
  const others = shown.filter((agent) => !agent.pinned);

  const current = (agent: Agent) => (agent.id === selected?.id ? "page" : undefined);

  return (
    <nav className={styles.sidebar} aria-label="Agents">
      <div className={styles.tools} data-window-drag>
        {props.windowButtons}
        {/* The app's name, where a title bar would have had it. With window
            buttons on this side there is only room for the mark. */}
        <span className={styles.brand}>
          <Paw className={styles.logo} />
          {!props.windowButtons && "Snowpaw"}
        </span>
        <span className={styles.spacer} />
        <IconButton
          icon={query === null ? "search" : "close"}
          label={query === null ? "Search agents" : "Close search"}
          onClick={() => setQuery(query === null ? "" : null)}
        />
        <IconButton icon="plus" label="New agent" onClick={props.onCreate} />
      </div>
      {query !== null && (
        <div className={styles.search}>
          <Input
            autoFocus
            value={query}
            placeholder="Search agents"
            aria-label="Search agents"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => event.key === "Escape" && setQuery(null)}
          />
        </div>
      )}

      {pinned.length > 0 && (
        <div className={styles.pins}>
          {pinned.map((agent) => (
            <button
              key={agent.id}
              className={styles.pin}
              aria-current={current(agent)}
              onClick={() => props.onSelect(agent)}
              onContextMenu={openMenu(agent)}
            >
              <Avatar who={agent} size="lg" />
              <span className={styles.pinName}>{agent.name}</span>
            </button>
          ))}
        </div>
      )}

      <div className={styles.list}>
        {others.map((agent) => (
          <button
            key={agent.id}
            className={styles.row}
            aria-current={current(agent)}
            onClick={() => props.onSelect(agent)}
            onContextMenu={openMenu(agent)}
          >
            <Avatar who={agent} size="md" />
            <span className={styles.rowText}>
              <span className={styles.rowName}>{agent.name}</span>
              <span className={styles.preview}>
                {workOf(work, agent.id).messages.at(-1)?.text ?? "No messages yet"}
              </span>
            </span>
          </button>
        ))}
        {wanted && shown.length === 0 && <p className={styles.note}>No agent has that name.</p>}
      </div>

      {unsaved && (
        <p className={styles.note} role="alert">
          Your changes could not be saved. They will be gone when the app closes.
        </p>
      )}
      <button className={styles.user} onClick={props.onOpenSettings}>
        <Avatar who={user} initials={initials(user.name)} size="md" />
        <span className={styles.userName}>{user.name}</span>
      </button>
      {menu && (
        <Menu
          at={menu}
          items={[
            menu.agent.pinned
              ? { label: "Unpin", onSelect: () => props.onTogglePin(menu.agent) }
              : props.canPin
                ? { label: "Pin", onSelect: () => props.onTogglePin(menu.agent) }
                : { label: `Only ${maxPinned} agents can be pinned`, onSelect: () => {}, disabled: true },
            { label: "Edit", onSelect: () => props.onEdit(menu.agent) },
          ]}
          onClose={() => setMenu(undefined)}
        />
      )}
    </nav>
  );
}
