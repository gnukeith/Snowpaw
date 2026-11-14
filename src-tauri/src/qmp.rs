//! A minimal client for QMP, QEMU's control protocol: JSON objects, one per line.
//!
//! QMP can do anything to the virtual machine and a good deal to the host
//! (attach devices, write files), so only this crate's Rust code may decide
//! what is sent. Nothing from the webview is ever passed through.

use serde_json::{Value, json};
use std::io::{self, BufRead, BufReader, Write};
use std::os::unix::net::UnixStream;
use std::time::{Duration, Instant};

/// Longest line accepted from QEMU. Replies to the commands used here are tiny.
const MAX_LINE: usize = 64 * 1024;
/// How many unrelated messages (events) may arrive before a reply.
const MAX_EVENTS_PER_REPLY: usize = 256;

pub struct Qmp {
    stream: BufReader<UnixStream>,
    timeout: Duration,
    last_id: u64,
}

impl Qmp {
    /// Reads QEMU's greeting and switches the connection into command mode.
    ///
    /// `timeout` is the most time the handshake may take, and afterwards the
    /// most time any one command may take from request to reply. It is a
    /// deadline for the whole exchange, so a peer that keeps sending a little
    /// data cannot stretch it.
    pub fn connect(stream: UnixStream, timeout: Duration) -> io::Result<Self> {
        stream.set_write_timeout(Some(timeout))?;
        let mut qmp = Self { stream: BufReader::new(stream), timeout, last_id: 0 };
        let deadline = Instant::now() + timeout;
        if qmp.read_message(deadline)?.get("QMP").is_none() {
            return Err(invalid("expected the QMP greeting"));
        }
        qmp.execute_by("qmp_capabilities", json!({}), deadline)?;
        Ok(qmp)
    }

    /// Runs one command and returns its result. Events that arrive first are skipped.
    pub fn execute(&mut self, command: &str, arguments: Value) -> io::Result<Value> {
        self.execute_by(command, arguments, Instant::now() + self.timeout)
    }

    fn execute_by(&mut self, command: &str, arguments: Value, deadline: Instant) -> io::Result<Value> {
        self.last_id += 1;
        let id = self.last_id;
        let request = json!({ "execute": command, "arguments": arguments, "id": id });
        self.stream.get_mut().write_all(format!("{request}\n").as_bytes())?;

        for _ in 0..=MAX_EVENTS_PER_REPLY {
            let mut message = self.read_message(deadline)?;
            if message.get("id").and_then(Value::as_u64) != Some(id) {
                continue;
            }
            return match message.get_mut("return") {
                Some(result) => Ok(result.take()),
                None => {
                    let reason = message.pointer("/error/desc").and_then(Value::as_str);
                    Err(io::Error::other(format!(
                        "{command} failed: {}",
                        reason.unwrap_or("no reason given")
                    )))
                }
            };
        }
        Err(invalid("too many events before the reply"))
    }

    /// Reads one line, giving up at `deadline` however the bytes arrive.
    fn read_message(&mut self, deadline: Instant) -> io::Result<Value> {
        let mut line = Vec::new();
        loop {
            let left = deadline.saturating_duration_since(Instant::now());
            if left.is_zero() {
                return Err(io::ErrorKind::TimedOut.into());
            }
            self.stream.get_ref().set_read_timeout(Some(left))?;
            let available = self.stream.fill_buf()?;
            if available.is_empty() {
                return Err(io::ErrorKind::UnexpectedEof.into());
            }
            let end = available.iter().position(|&byte| byte == b'\n');
            let taken = end.map_or(available.len(), |at| at + 1);
            if line.len() + taken > MAX_LINE {
                return Err(invalid("line too long"));
            }
            line.extend_from_slice(&available[..taken]);
            self.stream.consume(taken);
            if end.is_some() {
                return serde_json::from_slice(&line).map_err(|_| invalid("line is not JSON"));
            }
        }
    }
}

