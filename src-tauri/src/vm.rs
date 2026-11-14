//! The agent's computer: one QEMU virtual machine, run in a sandbox as a
//! child of the app.
//!
//! What this does and does not protect against. The guest has no network
//! card, no shared folder, no clipboard and no USB, and its only disc is
//! read-only. QEMU itself runs inside bubblewrap, so a bug that lets the
//! guest escape QEMU lands in a place with no home directory, no desktop
//! session, no network, and nothing the app has open except the boot disc
//! and the control socket. It can still read the system's programs under
//! /usr, write to its session directory, lie to the app over the control
//! socket and in the screen captures, use /dev/kvm and call the kernel.
//! Nothing limits its memory or processor use yet. QEMU's own seccomp
//! filter stays on as a second layer.
//!
//! How a machine is kept from outliving the app. Two things hold it, and
//! each covers the other's gap:
//!
//! - QEMU does not open a control socket, it connects to one the app
//!   listens on, and exits at once if nobody is listening. So a machine
//!   cannot come up after the app has died or has given up on the start.
//! - bubblewrap, the sandbox's first process and QEMU are each told to die
//!   when their parent does. That chain is only complete once the sandbox
//!   is set up, which is why the socket has to cover the time before.

use crate::qmp::Qmp;
use serde_json::json;
use std::fs::{self, DirBuilder, File, OpenOptions};
use std::io::{self, PipeReader, Read};
use std::os::fd::{AsRawFd, FromRawFd, OwnedFd};
use std::os::unix::fs::{DirBuilderExt, MetadataExt, OpenOptionsExt};
use std::os::unix::net::UnixListener;
use std::os::unix::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Mutex, MutexGuard, PoisonError};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

/// Fixed absolute paths, so a changed PATH cannot swap in another program.
const BWRAP: &str = "/usr/bin/bwrap";
const QEMU: &str = "/usr/bin/qemu-system-x86_64";
/// Where the session directory and the boot disc appear inside the sandbox.
const SANDBOX_DIR: &str = "/session";
const SANDBOX_DISC: &str = "/disc";
const CONTROL_SOCKET: &str = "qmp.sock";
/// The machine, with every built-in device it can do without switched off:
/// each emulated device is code the guest can attack.
const MACHINE: &str = "q35,usb=off,sata=off,smbus=off,i8042=off,hpet=off,vmport=off";
/// What the guest gets. A desktop is not usable with much less.
const MEMORY_MB: &str = "4096";
const PROCESSORS: &str = "4";
/// The kernel's limit on a unix socket path, including its closing zero byte.
const MAX_SOCKET_PATH: usize = 108;

/// The most bubblewrap's report on the sandbox it created may take up.
const MAX_REPORT: usize = 4096;

/// How long the sandbox gets to come up and QEMU to connect to the app.
const START_TIMEOUT: Duration = Duration::from_secs(5);
/// How long the kernel gets to finish off a sandbox that has been killed.
const TEARDOWN_TIMEOUT: Duration = Duration::from_secs(5);
/// How long the control handshake, and then any one control command, may take.
const CONTROL_TIMEOUT: Duration = Duration::from_secs(5);
/// Screen captures are full PNG encodes inside QEMU; do not allow them back to back.
const MIN_FRAME_INTERVAL: Duration = Duration::from_millis(400);

/// Limits on a frame handed to the webview. The guest picks its own
/// resolution, so these are enforced here and not assumed.
const MAX_FRAME_BYTES: u64 = 16 * 1024 * 1024;
const MAX_FRAME_WIDTH: u32 = 1920;
const MAX_FRAME_HEIGHT: u32 = 1080;

/// A running machine. Share it between threads: `kill` never waits for a
/// capture that another thread has in progress.
pub struct Vm {
    process: Process,
    screen: Mutex<Screen>,
}

/// A machine whose sandbox has been started but which has not connected to
/// the app yet. Dropping it ends whatever exists of the machine.
pub struct Spawned {
    // Fields are dropped in this order, and it matters: the socket has to
    // close before bubblewrap is killed (see `Process::kill`).
    control: UnixListener,
    report: PipeReader,
    process: Process,
}

struct Screen {
    qmp: Qmp,
    frames: u64,
    last_frame: Option<Instant>,
}

/// The sandbox with QEMU in it, and its private directory. Dropping it ends
/// the sandbox, and removes the directory once the sandbox is proven gone.
struct Process {
    /// bubblewrap, which exits when QEMU does.
    child: Mutex<Child>,
    /// The first process inside the sandbox, once bubblewrap has named it.
    /// The kernel does not let it finish dying until every other process in
    /// the sandbox is gone, so its end is the proof that nothing is left.
    first: Option<OwnedFd>,
    dir: PathBuf,
}

