//! The agent's computer: one QEMU virtual machine, run as a child of the app.
//!
//! What this does and does not protect against. The guest has no network
//! card, no shared folder, no clipboard and no USB, and QEMU runs under its
//! own seccomp filter. But QEMU runs as the desktop user: a bug that lets the
//! guest escape QEMU reaches that user's files. Treat this as a prototype
//! boundary, not as containment for hostile code.

use crate::qmp::Qmp;
use serde_json::json;
use std::fs::{self, DirBuilder, OpenOptions};
use std::io::{self, Read};
use std::os::unix::fs::{DirBuilderExt, MetadataExt, OpenOptionsExt};
use std::os::unix::net::UnixStream;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

/// A fixed absolute path, so a changed PATH cannot swap in another program.
const QEMU: &str = "/usr/bin/qemu-system-x86_64";
const CONTROL_SOCKET: &str = "qmp.sock";

/// How long QEMU gets to open its control socket after starting.
const START_TIMEOUT: Duration = Duration::from_secs(5);
/// How long any single control command may take.
const CONTROL_TIMEOUT: Duration = Duration::from_secs(5);
/// Screen captures are full PNG encodes inside QEMU; do not allow them back to back.
const MIN_FRAME_INTERVAL: Duration = Duration::from_millis(400);

/// Limits on a frame handed to the webview. The guest picks its own
/// resolution, so these are enforced here and not assumed.
const MAX_FRAME_BYTES: u64 = 16 * 1024 * 1024;
const MAX_FRAME_WIDTH: u32 = 1920;
const MAX_FRAME_HEIGHT: u32 = 1080;

pub struct Vm {
    // Declared first so the control connection closes before QEMU is killed.
    qmp: Qmp<UnixStream>,
    process: Process,
    frames: u64,
    last_frame: Option<Instant>,
}

/// The QEMU child and its private directory. Dropping it always cleans up both.
struct Process {
    child: Child,
    dir: PathBuf,
}

impl Drop for Process {
    fn drop(&mut self) {
        // Kill, do not ask: this has to work when QEMU has stopped answering.
        let _ = self.child.kill();
        let _ = self.child.wait();
        let _ = fs::remove_dir_all(&self.dir);
    }
}

impl Vm {
    /// Starts the virtual machine and connects to its control socket.
    ///
    /// Call this from a thread that lives as long as the app: QEMU is told to
    /// exit when its parent dies, and Linux ties that to the spawning thread.
    pub fn start() -> io::Result<Self> {
        let dir = session_dir()?;
        let child = Command::new(QEMU)
            .args(["-accel", "kvm", "-machine", "q35", "-cpu", "host", "-m", "2048", "-smp", "2"])
            // Only the devices named here exist: no network card, no audio, no USB.
            .args(["-nodefaults", "-no-user-config", "-nic", "none"])
            // The screen is read through the control socket, never shown or served by QEMU.
            .args(["-display", "none", "-vga", "virtio"])
            // A relative path: QEMU runs inside the session directory, and
            // unix socket paths are limited to 108 bytes.
            .args(["-qmp", &format!("unix:{CONTROL_SOCKET},server=on,wait=off")])
            .args(["-sandbox", "on,obsolete=deny,elevateprivileges=deny,spawn=deny,resourcecontrol=deny"])
            .args(["-run-with", "exit-with-parent=on"])
            .current_dir(&dir)
            .env_clear()
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn();
        let mut process = match child {
            Ok(child) => Process { child, dir },
            Err(error) => {
                let _ = fs::remove_dir_all(&dir);
                return Err(error);
            }
        };
        let qmp = Qmp::connect(control_socket(&mut process)?)?;
        Ok(Self { qmp, process, frames: 0, last_frame: None })
    }

    /// True once QEMU is gone, whatever the reason.
    pub fn has_exited(&mut self) -> bool {
        !matches!(self.process.child.try_wait(), Ok(None))
    }

