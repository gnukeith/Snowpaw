// Do not open a console window next to the app on Windows release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod qmp;
mod vm;

use std::io;
use std::sync::{Arc, Mutex, MutexGuard, PoisonError, mpsc};
use std::time::Duration;
use tauri::ipc::Response;
use tauri::{AppHandle, Manager, RunEvent, State};
use vm::Vm;

/// How long the main thread gets to spawn QEMU once asked.
const SPAWN_TIMEOUT: Duration = Duration::from_secs(5);

/// The one virtual machine the app can run. The lock is held only for a
/// moment, never across a capture or a start, so stopping is always possible.
#[derive(Default)]
struct Computer(Mutex<Slot>);

#[derive(Default)]
struct Slot {
    /// `None` while the machine is off.
    vm: Option<Arc<Vm>>,
    /// Goes up on every stop, so a start that was under way can tell that it
    /// has been cancelled.
    stops: u64,
    /// Set when the app is exiting. Nothing may start after that.
    closed: bool,
}

impl Slot {
    /// The running machine, if there is one. A machine that died is cleared.
    fn running(&mut self) -> Option<Arc<Vm>> {
        if self.vm.as_ref().is_some_and(|vm| vm.has_exited()) {
            self.vm = None;
        }
        self.vm.clone()
    }
}

impl Computer {
    fn lock(&self) -> MutexGuard<'_, Slot> {
        // A panic in one command must not leave the machine impossible to stop.
        self.0.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// Decides whether a start should go ahead. `Ok(None)` means a machine is
    /// already running; `Ok(Some(ticket))` is handed back to `finish_start`.
    fn begin_start(&self) -> Result<Option<u64>, &'static str> {
        let mut slot = self.lock();
        if slot.closed {
            return Err("Snowpaw is closing.");
        }
        Ok(slot.running().is_none().then_some(slot.stops))
    }

    /// Publishes a machine that has come up, unless a stop or the app's exit
    /// arrived in the meantime. A machine that is not published is dropped,
    /// which kills it.
    fn finish_start(&self, ticket: u64, vm: Vm) -> Result<(), &'static str> {
        let mut slot = self.lock();
        if slot.closed || slot.stops != ticket {
            return Err("The computer was stopped while it was starting.");
        }
        // If another start got there first, keep that machine.
        if slot.running().is_none() {
            slot.vm = Some(Arc::new(vm));
        }
        Ok(())
    }

    /// Ends the machine and cancels any start under way. With `closing`, also
    /// refuses every later start.
    fn stop(&self, closing: bool) {
        let vm = {
            let mut slot = self.lock();
            slot.stops += 1;
            slot.closed |= closing;
            slot.vm.take()
        };
        if let Some(vm) = vm {
            vm.kill();
        }
    }

    /// Ends `failed` and clears it, leaving alone a newer machine that may
    /// have replaced it.
    fn discard(&self, failed: &Arc<Vm>) {
        failed.kill();
        let mut slot = self.lock();
        if slot.vm.as_ref().is_some_and(|current| Arc::ptr_eq(current, failed)) {
            slot.vm = None;
        }
    }
}

// The commands below are the whole surface the webview gets. None takes an
// argument: paths, QEMU options and control messages are all decided in Rust.
// Details of a failure go to the log, and the webview gets a fixed sentence.

#[tauri::command(async)]
fn vm_start(app: AppHandle, computer: State<Computer>) -> Result<(), &'static str> {
    let Some(ticket) = computer.begin_start()? else {
        return Ok(());
    };
    let vm = start(&app).map_err(|error| {
        eprintln!("vm_start: {error}");
        "The computer could not be started."
    })?;
    computer.finish_start(ticket, vm)
}

fn start(app: &AppHandle) -> io::Result<Vm> {
    // QEMU has to be spawned from the main thread (see `Vm::spawn`). Waiting
    // for it to come up happens here, so the window stays responsive.
    let (send, receive) = mpsc::channel();
    app.run_on_main_thread(move || {
        // If nobody is waiting any more, the machine is dropped, which kills it.
        let _ = send.send(Vm::spawn());
    })
    .map_err(io::Error::other)?;
    receive.recv_timeout(SPAWN_TIMEOUT).map_err(io::Error::other)??.connect()
}