impl Process {
    /// Kills everything in the sandbox and waits for it to be gone. Safe to
    /// call more than once. False if the sandbox outlived the wait.
    fn kill(&self) -> bool {
        let mut child = lock(&self.child);
        // Kill, do not ask: this has to work when QEMU has stopped answering.
        let _ = child.kill();
        let _ = child.wait();
        let Some(first) = &self.first else {
            // The sandbox was never identified, so there is nothing to wait
            // on. What is left of it cannot become a machine: only a
            // `Spawned` gets here, its socket is already closed, and QEMU
            // exits when it cannot connect.
            return true;
        };
        // bubblewrap's death takes the sandbox with it only once the sandbox
        // is fully set up, so its first process is killed directly as well.
        let no_details = std::ptr::null::<libc::siginfo_t>();
        // Safety: a system call on a descriptor this struct owns.
        unsafe { libc::syscall(libc::SYS_pidfd_send_signal, first.as_raw_fd(), libc::SIGKILL, no_details, 0) };
        readable(first, TEARDOWN_TIMEOUT)
    }

    /// Whether bubblewrap is still there. It is not proof of anything about
    /// the sandbox: for that, see `first`.
    fn has_bubblewrap(&self) -> bool {
        matches!(lock(&self.child).try_wait(), Ok(None))
    }
}

impl Drop for Process {
    fn drop(&mut self) {
        if self.kill() {
            let _ = fs::remove_dir_all(&self.dir);
        } else {
            // Left in place: something may still be writing to it.
            eprintln!("vm: the sandbox did not end, leaving {}", self.dir.display());
        }
    }
}

impl Vm {
    /// Starts QEMU in its sandbox, without waiting for either to come up.
    ///
    /// `disc` is an image for the guest to boot from. The guest cannot write
    /// to it. Without one the machine is empty.
    ///
    /// Call this from a thread that lives as long as the app: the sandbox is
    /// told to die with its parent, and Linux ties that to the spawning thread.
    pub fn spawn(disc: Option<&File>) -> io::Result<Spawned> {
        let dir = session_dir()?;
        // Listening before QEMU exists, so that it never finds nobody there.
        let started = UnixListener::bind(dir.join(CONTROL_SOCKET)).and_then(|control| Ok((control, sandbox(&dir, disc)?)));
        match started {
            Ok((control, (child, report))) => {
                Ok(Spawned { control, report, process: Process { child: Mutex::new(child), first: None, dir } })
            }
            Err(error) => {
                let _ = fs::remove_dir_all(&dir);
                Err(error)
            }
        }
    }

    /// Ends the machine at once, without asking the guest or QEMU, and waits
    /// until nothing in its sandbox is left. False if that could not be
    /// confirmed in time: the machine may then still be running.
    pub fn kill(&self) -> bool {
        self.process.kill()
    }

    /// True once the machine is gone, whatever the reason: nothing in its
    /// sandbox is left running.
    pub fn has_exited(&self) -> bool {
        self.process.first.as_ref().is_some_and(|first| readable(first, Duration::ZERO))
    }

    /// Captures the guest's screen as a PNG. One capture runs at a time.
    pub fn frame(&self) -> io::Result<Vec<u8>> {
        let mut screen = lock(&self.screen);
        if let Some(last) = screen.last_frame {
            thread::sleep(MIN_FRAME_INTERVAL.saturating_sub(last.elapsed()));
        }
        screen.last_frame = Some(Instant::now());

        // A new name every time: QEMU overwrites an existing file and follows
        // symlinks when it writes, so a name is never reused.
        screen.frames += 1;
        let name = format!("frame-{}.png", screen.frames);
        let path = self.process.dir.join(&name);
        let captured = screen.qmp.execute("screendump", json!({ "filename": name, "format": "png" }));
        let bytes = captured.and_then(|_| read_frame(&path));
        let _ = fs::remove_file(&path);

        let bytes = bytes?;
        png_size(&bytes)?;
        Ok(bytes)
    }
}

impl Spawned {
    /// Waits for the sandbox to come up and for QEMU to connect to the app.
    /// This can take seconds, so do it off the thread that called `Vm::spawn`.
    pub fn connect(mut self) -> io::Result<Vm> {
        let deadline = Instant::now() + START_TIMEOUT;
        let bubblewrap = lock(&self.process.child).id();
        self.process.first = Some(first_process(&mut self.report, bubblewrap, deadline)?);
        let stream = loop {
            let arrived = readable(&self.control, Duration::from_millis(20));
            // Checked even when QEMU has connected. If bubblewrap died while
            // the sandbox was being set up, the sandbox no longer dies with
            // the app, so it must not be accepted as a machine.
            if !self.process.has_bubblewrap() {
                return Err(io::Error::other("the sandbox ended while starting"));
            }
            if arrived {
                break self.control.accept()?.0;
            }
            if Instant::now() > deadline {
                return Err(io::ErrorKind::TimedOut.into());
            }
        };
        let qmp = Qmp::connect(stream, CONTROL_TIMEOUT)?;
        Ok(Vm { process: self.process, screen: Mutex::new(Screen { qmp, frames: 0, last_frame: None }) })
    }
}