    /// Captures the guest's screen as a PNG.
    pub fn frame(&mut self) -> io::Result<Vec<u8>> {
        if let Some(last) = self.last_frame {
            thread::sleep(MIN_FRAME_INTERVAL.saturating_sub(last.elapsed()));
        }
        self.last_frame = Some(Instant::now());

        // A new name every time: QEMU overwrites an existing file and follows
        // symlinks when it writes, so a name is never reused.
        self.frames += 1;
        let name = format!("frame-{}.png", self.frames);
        let path = self.process.dir.join(&name);
        let captured = self.qmp.execute("screendump", json!({ "filename": name, "format": "png" }));
        let bytes = captured.and_then(|_| read_frame(&path));
        let _ = fs::remove_file(&path);

        let bytes = bytes?;
        png_size(&bytes)?;
        Ok(bytes)
    }
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
    let seconds = SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |since| since.as_secs());
    let dir = root.join(format!("vm-{}-{seconds}", std::process::id()));
    // Fails if the directory already exists, so nothing can be planted in it first.
    private_dir(&dir)?;
    Ok(dir)
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
fn control_socket(process: &mut Process) -> io::Result<UnixStream> {
    let path = process.dir.join(CONTROL_SOCKET);
    let deadline = Instant::now() + START_TIMEOUT;
    let stream = loop {
        match UnixStream::connect(&path) {
            Ok(stream) => break stream,
            Err(error) if Instant::now() > deadline => return Err(error),
            Err(_) if process.child.try_wait()?.is_some() => {
                return Err(io::Error::other("QEMU exited while starting"));
            }
            Err(_) => thread::sleep(Duration::from_millis(20)),
        }
    };
    stream.set_read_timeout(Some(CONTROL_TIMEOUT))?;
    stream.set_write_timeout(Some(CONTROL_TIMEOUT))?;
    Ok(stream)
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
/// not start like a PNG or the size is outside the limits.
///
/// This decides whether to hand the bytes to the webview's decoder. It does
/// not check the rest of the file.
fn png_size(bytes: &[u8]) -> io::Result<(u32, u32)> {
    // Signature, then the first chunk: length 13, type IHDR, width, height.
    const HEADER: &[u8] = b"\x89PNG\r\n\x1a\n\0\0\0\x0dIHDR";
    if bytes.len() < HEADER.len() + 8 || !bytes.starts_with(HEADER) {
        return Err(io::Error::other("the frame is not a PNG"));
    }
    let number = |at: usize| u32::from_be_bytes([bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]]);
    let (width, height) = (number(HEADER.len()), number(HEADER.len() + 4));
    if (1..=MAX_FRAME_WIDTH).contains(&width) && (1..=MAX_FRAME_HEIGHT).contains(&height) {
        Ok((width, height))
    } else {
        Err(io::Error::other(format!("the frame is {width} by {height}, outside the limits")))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn png(width: u32, height: u32) -> Vec<u8> {
        let mut bytes = b"\x89PNG\r\n\x1a\n\0\0\0\x0dIHDR".to_vec();
        bytes.extend(width.to_be_bytes());
        bytes.extend(height.to_be_bytes());
        bytes
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
    fn png_size_rejects_other_data() {
        assert!(png_size(b"").is_err());
        assert!(png_size(b"GIF89a").is_err());
        assert!(png_size(&png(720, 400)[..20]).is_err());
        let mut wrong_chunk = png(720, 400);
        wrong_chunk[12..16].copy_from_slice(b"IDAT");
        assert!(png_size(&wrong_chunk).is_err());
    }

    #[test]
    fn read_frame_refuses_symlinks_and_oversized_files() {
        let dir = std::env::temp_dir().join(format!("snowpaw-test-{}", std::process::id()));
        private_dir(&dir).unwrap();
        let target = dir.join("target.png");
        fs::write(&target, png(720, 400)).unwrap();
        assert_eq!(read_frame(&target).unwrap(), png(720, 400));

        let link = dir.join("link.png");
        std::os::unix::fs::symlink(&target, &link).unwrap();
        assert!(read_frame(&link).is_err());

        let big = dir.join("big.png");
        fs::File::create(&big).unwrap().set_len(MAX_FRAME_BYTES + 1).unwrap();
        assert!(read_frame(&big).is_err());
        assert!(read_frame(&dir).is_err());

        fs::remove_dir_all(&dir).unwrap();
    }

    /// Runs the real QEMU. Skipped where KVM or QEMU is missing.
    #[test]
    fn starts_captures_the_screen_and_cleans_up() {
        if !Path::new("/dev/kvm").exists() || !Path::new(QEMU).exists() {
            eprintln!("skipped: needs KVM and QEMU");
            return;
        }
        let mut vm = Vm::start().unwrap();
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

        let pid = vm.process.child.id();
        drop(vm);
        assert!(!dir.exists(), "the session directory is removed");
        assert!(!Path::new(&format!("/proc/{pid}")).exists(), "QEMU is gone");
    }
}