#[tauri::command(async)]
fn vm_stop(computer: State<Computer>) {
    computer.stop(false);
}

/// Whether the computer is running.
#[tauri::command(async)]
fn vm_status(computer: State<Computer>) -> bool {
    computer.lock().running().is_some()
}

/// The guest's screen as PNG bytes.
#[tauri::command(async)]
fn vm_frame(computer: State<Computer>) -> Result<Response, &'static str> {
    let running = computer.lock().running();
    let vm = running.ok_or("The computer is no longer running.")?;
    vm.frame().map(Response::new).map_err(|error| {
        eprintln!("vm_frame: {error}");
        // A machine whose screen cannot be read is ended here and now. Its
        // control connection may be out of step, and the webview that would
        // otherwise ask for the stop may already have moved on.
        computer.discard(&vm);
        "The screen could not be read, so the computer was stopped."
    })
}

fn main() {
    tauri::Builder::default()
        .manage(Computer::default())
        .invoke_handler(tauri::generate_handler![vm_start, vm_stop, vm_status, vm_frame])
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

    fn machine() -> Vm {
        Vm::spawn().unwrap().connect().unwrap()
    }

    #[test]
    fn a_start_publishes_a_machine_and_a_second_start_is_not_needed() {
        if !vm::can_run_here() {
            return;
        }
        let computer = Computer::default();
        let ticket = computer.begin_start().unwrap().expect("nothing is running yet");
        assert_eq!(computer.finish_start(ticket, machine()), Ok(()));
        assert!(computer.lock().running().is_some());
        assert_eq!(computer.begin_start(), Ok(None));
    }

    #[test]
    fn a_stop_during_a_start_cancels_it() {
        if !vm::can_run_here() {
            return;
        }
        let computer = Computer::default();
        let ticket = computer.begin_start().unwrap().unwrap();
        // The stop finds nothing to end, because the machine is still coming up.
        computer.stop(false);
        assert!(computer.finish_start(ticket, machine()).is_err());
        assert!(computer.lock().running().is_none(), "the late machine is not published");
        // A later start is unaffected.
        let ticket = computer.begin_start().unwrap().unwrap();
        assert_eq!(computer.finish_start(ticket, machine()), Ok(()));
    }

    #[test]
    fn two_overlapping_starts_leave_one_machine() {
        if !vm::can_run_here() {
            return;
        }
        let computer = Computer::default();
        let first = computer.begin_start().unwrap().unwrap();
        let second = computer.begin_start().unwrap().unwrap();
        assert_eq!(computer.finish_start(first, machine()), Ok(()));
        let kept = computer.lock().running().unwrap();
        assert_eq!(computer.finish_start(second, machine()), Ok(()));
        assert!(Arc::ptr_eq(&kept, &computer.lock().running().unwrap()));
    }

    #[test]
    fn closing_stops_the_machine_and_refuses_every_later_start() {
        if !vm::can_run_here() {
            return;
        }
        let computer = Computer::default();
        let ticket = computer.begin_start().unwrap().unwrap();
        computer.finish_start(ticket, machine()).unwrap();
        let running = computer.lock().running().unwrap();

        let pending = computer.begin_start();
        computer.stop(true);
        assert!(running.has_exited());
        assert!(computer.begin_start().is_err());
        assert!(computer.finish_start(pending.unwrap().unwrap_or(0), machine()).is_err());
        assert!(computer.lock().running().is_none());
    }

    #[test]
    fn discarding_a_failed_machine_leaves_its_replacement() {
        if !vm::can_run_here() {
            return;
        }
        let computer = Computer::default();
        let ticket = computer.begin_start().unwrap().unwrap();
        computer.finish_start(ticket, machine()).unwrap();
        let old = computer.lock().running().unwrap();
        computer.stop(false);
        let ticket = computer.begin_start().unwrap().unwrap();
        computer.finish_start(ticket, machine()).unwrap();

        computer.discard(&old);
        assert!(computer.lock().running().is_some_and(|current| !Arc::ptr_eq(&current, &old)));
    }
}