/// Starts bubblewrap with QEMU as its payload. Also returns the pipe on
/// which bubblewrap reports the sandbox it creates.
fn sandbox(dir: &Path, disc: Option<&File>) -> io::Result<(Child, PipeReader)> {
    let (report, report_end) = io::pipe()?;
    let report_fd = report_end.as_raw_fd();
    let disc_fd = disc.map(AsRawFd::as_raw_fd);

    let mut command = Command::new(BWRAP);
    command
        // Its own users, processes, network (none), shared memory and host name.
        .args(["--unshare-user", "--unshare-pid", "--unshare-net", "--unshare-ipc", "--unshare-uts"])
        .args(["--hostname", "computer", "--disable-userns", "--cap-drop", "ALL", "--new-session"])
        // Killing bubblewrap, or the app dying, ends everything inside.
        .arg("--die-with-parent")
        // All it can see: the system's programs, a few device nodes, and its
        // session directory. No /home, no /run, no /proc, no /tmp.
        .args(["--ro-bind", "/usr", "/usr", "--symlink", "usr/lib64", "/lib64"])
        .args(["--dev", "/dev", "--dev-bind", "/dev/kvm", "/dev/kvm"])
        .arg("--bind")
        .arg(dir)
        .args([SANDBOX_DIR, "--chdir", SANDBOX_DIR])
        .args(["--json-status-fd", &report_fd.to_string()]);
    if let Some(fd) = disc_fd {
        // Bound by descriptor, so the guest gets the file that was opened
        // and checked, whatever happens to its path afterwards.
        command.args(["--ro-bind-fd", &fd.to_string(), SANDBOX_DISC]);
        let file = json!({ "driver": "file", "filename": SANDBOX_DISC, "read-only": true, "node-name": "disc" });
        command.args(["--", QEMU, "-blockdev", &file.to_string()]);
        command.args(["-device", "virtio-blk-pci,drive=disc,bootindex=0"]);
    } else {
        command.args(["--", QEMU]);
    }
    command
        .args(["-accel", "kvm", "-machine", MACHINE, "-cpu", "host", "-m", MEMORY_MB, "-smp", PROCESSORS])
        // Nothing is added by default: no network card, no audio, no USB.
        .args(["-nodefaults", "-no-user-config", "-nic", "none"])
        // The screen is read through the control socket, never shown or served by QEMU.
        .args(["-display", "none", "-vga", "virtio"])
        // QEMU connects to the app, and exits if the app is not listening.
        // A relative path: QEMU runs inside the session directory.
        .args(["-qmp", &format!("unix:{CONTROL_SOCKET}")])
        .args(["-sandbox", "on,obsolete=deny,elevateprivileges=deny,spawn=deny,resourcecontrol=deny"])
        .args(["-run-with", "exit-with-parent=on"])
        .env_clear()
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    // Safety: the closure runs between fork and exec and makes only raw
    // system calls, which is all that is allowed there.
    unsafe {
        command.pre_exec(move || {
            // Leave behind every descriptor the app has open, whoever opened
            // it, except the two bubblewrap is meant to receive.
            let all_from_3 = libc::close_range(3, libc::c_uint::MAX, libc::CLOSE_RANGE_CLOEXEC as libc::c_int);
            let passed_on = [Some(report_fd), disc_fd].into_iter().flatten();
            if all_from_3 == 0 && passed_on.fold(true, |ok, fd| ok && libc::fcntl(fd, libc::F_SETFD, 0) == 0) {
                Ok(())
            } else {
                Err(io::Error::last_os_error())
            }
        });
    }
    // `report_end` closes on return, so the pipe ends if bubblewrap dies
    // without reporting.
    Ok((command.spawn()?, report))
}

