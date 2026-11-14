// Do not open a console window next to the app on Windows release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod frame;
mod plugin_frame;
mod qmp;
mod vm;

use std::fs::File;
use std::io;
use std::panic;
use std::sync::{Arc, Condvar, Mutex, MutexGuard, PoisonError};
use tauri::ipc::Response;
use tauri::{AppHandle, Manager, RunEvent, State};
use vm::Vm;

/// The image the computer boots from, inside the app's data directory.
const BOOT_DISC: &str = "images/Fedora-Workstation-Live-45-1.4.x86_64.iso";

/// The one virtual machine the app can run. The lock is held only for a
/// moment, never while waiting for a machine.
#[derive(Default)]
struct Computer {
    slot: Mutex<Slot>,
    /// Signalled when a start that was under way has finished, either way.
    settled: Condvar,
}

#[derive(Default)]
struct Slot {
    state: Place,
    /// Goes up on every stop, so a start that was under way can tell that it
    /// has been cancelled.
    stops: u64,
    /// Set when the app is exiting. Nothing may start after that.
    closed: bool,
}

/// There is one place for a machine. It is taken from the moment a start is
/// let in until the machine is proven gone, so two never run side by side.
#[derive(Default)]
enum Place {
    #[default]
    Off,
    Starting,
    On(Arc<Vm>),
}

impl Computer {
    fn lock(&self) -> MutexGuard<'_, Slot> {
        // A panic in one command must not leave the machine impossible to stop.
        self.slot.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// The running machine, if there is one. A machine that has ended by
    /// itself gives up its place here.
    fn running(&self) -> Option<Arc<Vm>> {
        let mut slot = self.lock();
        let Place::On(vm) = &slot.state else { return None };
        let vm = Arc::clone(vm);
        if !vm.has_exited() {
            return Some(vm);
        }
        slot.state = Place::Off;
        // The last handle on the machine is let go after the lock, not under
        // it: that waits for bubblewrap and removes the session directory.
        drop(slot);
        None
    }

    /// What the webview is told: "off", "starting" or "on". Only "off" says
    /// that no machine is there. "starting" covers everything from a start
    /// being let in until its machine runs or has been seen to be gone.
    fn status(&self) -> &'static str {
        // Lets a machine that has ended give up its place first.
        self.running();
        match self.lock().state {
            Place::Off => "off",
            Place::Starting => "starting",
            Place::On(_) => "on",
        }
    }

    /// Lets a start in if the place is free. `Ok(None)` means a machine is
    /// already running; `Ok(Some(ticket))` must be handed to `finish_start`.
    fn begin_start(&self) -> Result<Option<u64>, &'static str> {
        if self.running().is_some() {
            return Ok(None);
        }
        let mut slot = self.lock();
        match slot.state {
            _ if slot.closed => Err("Snowpaw is closing."),
            Place::Starting => Err("The computer is already starting."),
            Place::On(_) => Ok(None),
            Place::Off => {
                slot.state = Place::Starting;
                Ok(Some(slot.stops))
            }
        }
    }

    /// Settles a start that `begin_start` let in: the machine takes the
    /// place, unless the start failed or was stopped in the meantime.
    fn finish_start(&self, ticket: u64, started: io::Result<Vm>) -> Result<(), &'static str> {
        let stopped = {
            let slot = self.lock();
            slot.closed || slot.stops != ticket
        };
        let (state, outcome) = match started {
            Ok(vm) if !stopped => (Place::On(Arc::new(vm)), Ok(())),
            Ok(vm) => {
                // A machine that cannot be proven gone keeps the place, where
                // it can be seen and stopped again.
                let state = if vm.kill() { Place::Off } else { Place::On(Arc::new(vm)) };
                (state, Err("The computer was stopped while it was starting."))
            }
            Err(error) => {
                eprintln!("vm_start: {error}");
                (Place::Off, Err("The computer could not be started."))
            }
        };
        self.lock().state = state;
        self.settled.notify_all();
        outcome
    }

    /// Ends the machine, and a start that is under way. With `closing`, also
    /// refuses every later start. False if the machine could not be proven
    /// gone: it then keeps its place.
    fn stop(&self, closing: bool) -> bool {
        let mut slot = self.lock();
        slot.stops += 1;
        slot.closed |= closing;
        // A start under way now ends its own machine. Wait for that, so that
        // stopped means stopped. Not when the app is closing: this is then
        // the thread that runs the window, and a machine cannot outlive the
        // app in any case (see the top of vm.rs).
        while !closing && matches!(slot.state, Place::Starting) {
            slot = self.settled.wait(slot).unwrap_or_else(PoisonError::into_inner);
        }
        let vm = match &slot.state {
            Place::On(vm) => Some(Arc::clone(vm)),
            _ => None,
        };
        drop(slot);
        vm.is_none_or(|vm| self.end(&vm))
    }

    /// Ends `vm`, and frees its place once it is proven gone. A newer
    /// machine that has taken the place since is left alone.
    fn end(&self, vm: &Arc<Vm>) -> bool {
        // Not under the lock: this waits for the machine to be gone.
        let gone = vm.kill();
        let mut slot = self.lock();
        if gone && matches!(&slot.state, Place::On(current) if Arc::ptr_eq(current, vm)) {
            slot.state = Place::Off;
        }
        gone
    }
}

