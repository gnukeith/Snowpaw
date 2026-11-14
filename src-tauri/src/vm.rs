//! The agent's computer: one QEMU virtual machine, run as a child of the app.
//!
//! What this does and does not protect against. The guest has no network
//! card, no shared folder, no clipboard and no USB, its only disc is
//! read-only, and QEMU runs under its own seccomp filter. But QEMU runs as
//! the desktop user: a bug that lets the guest escape QEMU reaches that
//! user's files. Treat this as a prototype boundary, not as containment for
//! hostile code.

use crate::qmp::Qmp;
use serde_json::json;
use std::fs::{self, DirBuilder, OpenOptions};
use std::io::{self, Read};
use std::os::unix::fs::{DirBuilderExt, MetadataExt, OpenOptionsExt};
use std::os::unix::net::UnixStream;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Mutex, MutexGuard, PoisonError};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

/// A fixed absolute path, so a changed PATH cannot swap in another program.
const QEMU: &str = "/usr/bin/qemu-system-x86_64";
const CONTROL_SOCKET: &str = "qmp.sock";
/// What the guest gets. A desktop is not usable with much less.
const MEMORY_MB: &str = "4096";
const PROCESSORS: &str = "4";
/// The kernel's limit on a unix socket path, including its closing zero byte.
const MAX_SOCKET_PATH: usize = 108;

/// How long QEMU gets to open its control socket after starting.
const START_TIMEOUT: Duration = Duration::from_secs(5);
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

/// A machine whose QEMU has been started but not yet connected to.
pub struct Spawned(Process);

struct Screen {
    qmp: Qmp,
    frames: u64,
    last_frame: Option<Instant>,
}

/// The QEMU child and its private directory. Dropping it always cleans up both.
struct Process {
    child: Mutex<Child>,
    dir: PathBuf,
}

impl Process {
    /// Kills QEMU and waits for it to be gone. Safe to call more than once.
    fn kill(&self) {
        let mut child = lock(&self.child);
        // Kill, do not ask: this has to work when QEMU has stopped answering.
        let _ = child.kill();
        let _ = child.wait();
    }

    fn has_exited(&self) -> bool {
        !matches!(lock(&self.child).try_wait(), Ok(None))
    }
}

impl Drop for Process {
    fn drop(&mut self) {
        self.kill();
        let _ = fs::remove_dir_all(&self.dir);
    }
}

impl Vm {
    /// Starts QEMU. Returns as soon as the process exists.
    ///
    /// `disc` is an image for the guest to boot from, given as an absolute
    /// path. The guest cannot write to it. Without one the machine is empty.
    ///
    /// Call this from a thread that lives as long as the app: QEMU is told to
    /// exit when its parent dies, and Linux ties that to the spawning thread.
    pub fn spawn(disc: Option<&Path>) -> io::Result<Spawned> {
        let mut qemu = Command::new(QEMU);
        if let Some(disc) = disc {
            // QEMU runs inside the session directory, so a relative path would
            // name a file there.
            let path = disc.to_str().filter(|_| disc.is_absolute());
            let path = path.ok_or_else(|| io::Error::other("the disc needs an absolute, printable path"))?;
            // Written as JSON, so nothing in the path can be read as an option.
            let file = json!({ "driver": "file", "filename": path, "read-only": true, "node-name": "disc" });
            qemu.args(["-blockdev", &file.to_string()])
                .args(["-device", "virtio-scsi-pci", "-device", "scsi-cd,drive=disc,bootindex=0"]);
        }
        let dir = session_dir()?;
        let child = qemu
            .args(["-accel", "kvm", "-machine", "q35", "-cpu", "host", "-m", MEMORY_MB, "-smp", PROCESSORS])
            // Only the devices named here exist: no network card, no audio, no USB.
            .args(["-nodefaults", "-no-user-config", "-nic", "none"])
            // The screen is read through the control socket, never shown or served by QEMU.
            .args(["-display", "none", "-vga", "virtio"])
            // A relative path: QEMU runs inside the session directory.
            .args(["-qmp", &format!("unix:{CONTROL_SOCKET},server=on,wait=off")])
            .args(["-sandbox", "on,obsolete=deny,elevateprivileges=deny,spawn=deny,resourcecontrol=deny"])
            .args(["-run-with", "exit-with-parent=on"])
            .current_dir(&dir)
            .env_clear()
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn();
        match child {
            Ok(child) => Ok(Spawned(Process { child: Mutex::new(child), dir })),
            Err(error) => {
                let _ = fs::remove_dir_all(&dir);
                Err(error)
            }
        }
    }