/// Reads which process bubblewrap made the first one in the sandbox, and
/// takes a handle to it that stays valid whatever happens to its number.
fn first_process(report: &mut PipeReader, bubblewrap: u32, deadline: Instant) -> io::Result<OwnedFd> {
    // bubblewrap writes its report in pieces, so read until the line is whole.
    let mut line = Vec::new();
    while !line.contains(&b'\n') {
        let mut piece = [0; 256];
        if !readable(report, deadline.saturating_duration_since(Instant::now())) {
            return Err(io::ErrorKind::TimedOut.into());
        }
        let read = report.read(&mut piece)?;
        line.extend_from_slice(&piece[..read]);
        if read == 0 || line.len() > MAX_REPORT {
            return Err(io::Error::other("bubblewrap did not create the sandbox"));
        }
    }
    let line = line.split(|&byte| byte == b'\n').next().unwrap_or_default();
    let pid = serde_json::from_slice::<serde_json::Value>(line).ok().and_then(|report| report["child-pid"].as_u64());
    let pid = pid.and_then(|pid| libc::pid_t::try_from(pid).ok());
    let pid = pid.ok_or_else(|| io::Error::other("bubblewrap's report could not be read"))?;
    // Safety: a system call that returns a new descriptor or -1.
    let handle = unsafe { libc::syscall(libc::SYS_pidfd_open, pid, 0) };
    if handle < 0 {
        return Err(io::Error::last_os_error());
    }
    // Safety: the descriptor was just created and nothing else owns it.
    let first = unsafe { OwnedFd::from_raw_fd(handle as libc::c_int) };

    // A number can pass to another process once its owner is gone. The handle
    // will be used to kill, so make sure it is on bubblewrap's own child, the
    // first process of a sandbox, before anything can use it.
    let status = fs::read_to_string(format!("/proc/{pid}/status"))?;
    let field = |name: &str| status.lines().find_map(|line| line.strip_prefix(name)).map(str::trim);
    let is_child = field("PPid:") == Some(bubblewrap.to_string().as_str());
    let is_first = field("NSpid:").is_some_and(|ids| ids.split_whitespace().last() == Some("1"));
    if is_child && is_first { Ok(first) } else { Err(io::Error::other("the sandbox could not be identified")) }
}

/// Waits until `fd` has something to read or has reached its end. For a
/// process handle that means the process has ended.
fn readable(fd: &impl AsRawFd, timeout: Duration) -> bool {
    let mut wait = libc::pollfd { fd: fd.as_raw_fd(), events: libc::POLLIN, revents: 0 };
    let deadline = Instant::now() + timeout;
    loop {
        let left = deadline.saturating_duration_since(Instant::now()).as_millis() as libc::c_int;
        // Safety: `wait` is one valid pollfd for the length of the call.
        match unsafe { libc::poll(&mut wait, 1, left) } {
            1 => return true,
            0 => return false,
            // Interrupted by a signal: wait for what is left of the time.
            _ if io::Error::last_os_error().kind() == io::ErrorKind::Interrupted => {}
            _ => return false,
        }
    }
}

/// Locks a mutex whether or not a thread panicked while holding it. Every use
/// here must keep working after a panic so the machine can still be killed.
fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

/// Creates this session's directory, readable by the current user only.
fn session_dir() -> io::Result<PathBuf> {
    let runtime = std::env::var_os("XDG_RUNTIME_DIR")
        .map(PathBuf::from)
        .filter(|path| path.is_absolute())
        .ok_or_else(|| io::Error::other("XDG_RUNTIME_DIR is not set"))?;
    // Whoever can reach the control socket controls the machine, and a
    // private parent directory is what keeps other users away from it.
    require_private(&runtime)?;

    let root = runtime.join("snowpaw");
    match private_dir(&root) {
        Err(error) if error.kind() == io::ErrorKind::AlreadyExists => require_private(&root)?,
        other => other?,
    }
    remove_stale_sessions(&root);

    // Nanoseconds, so two starts by one app never pick the same name.
    let now = SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |since| since.as_nanos());
    let dir = root.join(format!("vm-{}-{now}", std::process::id()));
    if dir.join(CONTROL_SOCKET).as_os_str().len() >= MAX_SOCKET_PATH {
        return Err(io::Error::other("the runtime directory path is too long for a socket"));
    }
    // Fails if the directory already exists, so nothing can be planted in it first.
    private_dir(&dir)?;
    Ok(dir)
}

/// Removes session directories whose app is no longer running. An app that
/// is killed cannot clean up, and the directory may still hold a captured screen.
///
/// Deletes only what this module creates: a directory with a session's exact
/// name, and inside it only the control socket and frame files. A directory
/// that holds anything else is left where it is.
fn remove_stale_sessions(root: &Path) {
    for entry in fs::read_dir(root).into_iter().flatten().flatten() {
        let name = entry.file_name();
        let Some(owner) = name.to_str().and_then(session_owner) else { continue };
        let dir = entry.path();
        let is_real_dir = fs::symlink_metadata(&dir).is_ok_and(|found| found.is_dir());
        if !is_real_dir || Path::new(&format!("/proc/{owner}")).exists() {
            continue;
        }
        for file in fs::read_dir(&dir).into_iter().flatten().flatten() {
            if file.file_name().to_str().is_some_and(is_session_file) {
                let _ = fs::remove_file(file.path());
            }
        }
        let _ = fs::remove_dir(&dir);
    }
}

/// The process id in a session directory name, `vm-<pid>-<time>`.
fn session_owner(name: &str) -> Option<u32> {
    let (pid, time) = name.strip_prefix("vm-")?.split_once('-')?;
    (is_number(pid) && is_number(time)).then(|| pid.parse().ok())?
}

fn is_session_file(name: &str) -> bool {
    let frame = name.strip_prefix("frame-").and_then(|rest| rest.strip_suffix(".png"));
    // The frame counter is a u64, so a longer number is not one of ours either.
    name == CONTROL_SOCKET || frame.is_some_and(|number| is_number(number) && number.parse::<u64>().is_ok())
}

