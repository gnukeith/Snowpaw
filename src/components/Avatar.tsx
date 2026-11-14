import { useEffect, useRef, useState, type CSSProperties } from "react";
import { decodePicture } from "../data/picture";
import styles from "./Avatar.module.css";
import { Paw } from "./Paw";

interface Props {
  /** Whose face it is: an agent, or the person using the app. */
  who: { picture?: string; hue?: number };
  /** Letters to show while there is no picture. Without them, a paw. */
  initials?: string;
  size: "sm" | "md" | "lg" | "xl";
}

/** A picture of someone, or a stand-in until they have one: a paw on the
    agent's own hue, or the person's initials. Decorative: whoever it is, their
    name is written next to it or the place it sits says who they are. */
export function Avatar({ who, initials, size }: Props) {
  const { hue, picture } = who;
  const canvas = useRef<HTMLCanvasElement>(null);
  // The picture that could not be drawn, if any, so a new one gets its own try.
  const [broken, setBroken] = useState<string>();

  useEffect(() => {
    if (!picture) return;
    let live = true;
    // Inside the chain, so that everything that can go wrong on the way to a
    // drawn picture, from text that is not base64 to a canvas that will not
    // take it, ends in the stand-in instead.
    Promise.resolve(picture)
      .then(decodePicture)
      .then((image) => {
        try {
          // By now the avatar may be showing another picture, or be gone.
          // Only the picture that is still wanted is drawn.
          if (live && canvas.current) {
            canvas.current.width = image.width;
            canvas.current.height = image.height;
            canvas.current.getContext("2d")?.drawImage(image, 0, 0);
          }
        } finally {
          image.close();
        }
      })
      .catch(() => live && setBroken(picture));
    return () => {
      live = false;
    };
  }, [picture]);

  const look = `${styles.avatar} ${styles[size]}`;
  const tint = hue === undefined ? undefined : ({ "--avatar-hue": hue } as CSSProperties);

  if (picture && picture !== broken) {
    return <canvas ref={canvas} className={look} style={tint} data-avatar aria-hidden="true" />;
  }
  if (initials !== undefined) {
    return (
      <span className={`${look} ${styles.initials}`} aria-hidden="true">
        {initials}
      </span>
    );
  }
  return (
    <span className={look} style={tint} data-avatar aria-hidden="true">
      <Paw className={styles.paw} />
    </span>
  );
}
