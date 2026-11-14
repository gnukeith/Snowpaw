import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "react";
import { Button } from "../components/Button";
import styles from "./Computer.module.css";

/** Time between screen captures. The Rust side enforces its own minimum too. */
const frameInterval = 500;

/** "unknown" until the Rust side has said whether the machine is on. */
type Power = "unknown" | "off" | "on";

export function Computer() {
  const [power, setPower] = useState<Power>("unknown");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const screen = useRef<HTMLCanvasElement>(null);
  const action = useRef<HTMLButtonElement>(null);
  // Set when Start or Stop was pressed, so focus can follow to the button that replaces it.
  const refocus = useRef(false);

  useEffect(() => {
    let live = true;
    invoke<boolean>("vm_status").then(
      (running) => live && setPower(running ? "on" : "off"),
      (reason) => live && setError(String(reason)),
    );
    return () => {
      live = false;
    };
  }, []);

  // While the machine is on, ask for one frame at a time and paint it. The
  // next request goes out only after the last frame is on screen, so frames
  // can never pile up.
  useEffect(() => {
    if (power !== "on") return;
    let live = true;
    (async () => {
      while (live) {
        if (!document.hidden) {
          try {
            const png = await invoke<ArrayBuffer>("vm_frame");
            const frame = await createImageBitmap(new Blob([png], { type: "image/png" }));
            try {
              if (live && screen.current) paint(screen.current, frame);
            } finally {
              frame.close();
            }
          } catch (reason) {
            // The Rust side has already ended a machine whose screen it could
            // not read, so there is nothing left to stop here.
            if (live) {
              setError(String(reason));
              setPower("off");
            }
            return;
          }
        }
        await new Promise((resolve) => setTimeout(resolve, frameInterval));
      }
    })();
    return () => {
      live = false;
    };
  }, [power]);

  useEffect(() => {
    if (refocus.current) {
      refocus.current = false;
      action.current?.focus();
    }
  }, [power]);

  async function turn(on: boolean) {
    setBusy(true);
    setError(null);
    try {
      await invoke(on ? "vm_start" : "vm_stop");
      refocus.current = true;
      setPower(on ? "on" : "off");
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  }

  const problem = error && (
    <p className={styles.error} role="alert">
      {error}
    </p>
  );

  if (power === "on") {
    return (
      <div className={styles.on}>
        {/* App controls stay outside the picture: anything inside it is drawn by the guest. */}
        <header className={styles.bar}>
          <span className={styles.status}>Running</span>
          {problem}
          <Button ref={action} disabled={busy} onClick={() => turn(false)}>
            Stop
          </Button>
        </header>
        <canvas
          ref={screen}
          className={styles.screen}
          role="img"
          aria-label="The computer's screen. Its contents are a picture and cannot be read out."
        />
      </div>
    );
  }

  if (power === "unknown") {
    // Nothing to show while the first answer is on its way. If it failed, say
    // so: the machine may be running, so do not claim that it is off.
    return error ? (
      <div className={styles.off}>
        <h1 className={styles.title}>The computer's state could not be read</h1>
        {problem}
      </div>
    ) : null;
  }

  return (
    <div className={styles.off}>
      <h1 className={styles.title}>The computer is off</h1>
      <p className={styles.hint}>
        Starting it boots an empty virtual machine with no network. There is no operating system on
        it yet, so its screen shows the firmware.
      </p>
      {problem}
      <Button ref={action} primary disabled={busy} onClick={() => turn(true)}>
        Start
      </Button>
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