// The commands below, with those in `frame`, are the whole surface the webview
// gets. None here takes an argument: paths, QEMU options and control messages
// are all decided in Rust. The one in `frame` that does takes a colour.
// Details of a failure go to the log, and the webview gets a fixed sentence.

#[tauri::command(async)]
fn vm_start(app: AppHandle, computer: State<'_, Computer>) -> Result<(), &'static str> {
    // Opened once, here: the machine gets this file even if its path changes.
    let disc = app.path().app_data_dir().ok().and_then(|dir| File::open(dir.join(BOOT_DISC)).ok());
    let disc = disc.filter(|disc| disc.metadata().is_ok_and(|found| found.is_file()));
    let disc = disc.ok_or("The Fedora image is missing. The README explains how to get it.")?;
    let Some(ticket) = computer.begin_start()? else {
        return Ok(());
    };
    // A panic in here must still settle the start, or every later stop
    // would wait for it for ever.
    let started = panic::catch_unwind(|| Vm::spawn(Some(&disc)).and_then(vm::Spawned::connect));
    computer.finish_start(ticket, started.unwrap_or_else(|_| Err(io::Error::other("the start panicked"))))
}

#[tauri::command(async)]
fn vm_stop(computer: State<'_, Computer>) -> Result<(), &'static str> {
    computer.stop(false).then_some(()).ok_or("The computer could not be stopped. Try again.")
}

/// Whether the computer is "off", "starting" or "on".
#[tauri::command(async)]
fn vm_status(computer: State<'_, Computer>) -> &'static str {
    computer.status()
}

/// The guest's screen as PNG bytes.
#[tauri::command(async)]
fn vm_frame(computer: State<'_, Computer>) -> Result<Response, &'static str> {
    let vm = computer.running().ok_or("The computer is no longer running.")?;
    vm.frame().map(Response::new).map_err(|error| {
        eprintln!("vm_frame: {error}");
        // A machine whose screen cannot be read is ended here and now. Its
        // control connection may be out of step, and the webview that would
        // otherwise ask for the stop may already have moved on.
        if computer.end(&vm) {
            "The screen could not be read, so the computer was stopped."
        } else {
            "The screen could not be read, and the computer could not be stopped. Try Stop."
        }
    })
}

/// What this computer calls itself, which the app shows as the user's name
/// until they choose one. Empty if the system will not say.
#[tauri::command]
fn device_name() -> String {
    std::fs::read_to_string("/proc/sys/kernel/hostname")
        .map(|name| name.trim().to_owned())
        .unwrap_or_default()
}

fn main() {
    tauri::Builder::default()
        .register_uri_scheme_protocol("frame", |ctx, request| {
            plugin_frame::respond(request, |path| {
                // iter() exposes compressed bytes: use it only as an exact
                // allowlist, then get() to decompress. Never use its dev
                // filesystem fallback or resolve an unknown SPA path.
                #[cfg(debug_assertions)]
                if tauri::is_dev() {
                    return plugin_frame::from_disk(path);
                }
                let resolver = ctx.app_handle().asset_resolver();
                if !resolver.iter().any(|(key, _)| key.as_ref() == path) {
                    return None;
                }
                resolver.get(path.to_owned()).map(|asset| asset.bytes)
            })
        })
        .manage(Computer::default())
        .setup(|app| {
            let config = &app.config().app.windows[0];
            let app_url = if tauri::is_dev() {
                app.config().build.dev_url.clone().ok_or("there is no dev URL")?
            } else {
                tauri::Url::parse("tauri://localhost")?
            };
            let window = tauri::WebviewWindowBuilder::from_config(app, config)?
                .on_navigation(move |url| plugin_frame::navigation(url, &app_url))
                .build()?;
            app.manage(frame::open(&window));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            vm_start,
            vm_stop,
            vm_status,
            vm_frame,
            device_name,
            frame::window_buttons,
            frame::window_drag,
            frame::window_minimize,
            frame::window_toggle_maximize,
            frame::window_close,
            frame::window_tint
        ])
        .build(tauri::generate_context!())
        .expect("failed to start Snowpaw")
        .run(|app, event| {
            if let RunEvent::Exit = event {
                app.state::<Computer>().stop(true);
            }
        });
}

/// These run the real QEMU and are skipped where it cannot run.
#[cfg(test)]
mod tests {
    use super::*;
    use std::thread;
    use std::time::Duration;

    fn machine() -> io::Result<Vm> {
        Vm::spawn(None)?.connect()
    }

    #[test]
    fn a_start_takes_the_place_and_a_second_is_not_needed() {
        if !vm::can_run_here() {
            return;
        }
        let computer = Computer::default();
        assert_eq!(computer.status(), "off");
        let ticket = computer.begin_start().unwrap().expect("nothing is running yet");
        assert_eq!(computer.status(), "starting");
        assert_eq!(computer.finish_start(ticket, machine()), Ok(()));
        assert_eq!(computer.status(), "on");
        assert_eq!(computer.begin_start(), Ok(None));
        assert!(computer.stop(false));
        assert_eq!(computer.status(), "off");
    }

    #[test]
    fn a_second_start_is_refused_while_one_is_under_way() {
        let computer = Computer::default();
        let ticket = computer.begin_start().unwrap().unwrap();
        assert!(computer.begin_start().is_err());
        assert!(computer.running().is_none(), "nothing is running yet");
        assert_eq!(computer.status(), "starting", "but the place is not reported as free");

        // A start that fails gives the place back.
        assert!(computer.finish_start(ticket, Err(io::Error::other("no machine"))).is_err());
        assert_eq!(computer.status(), "off");
        assert!(computer.begin_start().unwrap().is_some());
    }

    #[test]
    fn a_stop_during_a_start_waits_for_it_and_cancels_it() {
        if !vm::can_run_here() {
            return;
        }
        let computer = Computer::default();
        let ticket = computer.begin_start().unwrap().unwrap();
        thread::scope(|scope| {
            let stopping = scope.spawn(|| computer.stop(false));
            thread::sleep(Duration::from_millis(100));
            assert!(!stopping.is_finished(), "the stop waits for the start to settle");
            assert!(computer.begin_start().is_err(), "and nothing else starts meanwhile");

            assert!(computer.finish_start(ticket, machine()).is_err(), "the machine came up too late");
            assert!(stopping.join().unwrap());
        });
        assert!(computer.running().is_none(), "the late machine was ended, not kept");
        // A later start is unaffected.
        let ticket = computer.begin_start().unwrap().unwrap();
        assert_eq!(computer.finish_start(ticket, machine()), Ok(()));
    }

    #[test]
    fn closing_stops_the_machine_and_refuses_every_later_start() {
        if !vm::can_run_here() {
            return;
        }
        let computer = Computer::default();
        let ticket = computer.begin_start().unwrap().unwrap();
        computer.finish_start(ticket, machine()).unwrap();
        let running = computer.running().unwrap();
        assert!(computer.stop(true));
        assert!(running.has_exited());
        assert!(computer.begin_start().is_err());

        // Closing does not wait for a start that is under way, and that
        // start's machine is ended when it arrives.
        let computer = Computer::default();
        let ticket = computer.begin_start().unwrap().unwrap();
        assert!(computer.stop(true));
        assert!(computer.finish_start(ticket, machine()).is_err());
        assert!(computer.running().is_none());
    }

    #[test]
    fn ending_a_failed_machine_leaves_its_replacement() {
        if !vm::can_run_here() {
            return;
        }
        let computer = Computer::default();
        let ticket = computer.begin_start().unwrap().unwrap();
        computer.finish_start(ticket, machine()).unwrap();
        let old = computer.running().unwrap();
        assert!(computer.stop(false));
        let ticket = computer.begin_start().unwrap().unwrap();
        computer.finish_start(ticket, machine()).unwrap();

        assert!(computer.end(&old));
        assert!(computer.running().is_some_and(|current| !Arc::ptr_eq(&current, &old)));
    }
}
