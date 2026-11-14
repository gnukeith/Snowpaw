// Do not open a console window next to the app on Windows release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod qmp;
mod vm;

use std::sync::{Mutex, MutexGuard, PoisonError};
use tauri::ipc::Response;
use tauri::{Manager, RunEvent, State};
use vm::Vm;

/// The one virtual machine the app can run. `None` while it is off.
type Computer = Mutex<Option<Vm>>;

// The commands below are the whole surface the webview gets. None takes an
// argument: paths, QEMU options and control messages are all decided in Rust.
// Details of a failure go to the log, and the webview gets a fixed sentence.

/// Not `async`, so it runs on the main thread, which lives as long as the app.
/// See `Vm::start`.
#[tauri::command]
fn vm_start(computer: State<Computer>) -> Result<(), &'static str> {
    let mut slot = lock(&computer);
    if slot.as_mut().is_some_and(|vm| !vm.has_exited()) {
        return Ok(());
    }
    // Clear out a machine that died by itself before starting another.
    *slot = None;
    *slot = Some(Vm::start().map_err(|error| {
        eprintln!("vm_start: {error}");
        "The computer could not be started."
    })?);
    Ok(())
}

#[tauri::command(async)]
fn vm_stop(computer: State<Computer>) {
    *lock(&computer) = None;
}

/// Whether the computer is running.
#[tauri::command(async)]
fn vm_status(computer: State<Computer>) -> bool {
    lock(&computer).as_mut().is_some_and(|vm| !vm.has_exited())
}

/// The guest's screen as PNG bytes.
#[tauri::command(async)]
fn vm_frame(computer: State<Computer>) -> Result<Response, &'static str> {
    let mut slot = lock(&computer);
    let vm = slot.as_mut().ok_or("The computer is off.")?;
    vm.frame().map(Response::new).map_err(|error| {
        eprintln!("vm_frame: {error}");
        "The screen could not be read."
    })
}

fn lock(computer: &Computer) -> MutexGuard<'_, Option<Vm>> {
    // A panic in one command must not leave the machine impossible to stop.
    computer.lock().unwrap_or_else(PoisonError::into_inner)
}

fn main() {
    tauri::Builder::default()
        .manage(Computer::default())
        .invoke_handler(tauri::generate_handler![vm_start, vm_stop, vm_status, vm_frame])
        .build(tauri::generate_context!())
        .expect("failed to start Snowpaw")
        .run(|app, event| {
            if let RunEvent::Exit = event {
                *lock(&app.state::<Computer>()) = None;
            }
        });
}
