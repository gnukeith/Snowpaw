import styles from "./Icon.module.css";

/* Hand-drawn on a 16 by 16 grid so the app needs no icon library. */
const icons = {
  chat: (
    <path d="M4.5 2.5h7a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2H8L4.5 14v-2.5a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2z" />
  ),
  computer: (
    <>
      <rect x="2" y="3" width="12" height="8" rx="1.5" />
      <path d="M6 13.5h4M8 11v2.5" />
    </>
  ),
  settings: (
    <>
      <path d="M2 5h5m4 0h3M2 11h3m4 0h5" />
      <circle cx="9" cy="5" r="2" />
      <circle cx="7" cy="11" r="2" />
    </>
  ),
};

export type IconName = keyof typeof icons;

export function Icon({ name }: { name: IconName }) {
  return (
    <svg className={styles.icon} viewBox="0 0 16 16" aria-hidden="true">
      {icons[name]}
    </svg>
  );
}
