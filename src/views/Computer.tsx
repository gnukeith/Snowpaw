import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "react";
import { Button } from "../components/Button";
import styles from "./Computer.module.css";

/** Time between screen captures. The Rust side enforces its own minimum too. */
const frameInterval = 500;
/** Time between looks at a start that this view is not itself waiting for. */
const statusInterval = 1000;

/**
 * What the Rust side says about the machine. "starting" is everything between
 * a start being let in and its machine either running or seen to be gone.
 * "unknown" is this view's own: the Rust side could not be asked.
 */
type Power = "off" | "starting" | "on" | "unknown";

const ask = () => invoke<Power>("vm_status").catch((): Power => "unknown");

export function Computer() {
  // Null until the first answer arrives.
  const [power, setPower] = useState<Power | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // True while the machine runs but its latest frame could not be drawn.
  const [undrawn, setUndrawn] = useState(false);
  const screen = useRef<HTMLCanvasElement>(null);
  const action = useRef<HTMLButtonElement>(null);
  // Set when Start or Stop was pressed, so focus can follow to the button that replaces it.
  const refocus = useRef(false);

  useEffect(() => {
    let live = true;
    ask().then((now) => live && setPower(now));
    return () => {
      live = false;
    };
  }, []);

  // A start that this view is not waiting for itself (it was begun before the
  // view was opened, or it failed and its machine is still being ended) is
  // looked at again until it has settled.
  useEffect(() => {
    if (power !== "starting" || busy) return;
    let live = true;
    const timer = setInterval(() => ask().then((now) => live && setPower(now)), statusInterval);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [power, busy]);

  // While the machine is on, ask for one frame at a time and paint it. The
  // next request goes out only after the last frame is on screen, so frames
  // can never pile up.
  useEffect(() => {
    if (power !== "on") return;
    let live = true;
    (async () => {
      while (live) {
        if (!document.hidden) {
          let png: ArrayBuffer;
          try {
            png = await invoke<ArrayBuffer>("vm_frame");
          } catch (reason) {
            // The Rust side ends a machine whose screen it cannot read. Ask
            // whether it managed to, and do not claim more than the answer.
            const now = await ask();
            if (live) {
              setError(String(reason));
              setPower(now);
            }
            return;
          }
          // A frame that arrives but cannot be drawn is this side's problem.
          // The machine is still running, so keep Stop on screen and say so.
          try {
            const frame = await createImageBitmap(new Blob([png], { type: "image/png" }));
            try {
              if (live && screen.current) paint(screen.current, frame);
            } finally {
              frame.close();
            }
            if (live) setUndrawn(false);
          } catch {
            if (live) setUndrawn(true);
          }
        }
        await new Promise((resolve) => setTimeout(resolve, frameInterval));
      }
    })();
    return () => {
      live = false;
      setUndrawn(false);
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
    if (on) setPower("starting");
    try {
      await invoke(on ? "vm_start" : "vm_stop");
      refocus.current = true;
      setPower(on ? "on" : "off");
    } catch (reason) {
      setError(String(reason));
      // A start or stop that failed can still leave a machine there. Ask.
      setPower(await ask());
    } finally {
      setBusy(false);
    }
  }

  const message =
    error ??
    (undrawn && power === "on"
      ? "The screen could not be drawn. The computer is still running."
      : null);
  const problem = message && (
    <p className={styles.error} role="alert">
      {message}
    </p>
  );
  const stop = (
    <Button ref={action} disabled={busy} onClick={() => turn(false)}>
      Stop
    </Button>
  );

  if (power === null) return null;

  if (power === "on") {
    return (
      <div className={styles.on}>
        {/* App controls stay outside the picture: anything inside it is drawn by the guest. */}
        <header className={styles.bar}>
          <span className={styles.status}>Running</span>
          {problem}
          {stop}
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

  if (power === "starting") {
    return (
      <div className={styles.off}>
        <h1 className={styles.title}>The computer is starting</h1>
        <p className={styles.hint}>
          This takes a few seconds. If the start fails, this stays on screen until its machine has
          been ended.
        </p>
        {problem}
        {stop}
      </div>
    );
  }

  if (power === "unknown") {
    // The machine may be running, so do not claim that it is off, and keep
    // Stop within reach.
    return (
      <div className={styles.off}>
        <h1 className={styles.title}>The computer's state could not be read</h1>
        <p className={styles.hint}>It may be running.</p>
        {problem}
        <div className={styles.actions}>
          <Button disabled={busy} onClick={() => ask().then(setPower)}>
            Check again
          </Button>
          {stop}
        </div>
      </div>
    );
  }

  return (
    <div className={styles.off}>
      <h1 className={styles.title}>The computer is off</h1>
      <p className={styles.hint}>
        Starting it boots Fedora from a read-only image, in a virtual machine with no network.
        Nothing it does is kept once it stops. For now you can watch its screen, but not type or
        click in it.
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
