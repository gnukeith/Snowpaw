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
  expand: <path d="M9.5 2.5h4v4m-7 7h-4v-4m11-7L9 7m-6.5 6.5L7 9" />,
  collapse: <path d="M13.5 6.5h-4v-4m-7 7h4v4m3.5-7L14 2M6.5 9.5 2 14" />,
  computer: (
    <>
      <rect x="2" y="3" width="12" height="8" rx="1.5" />
      <path d="M6 13.5h4M8 11v2.5" />
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
