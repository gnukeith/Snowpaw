import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "react";
import { Button } from "../components/Button";
import styles from "./Computer.module.css";

/** Time between screen captures. The Rust side enforces its own minimum too. */
const frameInterval = 500;

export function Computer() {
  // null until the Rust side has said whether the machine is on.
  const [running, setRunning] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const screen = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    invoke<boolean>("vm_status").then(setRunning, (reason) => setError(String(reason)));
  }, []);

  // While the machine is on, ask for one frame at a time and paint it. The
  // next request goes out only after the last frame is on screen, so frames
  // can never pile up.
  useEffect(() => {
    if (!running) return;
    let live = true;
    (async () => {
      while (live) {
        if (!document.hidden) {
          try {
            const png = await invoke<ArrayBuffer>("vm_frame");
            const frame = await createImageBitmap(new Blob([png], { type: "image/png" }));
            if (live && screen.current) paint(screen.current, frame);
            frame.close();
          } catch (reason) {
            if (!live) return;
            // Do not leave a machine running that the screen cannot show.
            await invoke("vm_stop");
            setError(String(reason));
            setRunning(false);
            return;
          }
        }
        await new Promise((resolve) => setTimeout(resolve, frameInterval));
      }
    })();
    return () => {
      live = false;
    };
  }, [running]);

  async function power(on: boolean) {
    setBusy(true);
    setError(null);
    try {
      await invoke(on ? "vm_start" : "vm_stop");
      setRunning(on);
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  }

  if (running === null && !error) return null;

  if (!running) {
    return (
      <div className={styles.off}>
        <h1 className={styles.title}>The computer is off</h1>
        <p className={styles.hint}>
          Starting it boots an empty virtual machine with no network. There is no operating system
          on it yet, so its screen shows the firmware.
        </p>
        {error && <p className={styles.error}>{error}</p>}
        <Button primary disabled={busy} onClick={() => power(true)}>
          Start
        </Button>
      </div>
    );
  }

  return (
    <div className={styles.on}>
      {/* App controls stay outside the picture: anything inside it is drawn by the guest. */}
      <header className={styles.bar}>
        <span className={styles.status}>Running</span>
        <Button disabled={busy} onClick={() => power(false)}>
          Stop
        </Button>
      </header>
      <canvas ref={screen} className={styles.screen} aria-label="The computer's screen" />
    </div>
  );
}

function paint(canvas: HTMLCanvasElement, frame: ImageBitmap) {
  // Assigning a size clears the canvas, so only do it when the guest changes resolution.
  if (canvas.width !== frame.width || canvas.height !== frame.height) {
    canvas.width = frame.width;
    canvas.height = frame.height;
  }
  canvas.getContext("2d")?.drawImage(frame, 0, 0);
}
