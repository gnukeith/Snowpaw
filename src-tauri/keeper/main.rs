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
//! 3. It starts the machine and exits when the machine does, or when the
//!    connection ends because the app closed it or died.
//!
//! build.rs compiles this file on its own and vm.rs carries it inside the
//! app. It uses the standard library and nothing else.

use std::env;
use std::io::Read;
use std::os::unix::net::UnixStream;
use std::process::{Command, exit};
use std::thread;

unsafe extern "C" {
    fn prctl(option: i32, ...) -> i32;
}
const PR_SET_DUMPABLE: i32 = 4;

fn main() {
    // Nothing else in the sandbox may attach to this process or write to its
    // memory. Safety: a system call that takes no pointers.
    if unsafe { prctl(PR_SET_DUMPABLE, 0u64) } != 0 {
        exit(101);
    }
    let mut arguments = env::args_os().skip(1);
    let (Some(socket), Some(machine)) = (arguments.next(), arguments.next()) else { exit(102) };
    let Ok(mut app) = UnixStream::connect(socket) else { exit(103) };
    // One byte means go. Anything else means the app is not there any more.
    if !matches!(app.read(&mut [0]), Ok(1)) {
        exit(104);
    }
    let Ok(mut machine) = Command::new(machine).args(arguments).spawn() else { exit(105) };
    thread::spawn(move || {
        let _ = machine.wait();
        exit(0)
    });
    // The app sends nothing more, so this returns when the connection ends.
    let _ = app.read(&mut [0]);
    exit(0)
}