    /// Ends the machine at once, without asking the guest or QEMU.
    pub fn kill(&self) {
        self.process.kill();
    }

    /// True once QEMU is gone, whatever the reason.
    pub fn has_exited(&self) -> bool {
        self.process.has_exited()
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
    /// Waits for QEMU to come up and connects to its control socket. This can
    /// take seconds, so do it off the thread that called `Vm::spawn`.
    pub fn connect(self) -> io::Result<Vm> {
        let stream = control_socket(&self.0)?;
        let qmp = Qmp::connect(stream, CONTROL_TIMEOUT)?;
        Ok(Vm { process: self.0, screen: Mutex::new(Screen { qmp, frames: 0, last_frame: None }) })
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
    // QEMU creates its socket world-readable, so a private parent directory
    // is the only thing keeping other users away from it.
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

/// Waits for QEMU to open its control socket, then connects to it.
fn control_socket(process: &Process) -> io::Result<UnixStream> {
    let path = process.dir.join(CONTROL_SOCKET);
    let deadline = Instant::now() + START_TIMEOUT;
    loop {
        match UnixStream::connect(&path) {
            Ok(stream) => return Ok(stream),
            Err(error) if Instant::now() > deadline => return Err(error),
            Err(_) if process.has_exited() => return Err(io::Error::other("QEMU exited while starting")),
            Err(_) => thread::sleep(Duration::from_millis(20)),
        }
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
    let found = Path::new("/dev/kvm").exists() && Path::new(QEMU).exists();
    if !found {
        eprintln!("skipped: needs KVM and QEMU");
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

        let pid = lock(&vm.process.child).id();
        drop(vm);
        assert!(!dir.exists(), "the session directory is removed");
        assert!(!Path::new(&format!("/proc/{pid}")).exists(), "QEMU is gone");
    }

    /// Runs the real QEMU. The disc is attached read-only, whatever its path contains.
    #[test]
    fn attaches_a_read_only_disc() {
        if !can_run_here() {
            return;
        }
        let scratch = Scratch::new("disc");
        let disc = scratch.0.join("a,b \"c\".iso");
        fs::File::create(&disc).unwrap().set_len(1024 * 1024).unwrap();

        let vm = Vm::spawn(Some(&disc)).unwrap().connect().unwrap();
        let nodes = lock(&vm.screen).qmp.execute("query-named-block-nodes", json!({})).unwrap();
        let node = nodes.as_array().unwrap().iter().find(|node| node["node-name"] == "disc").unwrap();
        assert_eq!(node["image"]["filename"], disc.to_str().unwrap());
        assert_eq!(node["ro"], true);

        assert!(Vm::spawn(Some(Path::new("relative.iso"))).is_err(), "a relative path is refused");
        let missing = Vm::spawn(Some(&scratch.0.join("missing.iso"))).unwrap();
        assert!(missing.connect().is_err(), "QEMU does not start without its disc");
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
        vm.kill();
        assert!(started.elapsed() < MIN_FRAME_INTERVAL / 2, "kill took {:?}", started.elapsed());
        assert!(vm.has_exited());
        assert!(capturing.join().unwrap().is_err(), "the capture fails once QEMU is gone");
        assert!(vm.frame().is_err());
    }

    /// Runs the real QEMU. A machine that never connects leaves nothing behind.
    #[test]
    fn a_failed_start_cleans_up() {
        if !can_run_here() {
            return;
        }
        let spawned = Vm::spawn(None).unwrap();
        let dir = spawned.0.dir.clone();
        spawned.0.kill();
        assert!(spawned.connect().is_err(), "QEMU died before the control socket was used");
        assert!(!dir.exists());
    }
}
