//! A minimal client for QMP, QEMU's control protocol: JSON objects, one per line.
//!
//! QMP can do anything to the virtual machine and a good deal to the host
//! (attach devices, write files), so only this crate's Rust code may decide
//! what is sent. Nothing from the webview is ever passed through.

use serde_json::{Value, json};
use std::io::{self, BufRead, BufReader, Read, Write};

/// Longest line accepted from QEMU. Replies to the commands used here are tiny.
const MAX_LINE: u64 = 64 * 1024;
/// How many unrelated messages (events) may arrive before a reply.
const MAX_EVENTS_PER_REPLY: usize = 256;

pub struct Qmp<S> {
    stream: BufReader<S>,
    last_id: u64,
}

impl<S: Read + Write> Qmp<S> {
    /// Reads QEMU's greeting and switches the connection into command mode.
    pub fn connect(stream: S) -> io::Result<Self> {
        let mut qmp = Self { stream: BufReader::new(stream), last_id: 0 };
        if qmp.read_message()?.get("QMP").is_none() {
            return Err(invalid("expected the QMP greeting"));
        }
        qmp.execute("qmp_capabilities", json!({}))?;
        Ok(qmp)
    }

    /// Runs one command and returns its result. Events that arrive first are skipped.
    pub fn execute(&mut self, command: &str, arguments: Value) -> io::Result<Value> {
        self.last_id += 1;
        let id = self.last_id;
        let request = json!({ "execute": command, "arguments": arguments, "id": id });
        let stream = self.stream.get_mut();
        stream.write_all(format!("{request}\n").as_bytes())?;
        stream.flush()?;

        for _ in 0..=MAX_EVENTS_PER_REPLY {
            let mut message = self.read_message()?;
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

    fn read_message(&mut self) -> io::Result<Value> {
        let mut line = Vec::new();
        (&mut self.stream).take(MAX_LINE).read_until(b'\n', &mut line)?;
        if line.is_empty() {
            return Err(io::ErrorKind::UnexpectedEof.into());
        }
        if line.last() != Some(&b'\n') {
            return Err(invalid("line too long or cut short"));
        }
        serde_json::from_slice(&line).map_err(|_| invalid("line is not JSON"))
    }
}

fn invalid(reason: &'static str) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, reason)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::net::UnixStream;
    use std::thread;

    const GREETING: &str = "{\"QMP\": {\"version\": {}, \"capabilities\": []}}\n";

    /// Connects a client to a fake QEMU that plays `script`: after the greeting,
    /// each entry is written in reply to one line received from the client.
    fn client(script: Vec<Vec<u8>>) -> io::Result<Qmp<UnixStream>> {
        let (ours, theirs) = UnixStream::pair()?;
        thread::spawn(move || {
            let mut reader = BufReader::new(theirs);
            let _ = reader.get_mut().write_all(GREETING.as_bytes());
            for reply in script {
                let mut request = String::new();
                if reader.read_line(&mut request).unwrap_or(0) == 0 {
                    return;
                }
                let _ = reader.get_mut().write_all(&reply);
            }
            // Take one more request before hanging up, so the client's write
            // succeeds and it is the missing reply that fails.
            let _ = reader.read_line(&mut String::new());
        });
        Qmp::connect(ours)
    }

    fn reply(text: &str) -> Vec<u8> {
        format!("{text}\n").into_bytes()
    }

    #[test]
    fn returns_the_result_of_a_command() {
        let script = vec![reply(r#"{"return": {}, "id": 1}"#), reply(r#"{"return": {"running": true}, "id": 2}"#)];
        let mut qmp = client(script).unwrap();
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
        let mut qmp = client(vec![reply(r#"{"return": {}, "id": 1}"#), reply(&noisy)]).unwrap();
        assert_eq!(qmp.execute("cont", json!({})).unwrap(), json!("ok"));
    }

    #[test]
    fn reports_a_command_error() {
        let script = vec![
            reply(r#"{"return": {}, "id": 1}"#),
            reply(r#"{"error": {"class": "GenericError", "desc": "nope"}, "id": 2}"#),
        ];
        let error = client(script).unwrap().execute("screendump", json!({})).unwrap_err();
        assert!(error.to_string().contains("nope"));
    }

    #[test]
    fn rejects_a_line_longer_than_the_limit() {
        let huge = vec![b'x'; MAX_LINE as usize + 1];
        let error = client(vec![reply(r#"{"return": {}, "id": 1}"#), huge]).unwrap().execute("x", json!({})).unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::InvalidData);
    }

    #[test]
    fn gives_up_after_an_event_flood() {
        let flood = reply(r#"{"event": "NOISE"}"#).repeat(MAX_EVENTS_PER_REPLY + 1);
        let error = client(vec![reply(r#"{"return": {}, "id": 1}"#), flood]).unwrap().execute("x", json!({})).unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::InvalidData);
    }

    #[test]
    fn fails_when_qemu_closes_the_socket() {
        let error = client(vec![reply(r#"{"return": {}, "id": 1}"#)]).unwrap().execute("x", json!({})).unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::UnexpectedEof);
    }

    #[test]
    fn refuses_a_peer_that_is_not_qmp() {
        let (ours, mut theirs) = UnixStream::pair().unwrap();
        theirs.write_all(b"{\"hello\": 1}\n").unwrap();
        assert!(Qmp::connect(ours).is_err());
    }
}