/// True for a positive whole number written the way this module writes one:
/// digits only, with no sign and no leading zero.
fn is_number(text: &str) -> bool {
    !text.is_empty() && !text.starts_with('0') && text.bytes().all(|byte| byte.is_ascii_digit())
}

fn private_dir(path: &Path) -> io::Result<()> {
    DirBuilder::new().mode(0o700).create(path)
}

/// Checks that `path` is a real directory that only the current user can enter.
fn require_private(path: &Path) -> io::Result<()> {
    let found = fs::symlink_metadata(path)?;
    let me = fs::metadata("/proc/self")?.uid();
    if found.is_dir() && found.uid() == me && found.mode() & 0o077 == 0 {
        Ok(())
    } else {
        Err(io::Error::other(format!("{} is not a private directory", path.display())))
    }
}

/// Reads a captured frame, refusing anything that is not a plain file of sane size.
fn read_frame(path: &Path) -> io::Result<Vec<u8>> {
    let file = OpenOptions::new()
        .read(true)
        // Never follow a symlink, and never block on a pipe put in the file's place.
        .custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK)
        .open(path)?;
    if !file.metadata()?.is_file() {
        return Err(io::Error::other("the frame is not a regular file"));
    }
    let mut bytes = Vec::new();
    file.take(MAX_FRAME_BYTES + 1).read_to_end(&mut bytes)?;
    if bytes.len() as u64 > MAX_FRAME_BYTES {
        return Err(io::Error::other("the frame is too large"));
    }
    Ok(bytes)
}

/// Returns the width and height a PNG declares, or an error if the bytes do
/// not start with a complete PNG header or the size is outside the limits.
///
/// This decides whether to hand the bytes to the webview's decoder. It does
/// not check the rest of the file.
fn png_size(bytes: &[u8]) -> io::Result<(u32, u32)> {
    // Signature, then the first chunk: length 13, type IHDR, 13 bytes of
    // header starting with width and height, and a 4 byte checksum.
    const START: &[u8] = b"\x89PNG\r\n\x1a\n\0\0\0\x0dIHDR";
    if bytes.len() < START.len() + 13 + 4 || !bytes.starts_with(START) {
        return Err(io::Error::other("the frame is not a PNG"));
    }
    let number = |at: usize| u32::from_be_bytes([bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]]);
    let (width, height) = (number(START.len()), number(START.len() + 4));
    if (1..=MAX_FRAME_WIDTH).contains(&width) && (1..=MAX_FRAME_HEIGHT).contains(&height) {
        Ok((width, height))
    } else {
        Err(io::Error::other(format!("the frame is {width} by {height}, outside the limits")))
    }
}

