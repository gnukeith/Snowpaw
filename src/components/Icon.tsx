import styles from "./Icon.module.css";

/* Hand-drawn on a 16 by 16 grid so the app needs no icon library. */
const icons = {
  search: (
    <>
      <circle cx="7" cy="7" r="4.5" />
      <path d="M10.5 10.5 14 14" />
    </>
  ),
  plus: <path d="M8 3v10M3 8h10" />,
  close: <path d="m4 4 8 8m0-8-8 8" />,
  send: <path d="M8 13V3M4 7l4-4 4 4" />,
  pin: <path d="M6 2.5h4l-.5 4 2 2.5h-7l2-2.5zM8 9v4.5" />,
  edit: <path d="m3 13 .5-3L11 2.5 13.5 5 6 12.5z" />,
};

export type IconName = keyof typeof icons;

export function Icon({ name }: { name: IconName }) {
  return (
    <svg className={styles.icon} viewBox="0 0 16 16" aria-hidden="true">
      {icons[name]}
    </svg>
  );
}
