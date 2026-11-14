//! The keeper: the first process inside a machine's sandbox, and the reason
//! a machine cannot outlive the app.
//!
//! It is started by bubblewrap as process 1 of the sandbox's own process
//! numbering. Linux ends every process in such a sandbox the moment its
//! process 1 exits, and does not let the others kill or stop it. So the
//! machine lives exactly as long as this program does, and this program
//! lives exactly as long as its connection to the app:
//!
//! 1. It connects to the socket the app listens on. No app, no machine.
//! 2. It waits for the app to say go, which the app does once it holds a
//!    handle on this process. Until then no guest runs.
//! 3. It starts the machine and exits when the machine does, when the app
//!    closes the connection, or when the app's process ends.
//!
//! The app's process is watched as well as the connection because a
//! connection stays open for as long as any process holds it, and a child
//! the app once forked could hold it after the app is gone.
//!
//! build.rs compiles this file on its own and vm.rs carries it inside the
//! app. It uses the standard library and nothing else, so the few system
//! calls the library does not offer are declared here, with their Linux
//! numbers for x86-64 and arm64.

use std::env;
use std::io::Read;
use std::os::fd::AsRawFd;
use std::os::unix::net::UnixStream;
use std::process::{Command, exit};
use std::thread;

unsafe extern "C" {
    fn prctl(option: i32, ...) -> i32;
    fn getsockopt(socket: i32, level: i32, name: i32, value: *mut i32, size: *mut u32) -> i32;
    fn poll(waits: *mut Wait, count: u64, timeout: i32) -> i32;
}
const PR_SET_DUMPABLE: i32 = 4;
const SOL_SOCKET: i32 = 1;
const SO_PEERPIDFD: i32 = 77;
const POLLIN: i16 = 1;

/// `struct pollfd`.
#[repr(C)]
struct Wait {
    fd: i32,
    events: i16,
    revents: i16,
}

/// Waits until the app sends something or is gone. True only if the app's
/// process is still there and its connection has something to read.
fn app_spoke(app: &UnixStream, app_process: i32) -> bool {
    let mut waits = [
        Wait { fd: app.as_raw_fd(), events: POLLIN, revents: 0 },
        Wait { fd: app_process, events: POLLIN, revents: 0 },
    ];
    // Safety: `waits` is two valid entries for the length of the call.
    let woken = unsafe { poll(waits.as_mut_ptr(), 2, -1) };
    woken > 0 && waits[0].revents == POLLIN && waits[1].revents == 0
}

fn main() {
    // Nothing else in the sandbox may attach to this process or write to its
    // memory. Safety: a system call that takes no pointers.
    if unsafe { prctl(PR_SET_DUMPABLE, 0u64) } != 0 {
        exit(101);
    }
    let mut arguments = env::args_os().skip(1);
    let (Some(socket), Some(machine)) = (arguments.next(), arguments.next()) else { exit(102) };
    let Ok(mut app) = UnixStream::connect(socket) else { exit(103) };
    // A handle on the process that listens on that socket: the app itself.
    let (mut app_process, mut size) = (-1, 4);
    // Safety: both pointers are valid for the call and describe each other.
    if unsafe { getsockopt(app.as_raw_fd(), SOL_SOCKET, SO_PEERPIDFD, &mut app_process, &mut size) } != 0 {
        exit(106);
    }
    // One byte means go. Anything else means the app is not there any more.
    if !app_spoke(&app, app_process) || !matches!(app.read(&mut [0]), Ok(1)) {
        exit(104);
    }
    let Ok(mut machine) = Command::new(machine).args(arguments).spawn() else { exit(105) };
    thread::spawn(move || {
        let _ = machine.wait();
        exit(0)
    });
    // The app sends nothing more, so whatever ends this wait ends the machine.
    app_spoke(&app, app_process);
    exit(0)
}
