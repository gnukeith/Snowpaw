import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { Agent } from "../data/agents";
import { decodePicture } from "../data/picture";
import styles from "./Avatar.module.css";

interface Props {
  agent: Pick<Agent, "hue" | "picture">;
  size: "sm" | "md" | "lg" | "xl";
}

/** An agent's picture, or a paw on the agent's own hue until it has one.
    Decorative: the agent's name is always written next to it. */
export function Avatar({ agent, size }: Props) {
  const { hue, picture } = agent;
  const canvas = useRef<HTMLCanvasElement>(null);
  // The picture that could not be drawn, if any, so a new one gets its own try.
  const [broken, setBroken] = useState<string>();

  useEffect(() => {
    if (!picture) return;
    let live = true;
    // `atob` throws on text that is not base64, so decoding starts inside the chain.
    Promise.resolve(picture)
      .then(decodePicture)
      .then(
        (image) => {
          // By now the avatar may be showing another picture, or be gone. Only
          // the picture that is still wanted is drawn.
          if (live && canvas.current) {
            canvas.current.width = image.width;
            canvas.current.height = image.height;
            canvas.current.getContext("2d")?.drawImage(image, 0, 0);
          }
          image.close();
        },
        () => live && setBroken(picture),
      );
    return () => {
      live = false;
    };
  }, [picture]);

  const look = `${styles.avatar} ${styles[size]}`;
  const tint = { "--avatar-hue": hue } as CSSProperties;

  if (picture && picture !== broken) {
    return <canvas ref={canvas} className={look} style={tint} data-avatar aria-hidden="true" />;
  }
  return (
    <svg className={look} style={tint} data-avatar viewBox="16 36 480 480" aria-hidden="true">
      <ellipse cx="146" cy="232" rx="38" ry="50" transform="rotate(-24 146 232)" />
      <ellipse cx="214" cy="160" rx="40" ry="54" transform="rotate(-8 214 160)" />
      <ellipse cx="298" cy="160" rx="40" ry="54" transform="rotate(8 298 160)" />
      <ellipse cx="366" cy="232" rx="38" ry="50" transform="rotate(24 366 232)" />
      <path d="M256 250c-62 0-112 52-112 104 0 36 28 56 60 56 20 0 34-8 52-8s32 8 52 8c32 0 60-20 60-56 0-52-50-104-112-104z" />
    </svg>
  );
}
