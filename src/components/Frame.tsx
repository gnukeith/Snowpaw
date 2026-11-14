import { useLayoutEffect, useRef, useState } from "react";
import { frameFailure, frameInput, fromFrame, type FrameInput, type FrameTheme } from "./frameMessages";
import styles from "./Frame.module.css";

/** Resolve the app's tokens to the hex colours Mermaid understands. */
function resolvedTheme(element: HTMLElement): FrameTheme {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  const context = canvas.getContext("2d");
  if (!context) throw new Error(frameFailure);
  const probe = document.createElement("span");
  element.append(probe);
  const color = (token: string) => {
    probe.style.color = `var(--${token})`;
    context.clearRect(0, 0, 1, 1);
    context.fillStyle = getComputedStyle(probe).color;
    context.fillRect(0, 0, 1, 1);
    return "#" + [...context.getImageData(0, 0, 1, 1).data].slice(0, 3).map((n) => n.toString(16).padStart(2, "0")).join("");
  };
  const theme = {
    background: color("bubble"), surface: color("surface"), text: color("text"),
    muted: color("text-muted"), accent: color("accent"), border: color("border"),
    font: getComputedStyle(element).fontFamily, fontSize: getComputedStyle(element).fontSize,
  };
  probe.remove();
  return theme;
}

/** A disposable, opaque document. A theme change gets a fresh document,
    because each frame may accept exactly one input. */
export function Frame({ entry, source, title }: { entry: string; source: string; title: string }) {
  const host = useRef<HTMLDivElement>(null);
  const [theme, setTheme] = useState<FrameTheme>();
  const [failed, setFailed] = useState(false);
  useLayoutEffect(() => {
    const update = () => {
      try { setTheme(resolvedTheme(host.current!)); } catch { setFailed(true); }
    };
    update();
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["style", "data-theme", "class"] });
    const scheme = matchMedia("(prefers-color-scheme: dark)");
    scheme.addEventListener("change", update);
    return () => { observer.disconnect(); scheme.removeEventListener("change", update); };
  }, []);
  if (failed) throw new Error(frameFailure);
  const input: FrameInput | undefined = theme && { type: "render", source, theme };
  if (input && !frameInput(input)) throw new Error(frameFailure);
  return <div ref={host}>{input && <Document key={JSON.stringify(input)} entry={entry} input={input} title={title} />}</div>;
}

function Document({ entry, input, title }: { entry: string; input: FrameInput; title: string }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [failed, setFailed] = useState(false);
  const sent = useRef(false);
  useLayoutEffect(() => {
    const timer = window.setTimeout(() => setFailed(true), 15_000);
    const receive = (event: MessageEvent<unknown>) => {
      const result = fromFrame(event, frame.current?.contentWindow);
      if (!result) return;
      clearTimeout(timer);
      if (result.type === "error") setFailed(true);
      else if (frame.current) frame.current.style.height = `${Math.ceil(result.height)}px`;
    };
    window.addEventListener("message", receive);
    return () => { clearTimeout(timer); window.removeEventListener("message", receive); };
  }, []);
  if (failed) throw new Error(frameFailure);
  return <iframe ref={frame} className={styles.frame} title={title} sandbox="allow-scripts"
    referrerPolicy="no-referrer" src={`frame://localhost/frames/${entry}.html`}
    onLoad={() => {
      if (sent.current) return;
      sent.current = true;
      // An opaque target cannot be addressed with a tuple targetOrigin.
      frame.current?.contentWindow?.postMessage(input, "*");
    }} />;
}