fn invalid(reason: &'static str) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, reason)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Read;
    use std::thread;

    const GREETING: &str = "{\"QMP\": {\"version\": {}, \"capabilities\": []}}\n";
    const READY: &str = r#"{"return": {}, "id": 1}"#;
    const TIMEOUT: Duration = Duration::from_millis(300);

    /// Connects a client to a fake QEMU. The fake sends `greeting`, then
    /// answers each line it receives with the next entry of `script`.
    fn peer(greeting: &'static str, script: Vec<Vec<u8>>) -> io::Result<Qmp> {
        let (ours, theirs) = UnixStream::pair()?;
        thread::spawn(move || {
            let mut reader = BufReader::new(theirs);
            let _ = reader.get_mut().write_all(greeting.as_bytes());
            for reply in script {
                if reader.read_line(&mut String::new()).unwrap_or(0) == 0 {
                    return;
                }
                let _ = reader.get_mut().write_all(&reply);
            }
            // Keep reading until the client hangs up, so its writes succeed
            // and it is the missing reply that fails.
            let _ = reader.read_to_end(&mut Vec::new());
        });
        Qmp::connect(ours, TIMEOUT)
    }

    /// A client whose handshake has succeeded and whose next command gets `reply`.
    fn client(reply: Vec<u8>) -> Qmp {
        peer(GREETING, vec![line(READY), reply]).unwrap()
    }

    fn line(text: &str) -> Vec<u8> {
        format!("{text}\n").into_bytes()
    }

    #[test]
    fn returns_the_result_of_a_command() {
        let mut qmp = client(line(r#"{"return": {"running": true}, "id": 2}"#));
        assert_eq!(qmp.execute("query-status", json!({})).unwrap(), json!({ "running": true }));
    }

    #[test]
    fn skips_events_and_stale_replies_before_the_reply() {
        let noisy = [
            r#"{"event": "RESUME", "timestamp": {"seconds": 1, "microseconds": 2}}"#,
            r#"{"return": {"stale": true}, "id": 1}"#,
            r#"{"return": "ok", "id": 2}"#,
        ]
        .join("\n");
        assert_eq!(client(line(&noisy)).execute("cont", json!({})).unwrap(), json!("ok"));
    }

    #[test]
    fn reads_a_reply_that_arrives_in_pieces() {
        let (ours, theirs) = UnixStream::pair().unwrap();
        thread::spawn(move || {
            let mut reader = BufReader::new(theirs);
            let _ = reader.get_mut().write_all(GREETING.as_bytes());
            for reply in [READY, r#"{"return": "whole", "id": 2}"#] {
                let _ = reader.read_line(&mut String::new());
                for byte in format!("{reply}\n").bytes() {
                    let _ = reader.get_mut().write_all(&[byte]);
                    thread::sleep(Duration::from_millis(1));
                }
            }
        });
        let mut qmp = Qmp::connect(ours, Duration::from_secs(5)).unwrap();
        assert_eq!(qmp.execute("x", json!({})).unwrap(), json!("whole"));
    }

    #[test]
    fn reports_a_command_error() {
        let mut qmp = client(line(r#"{"error": {"class": "GenericError", "desc": "nope"}, "id": 2}"#));
        assert!(qmp.execute("screendump", json!({})).unwrap_err().to_string().contains("nope"));
    }

    #[test]
    fn rejects_a_line_longer_than_the_limit() {
        let error = client(vec![b'x'; MAX_LINE + 1]).execute("x", json!({})).unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::InvalidData);
    }

    #[test]
    fn rejects_malformed_and_deeply_nested_json() {
        for bad in ["{\"return\": ", "not json", &"[".repeat(10_000)] {
            let error = client(line(bad)).execute("x", json!({})).unwrap_err();
            assert_eq!(error.kind(), io::ErrorKind::InvalidData, "{:.20}", bad);
        }
    }

    #[test]
    fn gives_up_after_an_event_flood() {
        let flood = line(r#"{"event": "NOISE"}"#).repeat(MAX_EVENTS_PER_REPLY + 1);
        let error = client(flood).execute("x", json!({})).unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::InvalidData);
    }

    #[test]
    fn fails_when_qemu_closes_the_socket() {
        let (ours, theirs) = UnixStream::pair().unwrap();
        thread::spawn(move || {
            let mut reader = BufReader::new(theirs);
            let _ = reader.get_mut().write_all(GREETING.as_bytes());
            let _ = reader.read_line(&mut String::new());
            let _ = reader.get_mut().write_all(&line(READY));
            // Take the next command, then hang up without answering.
            let _ = reader.read_line(&mut String::new());
        });
        let mut qmp = Qmp::connect(ours, TIMEOUT).unwrap();
        assert_eq!(qmp.execute("x", json!({})).unwrap_err().kind(), io::ErrorKind::UnexpectedEof);
    }

    #[test]
    fn fails_when_the_handshake_is_wrong_cut_short_or_silent() {
        assert!(peer("{\"hello\": 1}\n", vec![]).is_err(), "not QMP");
        assert!(peer("", vec![]).is_err(), "says nothing");
        assert!(peer(GREETING, vec![b"{\"return\"".to_vec()]).is_err(), "half a reply");
        let (ours, theirs) = UnixStream::pair().unwrap();
        drop(theirs);
        assert!(Qmp::connect(ours, TIMEOUT).is_err(), "closed");
    }

    /// The deadline covers the whole exchange: neither a slow trickle of bytes
    /// nor a steady stream of complete events may extend it.
    #[test]
    fn a_peer_that_keeps_talking_cannot_outlast_the_deadline() {
        for chunk in [&b"x"[..], &b"{\"event\": \"NOISE\"}\n"[..]] {
            let (ours, theirs) = UnixStream::pair().unwrap();
            thread::spawn(move || {
                let mut reader = BufReader::new(theirs);
                let _ = reader.get_mut().write_all(GREETING.as_bytes());
                let _ = reader.read_line(&mut String::new());
                let _ = reader.get_mut().write_all(&line(READY));
                while reader.get_mut().write_all(chunk).is_ok() {
                    thread::sleep(Duration::from_millis(20));
                }
            });
            let mut qmp = Qmp::connect(ours, TIMEOUT).unwrap();
            let started = Instant::now();
            assert!(qmp.execute("x", json!({})).is_err());
            assert!(started.elapsed() < TIMEOUT * 2, "took {:?}", started.elapsed());
        }
    }
}