/// Whether tests that need the real QEMU can run on this machine.
#[cfg(test)]
pub fn can_run_here() -> bool {
    let found = ["/dev/kvm", QEMU, BWRAP].iter().all(|path| Path::new(path).exists());
    if !found {
        eprintln!("skipped: needs KVM, QEMU and bubblewrap");
    }
    found
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::symlink;
    use std::sync::Arc;

    /// The smallest byte string `png_size` accepts: a complete first chunk.
    fn png(width: u32, height: u32) -> Vec<u8> {
        let mut bytes = b"\x89PNG\r\n\x1a\n\0\0\0\x0dIHDR".to_vec();
        bytes.extend(width.to_be_bytes());
        bytes.extend(height.to_be_bytes());
        bytes.extend([8, 2, 0, 0, 0]);
        bytes.extend([0; 4]);
        bytes
    }

    /// A private scratch directory, removed when the test ends.
    struct Scratch(PathBuf);

    impl Scratch {
        fn new(name: &str) -> Self {
            let dir = std::env::temp_dir().join(format!("snowpaw-{name}-{}", std::process::id()));
            private_dir(&dir).unwrap();
            Self(dir)
        }
    }

    impl Drop for Scratch {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    /// The host's numbers for the processes inside a machine's sandbox,
    /// starting with its first process. QEMU is the second.
    fn sandbox_pids(process: &Process) -> Vec<u32> {
        let first = process.first.as_ref().unwrap().as_raw_fd();
        let handle = fs::read_to_string(format!("/proc/self/fdinfo/{first}")).unwrap();
        let first = handle.lines().find_map(|line| line.strip_prefix("Pid:")).unwrap().trim().to_owned();
        let children = fs::read_to_string(format!("/proc/{first}/task/{first}/children")).unwrap();
        std::iter::once(first.as_str()).chain(children.split_whitespace()).map(|pid| pid.parse().unwrap()).collect()
    }

    #[test]
    fn png_size_reads_the_declared_size() {
        assert_eq!(png_size(&png(720, 400)).unwrap(), (720, 400));
        assert_eq!(png_size(&png(MAX_FRAME_WIDTH, MAX_FRAME_HEIGHT)).unwrap(), (1920, 1080));
    }

    #[test]
    fn png_size_rejects_sizes_outside_the_limits() {
        for (width, height) in [(0, 400), (720, 0), (MAX_FRAME_WIDTH + 1, 400), (720, MAX_FRAME_HEIGHT + 1), (u32::MAX, u32::MAX)] {
            assert!(png_size(&png(width, height)).is_err(), "{width} by {height}");
        }
    }

    #[test]
    fn png_size_rejects_other_and_truncated_data() {
        assert!(png_size(b"").is_err());
        assert!(png_size(b"GIF89a").is_err());
        let whole = png(720, 400);
        assert!(png_size(&whole[..whole.len() - 1]).is_err(), "header chunk cut short");
        let mut wrong_chunk = whole;
        wrong_chunk[12..16].copy_from_slice(b"IDAT");
        assert!(png_size(&wrong_chunk).is_err());
    }

    #[test]
    fn read_frame_refuses_anything_but_a_plain_file_of_sane_size() {
        let scratch = Scratch::new("frames");
        let target = scratch.0.join("target.png");
        fs::write(&target, png(720, 400)).unwrap();
        assert_eq!(read_frame(&target).unwrap(), png(720, 400));

        let link = scratch.0.join("link.png");
        symlink(&target, &link).unwrap();
        assert!(read_frame(&link).is_err(), "symlink");

        let big = scratch.0.join("big.png");
        fs::File::create(&big).unwrap().set_len(MAX_FRAME_BYTES + 1).unwrap();
        assert!(read_frame(&big).is_err(), "too large");

        let pipe = scratch.0.join("pipe.png");
        assert!(Command::new("mkfifo").arg(&pipe).status().unwrap().success());
        assert!(read_frame(&pipe).is_err(), "pipe");

        assert!(read_frame(&scratch.0).is_err(), "directory");
        assert!(read_frame(&scratch.0.join("missing.png")).is_err(), "missing");
    }

    #[test]
    fn require_private_rejects_shared_directories_and_symlinks() {
        let scratch = Scratch::new("private");
        assert!(require_private(&scratch.0).is_ok());

        let shared = scratch.0.join("shared");
        DirBuilder::new().mode(0o755).create(&shared).unwrap();
        fs::set_permissions(&shared, std::os::unix::fs::PermissionsExt::from_mode(0o755)).unwrap();
        assert!(require_private(&shared).is_err(), "readable by others");

        let link = scratch.0.join("link");
        symlink(&scratch.0, &link).unwrap();
        assert!(require_private(&link).is_err(), "symlink to a private directory");
        assert!(require_private(&scratch.0.join("missing")).is_err());
    }

    #[test]
    fn only_session_names_are_recognised() {
        assert_eq!(session_owner("vm-123-456"), Some(123));
        for name in ["vm-123", "vm-123-", "vm--456", "vm-123-notes", "vm-+123-456", "vm-123-+456", "vm-0123-456", "vm-123-456-7", "xvm-123-456", "notes"] {
            assert_eq!(session_owner(name), None, "{name}");
        }
        assert!(is_session_file("qmp.sock") && is_session_file("frame-12.png"));
        assert!(is_session_file("frame-18446744073709551615.png"), "the largest frame number");
        for name in ["frame-.png", "frame-x.png", "frame-+1.png", "frame-01.png", "frame-18446744073709551616.png", "frame-1.png.bak", "notes.txt"] {
            assert!(!is_session_file(name), "{name}");
        }
    }

    #[test]
    fn stale_sessions_are_removed_and_everything_else_is_kept() {
        let scratch = Scratch::new("stale");
        let root = &scratch.0;
        // Above the kernel's highest possible pid, so never a running process.
        let dead = root.join("vm-4194999-1");
        let dead_with_extras = root.join("vm-4194999-2");
        let live = root.join(format!("vm-{}-1", std::process::id()));
        let lookalike = root.join("vm-4194999-notes");
        let unrelated = root.join("notes");
        for dir in [&dead, &dead_with_extras, &live, &lookalike, &unrelated] {
            private_dir(dir).unwrap();
        }
        fs::write(dead.join("frame-1.png"), b"left behind").unwrap();
        fs::write(dead.join("qmp.sock"), b"").unwrap();
        fs::write(dead_with_extras.join("frame-1.png"), b"left behind").unwrap();
        fs::write(dead_with_extras.join("diary.txt"), b"not ours").unwrap();
        fs::write(lookalike.join("frame-1.png"), b"not a session").unwrap();
        let outside = root.join("outside.txt");
        fs::write(&outside, b"must survive").unwrap();
        symlink(&outside, dead.join("frame-2.png")).unwrap();
        symlink(&unrelated, root.join("vm-4194999-3")).unwrap();

        remove_stale_sessions(root);

        assert!(!dead.exists(), "a dead session is removed");
        assert!(outside.exists(), "a symlinked frame is unlinked, its target kept");
        assert!(!dead_with_extras.join("frame-1.png").exists(), "its frames are removed");
        assert!(dead_with_extras.join("diary.txt").exists(), "unknown files are kept");
        assert!(live.exists(), "a running app's session is kept");
        assert!(lookalike.join("frame-1.png").exists(), "a lookalike name is kept");
        assert!(unrelated.exists(), "a symlink named like a session is not followed");
    }

    /// Runs the real QEMU.
    #[test]
    fn starts_captures_the_screen_and_cleans_up() {
        if !can_run_here() {
            return;
        }
        let vm = Vm::spawn(None).unwrap().connect().unwrap();
        let dir = vm.process.dir.clone();
        assert_eq!(fs::metadata(&dir).unwrap().mode() & 0o777, 0o700);
        assert!(!vm.has_exited());

        // The firmware needs a moment to draw its first screen.
        thread::sleep(Duration::from_secs(1));
        let started = Instant::now();
        let first = vm.frame().unwrap();
        let second = vm.frame().unwrap();
        assert!(started.elapsed() >= MIN_FRAME_INTERVAL, "frames are rate limited");
        assert!(png_size(&first).is_ok() && png_size(&second).is_ok());
        // Only the control socket is left behind between captures.
        let left: Vec<_> = fs::read_dir(&dir).unwrap().map(|entry| entry.unwrap().file_name()).collect();
        assert_eq!(left, [CONTROL_SOCKET]);

        let pids = sandbox_pids(&vm.process);
        assert_eq!(pids.len(), 2, "the sandbox holds its first process and QEMU");
        drop(vm);
        assert!(!dir.exists(), "the session directory is removed");
        for pid in pids {
            // The first process may still be listed until its new parent
            // collects it, but only as a dead one ("Z").
            let state = fs::read_to_string(format!("/proc/{pid}/stat")).unwrap_or_default();
            assert!(state.is_empty() || state.contains(") Z "), "nothing in the sandbox is left running: {state}");
        }
    }

    /// Runs the real QEMU.
    #[test]
    fn attaches_a_read_only_disc() {
        if !can_run_here() {
            return;
        }
        let scratch = Scratch::new("disc");
        let disc = scratch.0.join("disc.iso");
        fs::File::create(&disc).unwrap().set_len(1024 * 1024).unwrap();

        let vm = Vm::spawn(Some(&File::open(&disc).unwrap())).unwrap().connect().unwrap();
        // What the guest's devices hold: one drive with this file in it.
        let devices = lock(&vm.screen).qmp.execute("query-block", json!({})).unwrap();
        let [drive] = devices.as_array().unwrap().as_slice() else { panic!("{devices}") };
        assert!(drive["qdev"].as_str().is_some_and(|device| !device.is_empty()), "{drive}");
        assert_eq!(drive["inserted"]["image"]["filename"], SANDBOX_DISC);
        assert_eq!(drive["inserted"]["image"]["virtual-size"], 1024 * 1024);
        assert_eq!(drive["inserted"]["ro"], true);
    }

    /// Runs the real QEMU, and asks it over the control socket to do what a
    /// guest that had taken it over might try.
    #[test]
    fn the_sandbox_hides_the_host() {
        if !can_run_here() {
            return;
        }
        let scratch = Scratch::new("host");
        let secret = scratch.0.join("secret");
        fs::write(&secret, b"must stay out").unwrap();
        // Open for the app, and not marked to close when another program starts.
        let open = File::open(&secret).unwrap();
        assert_eq!(unsafe { libc::fcntl(open.as_raw_fd(), libc::F_SETFD, 0) }, 0);

        let vm = Vm::spawn(None).unwrap().connect().unwrap();
        let qemu = sandbox_pids(&vm.process)[1];
        let held: Vec<_> = fs::read_dir(format!("/proc/{qemu}/fd")).unwrap().map(|fd| fs::read_link(fd.unwrap().path()).unwrap()).collect();
        assert!(held.len() > 3, "QEMU's own descriptors are listed: {held:?}");
        assert!(!held.contains(&secret), "the app's open file did not reach QEMU");

        let mut screen = lock(&vm.screen);
        let mut dump = |path: &Path| screen.qmp.execute("screendump", json!({ "filename": path, "format": "png" }));
        let outside = scratch.0.join("outside.png");
        assert!(dump(&outside).is_err(), "the host's /tmp does not exist in the sandbox");
        assert!(dump(&std::env::home_dir().unwrap().join("outside.png")).is_err(), "nor does /home");
        assert!(dump(Path::new("../outside.png")).is_ok(), "the sandbox's own root is writable and thrown away");
        assert!(!outside.exists() && !vm.process.dir.with_file_name("outside.png").exists());

        // Everything mounted in the sandbox, as mount point and options.
        let mounts = fs::read_to_string(format!("/proc/{qemu}/mountinfo")).unwrap();
        let mounts: Vec<_> = mounts.lines().map(|line| line.split(' ').collect::<Vec<_>>()).map(|mount| (mount[4], mount[5])).collect();
        assert!(mounts.len() > 3, "{mounts:?}");
        for (point, options) in mounts {
            let read_only = options.split(',').any(|option| option == "ro");
            match point {
                "/usr" => assert!(read_only, "/usr is writable"),
                "/" | SANDBOX_DIR => {}
                device => assert!(device.starts_with("/dev"), "{device} should not be there"),
            }
        }
    }

    /// Runs the real QEMU. What keeps a machine from starting without the app.
    #[test]
    fn a_machine_does_not_come_up_unless_the_app_is_listening() {
        if !can_run_here() {
            return;
        }
        let deadline = || Instant::now() + START_TIMEOUT;
        // Take the socket away, as the app's death would. Nothing is killed:
        // the sandbox has to end by itself.
        let Spawned { control, mut report, process } = Vm::spawn(None).unwrap();
        let first = first_process(&mut report, lock(&process.child).id(), deadline()).unwrap();
        drop(control);
        assert!(readable(&first, TEARDOWN_TIMEOUT), "QEMU found nobody listening and the sandbox ended");

        // The same with bubblewrap killed while the sandbox is being set up,
        // which is when the sandbox is not yet tied to its parent.
        let Spawned { control, mut report, process } = Vm::spawn(None).unwrap();
        let first = first_process(&mut report, lock(&process.child).id(), deadline()).unwrap();
        lock(&process.child).kill().unwrap();
        drop(control);
        assert!(readable(&first, TEARDOWN_TIMEOUT), "the sandbox ended without bubblewrap");
    }

    /// Runs the real QEMU. bubblewrap dying during setup leaves a sandbox
    /// that would not die with the app, so it is refused even though QEMU
    /// can still connect.
    #[test]
    fn a_sandbox_that_lost_bubblewrap_is_refused_and_ended() {
        if !can_run_here() {
            return;
        }
        let spawned = Vm::spawn(None).unwrap();
        let dir = spawned.process.dir.clone();
        lock(&spawned.process.child).kill().unwrap();
        assert!(spawned.connect().is_err());
        assert!(!dir.exists(), "it was proven gone, so its directory was removed");
    }

    /// Runs the real QEMU.
    #[test]
    fn a_machine_that_quits_by_itself_is_seen_to_be_gone() {
        if !can_run_here() {
            return;
        }
        let vm = Vm::spawn(None).unwrap().connect().unwrap();
        let pids = sandbox_pids(&vm.process);
        assert!(!vm.has_exited());
        lock(&vm.screen).qmp.execute("quit", json!({})).unwrap();
        // Nothing is killed here: QEMU leaves, and the sandbox follows.
        let first = vm.process.first.as_ref().unwrap();
        assert!(readable(first, TEARDOWN_TIMEOUT) && vm.has_exited());
        assert!(!Path::new(&format!("/proc/{}", pids[1])).exists(), "QEMU is gone");
        assert!(vm.frame().is_err());
    }

    /// Runs the real QEMU. A controller added by accident (USB, SATA, a
    /// network card) shows up here. The switched-off ISA devices would not.
    #[test]
    fn the_machine_has_no_controller_it_does_not_need() {
        if !can_run_here() {
            return;
        }
        let vm = Vm::spawn(None).unwrap().connect().unwrap();
        let buses = lock(&vm.screen).qmp.execute("query-pci", json!({})).unwrap();
        let devices: Vec<_> = buses
            .as_array()
            .unwrap()
            .iter()
            .flat_map(|bus| bus["devices"].as_array().unwrap())
            .map(|device| device["class_info"]["desc"].as_str().unwrap())
            .collect();
        // The two bridges are the machine itself. The screen is the only device on it.
        assert_eq!(devices, ["Host bridge", "VGA controller", "ISA bridge"]);
    }

    /// Runs the real QEMU. Stopping must not wait for a capture in progress.
    #[test]
    fn kill_does_not_wait_for_a_capture() {
        if !can_run_here() {
            return;
        }
        let vm = Arc::new(Vm::spawn(None).unwrap().connect().unwrap());
        vm.frame().unwrap();
        // This capture now waits out the rate limit while holding the screen.
        let capturing = thread::spawn({
            let vm = Arc::clone(&vm);
            move || vm.frame()
        });
        thread::sleep(Duration::from_millis(50));

        let started = Instant::now();
        assert!(vm.kill());
        assert!(started.elapsed() < MIN_FRAME_INTERVAL / 2, "kill took {:?}", started.elapsed());
        assert!(vm.has_exited());
        assert!(capturing.join().unwrap().is_err(), "the capture fails once QEMU is gone");
        assert!(vm.frame().is_err());
    }
}
