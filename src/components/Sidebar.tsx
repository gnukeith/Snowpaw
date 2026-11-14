import type { View } from "../App";
import { Icon, type IconName } from "./Icon";
import styles from "./Sidebar.module.css";

interface Props {
  view: View;
  onNavigate: (view: View) => void;
}

export function Sidebar({ view, onNavigate }: Props) {
  const item = (target: View, icon: IconName, label: string) => (
    <button
      className={styles.item}
      aria-current={view === target ? "page" : undefined}
      onClick={() => onNavigate(target)}
    >
      <Icon name={icon} />
      {label}
    </button>
  );

  return (
    <nav className={styles.sidebar} aria-label="Main">
      <div className={styles.brand}>
        <svg className={styles.logo} viewBox="96 96 320 320" aria-hidden="true">
          <ellipse cx="146" cy="232" rx="38" ry="50" transform="rotate(-24 146 232)" />
          <ellipse cx="214" cy="160" rx="40" ry="54" transform="rotate(-8 214 160)" />
          <ellipse cx="298" cy="160" rx="40" ry="54" transform="rotate(8 298 160)" />
          <ellipse cx="366" cy="232" rx="38" ry="50" transform="rotate(24 366 232)" />
          <path d="M256 250c-62 0-112 52-112 104 0 36 28 56 60 56 20 0 34-8 52-8s32 8 52 8c32 0 60-20 60-56 0-52-50-104-112-104z" />
        </svg>
        Snowpaw
      </div>
      {item("conversations", "chat", "Conversations")}
      {item("computer", "computer", "Computer")}
      <div className={styles.spacer} />
      {item("settings", "settings", "Settings")}
    </nav>
  );
}
