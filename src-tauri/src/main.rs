// Do not open a console window next to the app on Windows release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod qmp;
mod vm;

use std::io;
use std::sync::{Arc, Mutex, MutexGuard, PoisonError, TryLockError, mpsc};
use tauri::ipc::Response;
use tauri::{AppHandle, Manager, RunEvent, State};
use vm::Vm;

/// The one virtual machine the app can run.
#[derive(Default)]
struct Computer {
    /// `None` while the machine is off. Held only for a moment, never across
    /// a capture, so stopping is always possible.
    vm: Mutex<Option<Arc<Vm>>>,
    /// Held for the length of a start, so two starts cannot overlap.
    starting: Mutex<()>,
}

impl Computer {
    /// The running machine, if there is one. A machine that died is cleared.
    fn running(&self) -> Option<Arc<Vm>> {
        let mut slot = lock(&self.vm);
        if slot.as_ref().is_some_and(|vm| vm.has_exited()) {
            *slot = None;
        }
        slot.clone()
    }

    fn stop(&self) {
        if let Some(vm) = lock(&self.vm).take() {
            vm.kill();
        }
    }
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    // A panic in one command must not leave the machine impossible to stop.
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

// The commands below are the whole surface the webview gets. None takes an
// argument: paths, QEMU options and control messages are all decided in Rust.
// Details of a failure go to the log, and the webview gets a fixed sentence.

#[tauri::command(async)]
fn vm_start(app: AppHandle, computer: State<Computer>) -> Result<(), &'static str> {
    let _starting = match computer.starting.try_lock() {
        Ok(guard) => guard,
        Err(TryLockError::Poisoned(poisoned)) => poisoned.into_inner(),
        Err(TryLockError::WouldBlock) => return Err("The computer is already starting."),
    };
    if computer.running().is_some() {
        return Ok(());
    }
    let vm = start(&app).map_err(|error| {
        eprintln!("vm_start: {error}");
        "The computer could not be started."
    })?;
    *lock(&computer.vm) = Some(Arc::new(vm));
    Ok(())
}

fn start(app: &AppHandle) -> io::Result<Vm> {
    // QEMU has to be spawned from the main thread (see `Vm::spawn`). Waiting
    // for it to come up happens here, so the window stays responsive.
    let (send, receive) = mpsc::channel();
    app.run_on_main_thread(move || {
        let _ = send.send(Vm::spawn());
    })
    .map_err(io::Error::other)?;
    receive.recv().map_err(io::Error::other)??.connect()
}

#[tauri::command(async)]
fn vm_stop(computer: State<Computer>) {
    computer.stop();
}

/// Whether the computer is running.
#[tauri::command(async)]
fn vm_status(computer: State<Computer>) -> bool {
    computer.running().is_some()
}

/// The guest's screen as PNG bytes.
#[tauri::command(async)]
fn vm_frame(computer: State<Computer>) -> Result<Response, &'static str> {
    let vm = computer.running().ok_or("The computer is no longer running.")?;
    vm.frame().map(Response::new).map_err(|error| {
        eprintln!("vm_frame: {error}");
        // A machine whose screen cannot be read is ended here and now. Its
        // control connection may be out of step, and the webview that would
        // otherwise ask for the stop may already have moved on.
        vm.kill();
        let mut slot = lock(&computer.vm);
        if slot.as_ref().is_some_and(|current| Arc::ptr_eq(current, &vm)) {
            *slot = None;
        }
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
                app.state::<Computer>().stop();
            }
        });
}
