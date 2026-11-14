//! One reply from a model. The conversation goes to the chat endpoint of a
//! saved connection, with that connection's key if it has one, and what the
//! model writes is handed to the page piece by piece as it arrives.

use std::collections::{HashMap, VecDeque};
use std::io::{BufRead, BufReader, Read};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::time::Duration;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use tauri::State;
use tauri::ipc::Channel;
use zeroize::Zeroizing;
use crate::providers::{self, Address, Failure, validate_id};
use crate::secrets;

/// How much of a reply's stream is read: far more than a model writes, and an
/// end to what a server can make the app take in.
const REPLY_LIMIT: u64 = 64 * 1024 * 1024;
/// One line of that stream. A line carries one piece of the reply.
const LINE_LIMIT: usize = 1024 * 1024;
/// A server that says nothing for this long is given up on. A model is loaded,
/// a long conversation is read and some models reason in silence, so this is
/// generous. Stopping a reply does not wait for it.
const QUIET: Duration = Duration::from_secs(900);
const CONNECT: Duration = Duration::from_secs(20);
/// How many stops are remembered for replies that have not begun.
const EARLY_STOPS: usize = 64;

/// One side's part of a conversation, as the model is sent it.
#[derive(Deserialize, Serialize)]
pub(crate) struct Turn {
    role: Role,
    content: String,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
enum Role {
    User,
    Assistant,
}

/// What the page is handed while a reply is written.
#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub(crate) enum Piece {
    /// More of the model's reasoning.
    Thinking { text: String },
    /// More of its answer.
    Text { text: String },
    /// Always the last piece, and the only word on how the reply ended. It
    /// comes the same way as the others so that it cannot overtake them.
    End {
        #[serde(skip_serializing_if = "Option::is_none")]
        failure: Option<Failure>,
    },
}

/// What stops a reply: a flag for its reader, and the connections it reads
/// from. Each reply has connections of its own, so closing them ends a read
/// that is waiting on the server and touches no other reply.
#[derive(Clone)]
struct Halt {
    stop: Arc<AtomicBool>,
    agent: ureq::Agent,
}

/// The replies being written, each with what stops it.
#[derive(Default)]
pub(crate) struct Replies(Mutex<Places>);

#[derive(Default)]
struct Places {
    writing: HashMap<String, Halt>,
    /// Names that were stopped before a reply began under them. A stop and
    /// the send it is for travel separately, and the stop can come first.
    stopped: VecDeque<String>,
}

impl Replies {
    fn lock(&self) -> MutexGuard<'_, Places> {
        self.0.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// Takes a place for a reply under the name the page gave it. Refused if
    /// a reply is already being written under that name, or if the name was
    /// stopped before this.
    fn begin(&self, request: &str) -> Result<Writing<'_>, Failure> {
        let mut places = self.lock();
        if let Some(early) = places.stopped.iter().position(|name| name == request) {
            places.stopped.remove(early);
            return Err(Failure::new("stopped"));
        }
        if places.writing.contains_key(request) {
            return Err(Failure::new("address"));
        }
        // No limit on the whole exchange: a long answer is not a failure.
        // Each wait within it has one.
        let agent = providers::settings()
            .timeout_resolve(Some(CONNECT))
            .timeout_connect(Some(CONNECT))
            .timeout_per_read(Some(QUIET))
            .timeout_per_write(Some(QUIET))
            .build().into();
        let halt = Halt { stop: Arc::new(AtomicBool::new(false)), agent };
        places.writing.insert(request.to_owned(), halt.clone());
        Ok(Writing { replies: self, request: request.to_owned(), halt })
    }

    /// Stops the reply under that name, now. If none is being written, the
    /// name is remembered, so that a reply which begins under it later does
    /// not. A name is used once, so one remembered for a reply that had
    /// already ended stops nothing; only so many are kept.
    fn stop(&self, request: &str) {
        let mut places = self.lock();
        let Some(halt) = places.writing.get(request).cloned() else {
            if places.stopped.len() == EARLY_STOPS {
                places.stopped.pop_front();
            }
            places.stopped.push_back(request.to_owned());
            return;
        };
        drop(places);
        halt.stop.store(true, Ordering::Relaxed);
        halt.agent.shutdown();
    }
}

/// A reply's place among those being written, given up when it is dropped.
struct Writing<'a> {
    replies: &'a Replies,
    request: String,
    halt: Halt,
}

impl Drop for Writing<'_> {
    fn drop(&mut self) {
        self.replies.lock().writing.remove(&self.request);
    }
}

fn validate_model(model: &str) -> Result<(), Failure> {
    if model.is_empty() || model.chars().count() > 200 || model.chars().any(char::is_control) {
        return Err(Failure::new("address"));
    }
    Ok(())
}

/// Sends a conversation to a connection's model and hands `pieces` the reply
/// as it is written. `request` is the page's name for this reply, which
/// `chat_stop` takes. How it ended is the last piece, never this command's
/// own answer.
#[tauri::command]
pub(crate) async fn chat_send(
    replies: State<'_, Replies>, request: String, id: String, address: String, model: String,
    turns: Vec<Turn>, needs_key: Option<bool>, pieces: Channel<Piece>,
) -> Result<(), Failure> {
    let page = pieces.clone();
    let outcome = async {
        validate_id(&request)?;
        validate_id(&id)?;
        let address = Address::parse(&address)?;
        validate_model(&model)?;
        let writing = replies.begin(&request)?;
        let key = secrets::lookup(&id, &address.origin()).await?;
        // As with the list of models: a provider that wants a key is not
        // sent a conversation without one.
        if needs_key == Some(true) && key.is_none() {
            return Err(Failure::new("refused"));
        }
        let halt = writing.halt.clone();
        tauri::async_runtime::spawn_blocking(move || {
            let key = key.as_deref().map(String::as_str);
            ask(&halt, &address, key, &model, &turns, &mut |piece| page.send(piece).is_ok())
        }).await.map_err(|_| Failure::new("answer"))?
    }.await;
    // A piece that could not be handed over leaves a gap that the pieces
    // after it wait behind for ever, the last one too. Then this command's
    // own answer is the only word left on how the reply ended.
    if outcome.as_ref().is_err_and(|failure| failure.kind == "unheard") {
        return Err(Failure::new("interrupted"));
    }
    pieces.send(Piece::End { failure: outcome.err() }).map_err(|_| Failure::new("interrupted"))
}

/// Stops a reply by closing its connection, which is also what tells the
/// server to stop writing it.
#[tauri::command]
pub(crate) fn chat_stop(replies: State<'_, Replies>, request: String) {
    if validate_id(&request).is_ok() {
        replies.stop(&request);
    }
}

/// A conversation is turned down for more reasons than a key is.
fn reply_status(status: u16) -> Result<(), Failure> {
    match status {
        400 | 413 | 422 => Err(Failure::new("request").at(status)),
        _ => providers::status_result(status),
    }
}

fn ask(
    halt: &Halt, address: &Address, key: Option<&str>, model: &str, turns: &[Turn],
    emit: &mut dyn FnMut(Piece) -> bool,
) -> Result<(), Failure> {
    let body = serde_json::to_vec(&json!({ "model": model, "messages": turns, "stream": true }))
        .map_err(|_| Failure::new("answer"))?;
    let bearer = key.map(|key| Zeroizing::new(format!("Bearer {key}")));
    let mut request = halt.agent.post(&address.endpoint("/chat/completions"))
        .header("Accept", "text/event-stream")
        .content_type("application/json");
    if let Some(bearer) = &bearer {
        request = request.header("Authorization", providers::secret_header(bearer)?);
    }
    // A stop closes the connection under whatever was waiting on it, and
    // what that fails with says nothing of why.
    let stopped = |failure| if halt.stop.load(Ordering::Relaxed) { Failure::new("stopped") } else { failure };
    let response = request.send(&body[..]).map_err(|error| stopped(providers::transport_error(error)))?;
    reply_status(response.status().as_u16())?;
    read(BufReader::new(response.into_body().into_reader()), key, &halt.stop, emit).map_err(stopped)
}

/// One line of a reply's stream, as far as it matters here.
#[derive(Debug, PartialEq, Eq)]
enum Line {
    /// A blank line, a comment, or a field other than `data`.
    Other,
    Chunk { thinking: String, text: String, finished: bool },
    /// The server's word that the reply is complete.
    Done,
    /// The server's word that it failed. What it says of why is not read.
    Error,
    Malformed,
}

fn parse(line: &[u8]) -> Line {
    let Some(data) = line.strip_prefix(b"data:") else { return Line::Other };
    let data = data.trim_ascii();
    if data.is_empty() {
        return Line::Other;
    }
    if data == b"[DONE]" {
        return Line::Done;
    }
    let Ok(value) = serde_json::from_slice::<Value>(data) else { return Line::Malformed };
    if value.get("error").is_some_and(|error| !error.is_null()) {
        return Line::Error;
    }
    let choice = value.get("choices").and_then(|choices| choices.get(0));
    let delta = choice.and_then(|choice| choice.get("delta"));
    let part = |name| delta.and_then(|delta| delta.get(name)).and_then(Value::as_str)
        .filter(|part: &&str| !part.is_empty());
    Line::Chunk {
        // Servers name a model's reasoning one of two ways.
        thinking: part("reasoning_content").or_else(|| part("reasoning")).unwrap_or_default().to_owned(),
        text: part("content").unwrap_or_default().to_owned(),
        finished: choice.and_then(|choice| choice.get("finish_reason")).is_some_and(|why| !why.is_null()),
    }
}

/// Reads the next line, with its line break, into `line`. Zero at the end.
fn next_line(stream: &mut impl BufRead, line: &mut Vec<u8>) -> Result<u64, Failure> {
    line.clear();
    let read = stream.take(LINE_LIMIT as u64 + 1).read_until(b'\n', line).map_err(|error| {
        // Only a silence is told apart: anything else that ends a stream
        // early reads the same to the person waiting for it.
        let kind = providers::transport_error(error.into()).kind;
        Failure::new(if kind == "timeout" { kind } else { "interrupted" })
    })?;
    if read > LINE_LIMIT {
        return Err(Failure::new("long"));
    }
    Ok(read as u64)
}

/// Keeps the connection's key out of what a reply says. A server may repeat
/// the key it was sent, and a key never goes to the page. Text passes through
/// as it arrives, less any ending that could be the start of the key: that
/// waits for what follows it. Where the key was, a line break is left, which
/// no key can contain, so that what came before and after cannot join into
/// one.
///
/// This is for a key repeated as it is, within the reasoning or within the
/// answer. A server set on passing its key along could cut it up between the
/// two, or disguise it, and nothing read here could tell.
struct Sieve {
    /// Empty when the connection has no key: everything passes.
    key: Vec<u8>,
    /// For each length of the key's start that the text read so far ends
    /// with, the next shorter one it also ends with. Looking back through
    /// this instead of through the text is what keeps the work in step with
    /// the length of the reply, whatever the reply is made of.
    back: Vec<usize>,
    /// The end of the text so far that is a start of the key.
    held: VecDeque<u8>,
}

impl Sieve {
    fn new(key: Option<&str>) -> Self {
        let key = key.unwrap_or_default().as_bytes().to_vec();
        let mut back = vec![0; key.len()];
        let mut matched = 0;
        for at in 1..key.len() {
            while matched > 0 && key[at] != key[matched] {
                matched = back[matched - 1];
            }
            if key[at] == key[matched] {
                matched += 1;
            }
            back[at] = matched;
        }
        Self { key, back, held: VecDeque::new() }
    }

    fn pass(&mut self, more: &str) -> String {
        if self.key.is_empty() {
            return more.to_owned();
        }
        let mut passed = Vec::with_capacity(more.len());
        for &byte in more.as_bytes() {
            // What is held is always the longest start of the key that the
            // text ends with: find the longest that still is, with this byte.
            let mut matched = self.held.len();
            while matched > 0 && self.key[matched] != byte {
                matched = self.back[matched - 1];
            }
            if self.key[matched] == byte {
                matched += 1;
            }
            self.held.push_back(byte);
            if matched == self.key.len() {
                self.held.clear();
                passed.push(b'\n');
            } else {
                passed.extend(self.held.drain(..self.held.len() - matched));
            }
        }
        text_of(passed)
    }

    /// What was held back, once nothing more can follow it.
    fn rest(&mut self) -> String {
        text_of(self.held.drain(..).collect())
    }
}

/// What is held starts where a character of the key does, so what passes
/// never ends inside a character. Were that ever untrue, the broken
/// character is replaced and nothing fails.
fn text_of(bytes: Vec<u8>) -> String {
    String::from_utf8(bytes).unwrap_or_else(|broken| String::from_utf8_lossy(broken.as_bytes()).into_owned())
}

/// Hands on a piece that has something in it. False if it was not taken.
fn tell(emit: &mut dyn FnMut(Piece) -> bool, piece: Piece) -> bool {
    match &piece {
        Piece::Thinking { text } | Piece::Text { text } if text.is_empty() => true,
        _ => emit(piece),
    }
}

/// Reads a reply's stream to its end, handing on what the model wrote.
fn read(
    mut stream: impl BufRead, key: Option<&str>, stop: &AtomicBool, emit: &mut dyn FnMut(Piece) -> bool,
) -> Result<(), Failure> {
    let mut thinking = Sieve::new(key);
    let mut text = Sieve::new(key);
    let mut line = Vec::new();
    let mut total = 0;
    // Whether the server has said anything of the reply, and whether it has
    // said the reply is at its end.
    let mut heard = false;
    let mut finished = false;
    let outcome = loop {
        if stop.load(Ordering::Relaxed) {
            break Err(Failure::new("stopped"));
        }
        match next_line(&mut stream, &mut line) {
            // A server that has finished may hang up without saying it is done.
            Ok(0) if finished => break Ok(()),
            Ok(0) => break Err(Failure::new(if heard { "interrupted" } else { "answer" })),
            Ok(read) => total += read,
            Err(_) if finished => break Ok(()),
            Err(failure) => break Err(failure),
        }
        if total > REPLY_LIMIT {
            break Err(Failure::new("long"));
        }
        match parse(&line) {
            Line::Other => {}
            Line::Done => break Ok(()),
            Line::Error => break Err(Failure::new("server")),
            Line::Malformed => break Err(Failure::new("answer")),
            Line::Chunk { thinking: thought, text: said, finished: last } => {
                heard = true;
                finished |= last;
                let taken = tell(emit, Piece::Thinking { text: thinking.pass(&thought) })
                    && tell(emit, Piece::Text { text: text.pass(&said) });
                if !taken {
                    break Err(Failure::new("unheard"));
                }
            }
        }
    };
    // Whatever was held back in case it began a key did not.
    tell(emit, Piece::Thinking { text: thinking.rest() });
    tell(emit, Piece::Text { text: text.rest() });
    outcome
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Cursor, Write};
    use std::net::TcpListener;
    use std::thread;
    use std::time::Instant;
    use crate::providers::tests::server;

    fn thinking(text: &str) -> Piece {
        Piece::Thinking { text: text.into() }
    }

    fn text(text: &str) -> Piece {
        Piece::Text { text: text.into() }
    }

    /// What reading `stream` hands on, and how it ends.
    fn reading(stream: &str, key: Option<&str>) -> (Vec<Piece>, Result<(), Failure>) {
        let mut pieces = Vec::new();
        let outcome = read(Cursor::new(stream), key, &AtomicBool::new(false), &mut |piece| {
            pieces.push(piece);
            true
        });
        (pieces, outcome)
    }

    fn chunk(delta: Value) -> String {
        format!("data: {}\n\n", json!({ "choices": [{ "index": 0, "delta": delta, "finish_reason": null }] }))
    }

    const FINISH: &str = "data: {\"choices\":[{\"delta\":{},\"finish_reason\":\"stop\"}]}\n\n";

    #[test]
    fn reads_each_kind_of_line() {
        for line in ["", "\n", "\r\n", ": keep-alive\n", "event: message\n", "id: 1\n", "data:\n", "data: \r\n",
            "{\"choices\":[]}\n"]
        {
            assert_eq!(parse(line.as_bytes()), Line::Other, "{line:?}");
        }
        for line in ["data: [DONE]\n", "data:[DONE]\r\n", "data: [DONE]"] {
            assert_eq!(parse(line.as_bytes()), Line::Done);
        }
        for line in ["data: not json\n", "data: {\n", "data: [DONE] \u{0}\n"] {
            assert_eq!(parse(line.as_bytes()), Line::Malformed);
        }
        assert_eq!(parse(b"data: {\"error\":{\"message\":\"private detail\"}}\n"), Line::Error);
        let quiet = Line::Chunk { thinking: String::new(), text: String::new(), finished: false };
        for line in ["data: {}\n", "data: {\"choices\":[]}\n", "data: {\"error\":null,\"choices\":[{}]}\n",
            "data: {\"choices\":[{\"delta\":{\"role\":\"assistant\",\"content\":null}}]}\n",
            "data: {\"choices\":[{\"delta\":{\"content\":12,\"reasoning\":{}}}]}\n", "data: 12\n"]
        {
            assert_eq!(parse(line.as_bytes()), quiet, "{line:?}");
        }
        assert_eq!(parse(chunk(json!({"content": "Hi", "reasoning_content": "Hm"})).as_bytes()),
            Line::Chunk { thinking: "Hm".into(), text: "Hi".into(), finished: false });
        assert_eq!(parse(chunk(json!({"reasoning": "Hm"})).as_bytes()),
            Line::Chunk { thinking: "Hm".into(), text: String::new(), finished: false });
        assert_eq!(parse(chunk(json!({"reasoning_content": "", "reasoning": "Hm"})).as_bytes()),
            Line::Chunk { thinking: "Hm".into(), text: String::new(), finished: false });
        assert_eq!(parse(FINISH.as_bytes()),
            Line::Chunk { thinking: String::new(), text: String::new(), finished: true });
    }

    #[test]
    fn hands_on_a_reply_in_order_and_stops_at_done() {
        let stream = [chunk(json!({"role": "assistant", "content": null})), chunk(json!({"reasoning_content": "Hm"})),
            ": a comment\n".into(), chunk(json!({"content": "Hel"})), chunk(json!({"content": "lo"})),
            FINISH.into(), "data: {\"choices\":[],\"usage\":{}}\n\n".into(), "data: [DONE]\n\n".into(),
            chunk(json!({"content": "never read"}))].concat();
        assert_eq!(reading(&stream, None), (vec![thinking("Hm"), text("Hel"), text("lo")], Ok(())));
        // Line breaks of either kind, and a last line without one.
        let stream = "data: {\"choices\":[{\"delta\":{\"content\":\"a\"}}]}\r\n\r\ndata: [DONE]";
        assert_eq!(reading(stream, None), (vec![text("a")], Ok(())));
    }

    #[test]
    fn tells_a_finished_reply_from_one_cut_short() {
        let said = chunk(json!({"content": "Hi"}));
        assert_eq!(reading(&[&said, FINISH].concat(), None), (vec![text("Hi")], Ok(())));
        assert_eq!(reading(&said, None), (vec![text("Hi")], Err(Failure::new("interrupted"))));
        for nothing in ["", "<html>not a stream</html>", "{\"choices\":[{\"message\":{\"content\":\"whole\"}}]}"] {
            assert_eq!(reading(nothing, None), (vec![], Err(Failure::new("answer"))));
        }
        assert_eq!(reading(&[&said, "data: {\"error\":{\"message\":\"private\"}}\n"].concat(), None),
            (vec![text("Hi")], Err(Failure::new("server"))));
        assert_eq!(reading(&[&said, "data: nonsense\n"].concat(), None),
            (vec![text("Hi")], Err(Failure::new("answer"))));
    }

    #[test]
    fn refuses_a_line_or_a_stream_beyond_the_limits() {
        let long = format!("data: {}\n", "x".repeat(LINE_LIMIT));
        assert_eq!(reading(&long, None), (vec![], Err(Failure::new("long"))));
        let mut line = Vec::new();
        let exact = format!("{}\n", "x".repeat(LINE_LIMIT - 1));
        assert_eq!(next_line(&mut Cursor::new(&exact), &mut line), Ok(LINE_LIMIT as u64));

        /// The same comment line without end, so that nothing has to hold it all.
        struct Endless;
        impl Read for Endless {
            fn read(&mut self, buffer: &mut [u8]) -> std::io::Result<usize> {
                buffer.fill(b'\n');
                Ok(buffer.len())
            }
        }
        let outcome = read(BufReader::new(Endless), None, &AtomicBool::new(false), &mut |_| true);
        assert_eq!(outcome, Err(Failure::new("long")));
    }

    #[test]
    fn stops_when_asked_or_when_nobody_listens() {
        let stream = [chunk(json!({"content": "a"})), chunk(json!({"content": "b"})), FINISH.into()].concat();
        let stop = AtomicBool::new(false);
        let mut pieces = Vec::new();
        let outcome = read(Cursor::new(&stream), None, &stop, &mut |piece| {
            pieces.push(piece);
            stop.store(true, Ordering::Relaxed);
            true
        });
        assert_eq!((pieces, outcome), (vec![text("a")], Err(Failure::new("stopped"))));
        let outcome = read(Cursor::new(&stream), None, &AtomicBool::new(false), &mut |_| false);
        assert_eq!(outcome, Err(Failure::new("unheard")));

        struct Broken;
        impl Read for Broken {
            fn read(&mut self, _: &mut [u8]) -> std::io::Result<usize> {
                Err(std::io::ErrorKind::ConnectionReset.into())
            }
        }
        let silent = std::io::Error::from(std::io::ErrorKind::TimedOut);
        assert_eq!(read(BufReader::new(Broken), None, &stop, &mut |_| true), Err(Failure::new("stopped")));
        let stop = AtomicBool::new(false);
        assert_eq!(read(BufReader::new(Broken), None, &stop, &mut |_| true), Err(Failure::new("interrupted")));
        assert_eq!(providers::transport_error(silent.into()).kind, "timeout");
        // A connection that breaks after the reply's end takes nothing from it.
        let ended = Cursor::new(FINISH).chain(Broken);
        assert_eq!(read(BufReader::new(ended), None, &stop, &mut |_| true), Ok(()));
    }

    #[test]
    fn a_key_never_passes_however_it_is_cut_up() {
        let key = "sk-dummy-key";
        let mut sieve = Sieve::new(Some(key));
        assert_eq!(sieve.pass("Your key is sk-"), "Your key is ");
        assert_eq!(sieve.pass("dummy"), "");
        assert_eq!(sieve.pass("-key, and sk-dummy-keys"), "\n, and \n");
        assert_eq!(sieve.pass("k"), "");
        assert_eq!(sieve.pass("ip"), "skip");
        assert_eq!(sieve.pass(" sk-sk-dummy-kez s"), " sk-sk-dummy-kez ");
        assert_eq!(sieve.rest(), "s");
        assert_eq!(sieve.rest(), "");
        // What comes before a key and what comes after it cannot join into one.
        let mut sieve = Sieve::new(Some("ab"));
        assert_eq!([sieve.pass("a"), sieve.pass("ab"), sieve.pass("b!")].concat(), "a\nb!");
        assert_eq!(Sieve::new(Some("ab")).pass("aabb"), "a\nb");
        // A key that repeats itself is found wherever it starts.
        assert_eq!(Sieve::new(Some("aab")).pass("aaab aaaab"), "a\n aa\n");
        let mut sieve = Sieve::new(Some("abab"));
        assert_eq!((sieve.pass("abaabab ababab"), sieve.rest()), ("aba\n \n".into(), "ab".into()));
        // Characters of more than one byte are never split.
        let mut sieve = Sieve::new(Some("éa"));
        assert_eq!(sieve.pass("xé"), "x");
        assert_eq!(sieve.pass("b"), "éb");
        let mut sieve = Sieve::new(Some("é"));
        assert_eq!([sieve.pass("è"), sieve.pass("é"), sieve.pass("ë")].concat(), "è\në");
        let mut none = Sieve::new(None);
        assert_eq!((none.pass("sk-dummy-key"), none.rest()), ("sk-dummy-key".into(), String::new()));

        for size in 1..key.len() + 2 {
            let reply = format!("a {key} b {key}{key} c");
            let stream: String = reply.as_bytes().chunks(size)
                .map(|part| chunk(json!({"content": std::str::from_utf8(part).unwrap(), "reasoning": "sk-dummy-"})))
                .chain([FINISH.to_owned()]).collect();
            let (pieces, outcome) = reading(&stream, Some(key));
            assert_eq!(outcome, Ok(()));
            let said: String = pieces.iter().filter_map(|piece| match piece {
                Piece::Text { text } => Some(text.as_str()),
                _ => None,
            }).collect();
            assert_eq!(said, "a \n b \n\n c", "in parts of {size}");
            assert!(pieces.iter().all(|piece| !format!("{piece:?}").contains(key)));
        }
    }

    #[test]
    fn a_reply_made_to_be_slow_to_sift_is_not() {
        // Each of these makes a reader that starts over at every near miss
        // do work that grows with the square of the length.
        let started = Instant::now();
        for (key, reply) in [("ab", ["a".repeat(500_000), "b".repeat(500_000)].concat()),
            (&["a".repeat(4095), "b".into()].concat(), "a".repeat(1_000_000))]
        {
            let mut sieve = Sieve::new(Some(key));
            let passed: usize = reply.as_bytes().chunks(7)
                .map(|part| sieve.pass(std::str::from_utf8(part).unwrap()).len()).sum();
            assert!(passed + sieve.rest().len() <= reply.len());
        }
        assert!(started.elapsed() < Duration::from_secs(5));
    }

    /// What stops a reply nobody will stop.
    fn halt() -> Halt {
        Replies::default().begin("test").unwrap().halt.clone()
    }

    fn turns() -> Vec<Turn> {
        vec![Turn { role: Role::User, content: "Hi".into() },
            Turn { role: Role::Assistant, content: "Hello".into() },
            Turn { role: Role::User, content: "Bye \"now\"".into() }]
    }

    fn stream(body: &str) -> String {
        format!("HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nConnection: close\r\n\r\n{body}")
    }

    #[test]
    fn sends_the_conversation_and_the_key_to_the_chat_endpoint() {
        for key in [None, Some("dummy-key")] {
            let (address, thread) = server(vec![stream(&[&chunk(json!({"content": "Bye"})), "data: [DONE]\n\n"].concat())]);
            let mut pieces = Vec::new();
            let outcome = ask(&halt(), &address, key, "some/model:1", &turns(), &mut |piece| {
                pieces.push(piece);
                true
            });
            assert_eq!((pieces, outcome), (vec![text("Bye")], Ok(())));
            let request = thread.join().unwrap().remove(0);
            let (head, body) = request.split_once("\r\n\r\n").unwrap();
            assert!(head.starts_with("POST /v1/chat/completions HTTP/1.1\r\n"));
            let head = head.to_ascii_lowercase();
            assert!(head.contains("content-type: application/json"));
            assert_eq!(head.contains("authorization: bearer dummy-key"), key.is_some());
            assert_eq!(head.contains("authorization:"), key.is_some());
            assert_eq!(serde_json::from_str::<Value>(body).unwrap(), json!({
                "model": "some/model:1",
                "stream": true,
                "messages": [{"role": "user", "content": "Hi"}, {"role": "assistant", "content": "Hello"},
                    {"role": "user", "content": "Bye \"now\""}],
            }));
        }
    }

    #[test]
    fn a_refusal_is_named_by_its_status_and_its_body_is_not_read() {
        for (status, kind) in [(400, "request"), (413, "request"), (422, "request"), (401, "refused"),
            (403, "refused"), (404, "missing"), (429, "limit"), (500, "server"), (302, "redirect")]
        {
            let (address, thread) = server(vec![format!(
                "HTTP/1.1 {status} Whatever\r\nLocation: http://127.0.0.1:9/\r\nConnection: close\r\n\r\n{}",
                chunk(json!({"content": "private detail"})))]);
            let mut pieces = Vec::new();
            let outcome = ask(&halt(), &address, Some("dummy-key"), "model", &turns(), &mut |piece| {
                pieces.push(piece);
                true
            });
            assert_eq!((pieces, outcome), (vec![], Err(Failure::new(kind).at(status))));
            thread.join().unwrap();
        }
    }

    #[test]
    fn nothing_is_sent_for_a_reply_already_stopped() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let address = Address::parse(&format!("http://{}/v1", listener.local_addr().unwrap())).unwrap();
        let replies = Replies::default();
        let writing = replies.begin("one").unwrap();
        replies.stop("one");
        let outcome = ask(&writing.halt, &address, None, "model", &turns(), &mut |_| true);
        assert_eq!(outcome, Err(Failure::new("stopped")));
        assert_eq!(listener.accept().unwrap_err().kind(), std::io::ErrorKind::WouldBlock);
    }

    #[test]
    fn a_stop_ends_a_reply_that_is_waiting_on_a_silent_server() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = Address::parse(&format!("http://{}/v1", listener.local_addr().unwrap())).unwrap();
        // Says one thing, then nothing, until the client hangs up.
        let server = thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            stream.set_read_timeout(Some(Duration::from_secs(20))).unwrap();
            let mut request = [0; 4096];
            let _ = stream.read(&mut request).unwrap();
            stream.write_all(self::stream(&chunk(json!({"content": "Hi"}))).as_bytes()).unwrap();
            let started = Instant::now();
            while stream.read(&mut request).is_ok_and(|read| read > 0) {}
            started.elapsed()
        });
        let replies = Replies::default();
        let writing = replies.begin("one").unwrap();
        let other = replies.begin("two").unwrap();
        let mut pieces = Vec::new();
        let (heard, hearing) = std::sync::mpsc::channel();
        let outcome = thread::scope(|scope| {
            // Stopped from elsewhere, once the reader is waiting for more.
            let replies = &replies;
            scope.spawn(move || {
                hearing.recv().unwrap();
                thread::sleep(Duration::from_millis(200));
                replies.stop("one");
            });
            ask(&writing.halt, &address, None, "model", &turns(), &mut |piece| {
                pieces.push(piece);
                heard.send(()).unwrap();
                true
            })
        });
        assert_eq!((pieces, outcome), (vec![text("Hi")], Err(Failure::new("stopped"))));
        // The server saw the connection close, long before it would have gone quiet.
        assert!(server.join().unwrap() < Duration::from_secs(10));
        assert!(!other.halt.stop.load(Ordering::Relaxed));
    }

    #[test]
    fn validates_models_and_turns() {
        for model in ["", "a\nb", "a\u{0}", &"x".repeat(201)] {
            assert!(validate_model(model).is_err());
        }
        for model in ["gpt", "models/Some-GGUF/model.Q2_K_XL.gguf", "org/name:free", &"é".repeat(200)] {
            assert!(validate_model(model).is_ok());
        }
        assert!(serde_json::from_value::<Vec<Turn>>(json!([{"role": "user", "content": "a"}])).is_ok());
        for turn in [json!({"role": "system", "content": "a"}), json!({"role": "user"}),
            json!({"role": "User", "content": "a"}), json!({"role": "user", "content": 1})]
        {
            assert!(serde_json::from_value::<Turn>(turn).is_err());
        }
    }

    #[test]
    fn a_reply_holds_its_place_until_it_ends_and_can_be_stopped_meanwhile() {
        let replies = Replies::default();
        let writing = replies.begin("one").unwrap();
        assert_eq!(replies.begin("one").err(), Some(Failure::new("address")));
        let other = replies.begin("two").unwrap();
        replies.stop("one");
        assert!(writing.halt.stop.load(Ordering::Relaxed));
        assert!(!other.halt.stop.load(Ordering::Relaxed));
        drop(writing);
        // A name is free again once its reply has ended.
        assert!(!replies.begin("one").unwrap().halt.stop.load(Ordering::Relaxed));
        assert_eq!(replies.lock().writing.len(), 1);
    }

    #[test]
    fn a_stop_that_comes_before_its_reply_still_stops_it() {
        let replies = Replies::default();
        replies.stop("early");
        assert_eq!(replies.begin("early").err(), Some(Failure::new("stopped")));
        // Once: the name is then as free as any other.
        assert!(replies.begin("early").is_ok());
        // Only so many are remembered, the newest ones.
        for name in 0..EARLY_STOPS + 1 {
            replies.stop(&name.to_string());
        }
        assert_eq!(replies.lock().stopped.len(), EARLY_STOPS);
        assert!(replies.begin("0").is_ok());
        assert_eq!(replies.begin("1").err(), Some(Failure::new("stopped")));
        assert_eq!(replies.lock().stopped.len(), EARLY_STOPS - 1);
    }

    #[test]
    fn pieces_reach_the_page_as_a_kind_and_its_text() {
        assert_eq!(serde_json::to_value(text("Hi")).unwrap(), json!({"kind": "text", "text": "Hi"}));
        assert_eq!(serde_json::to_value(thinking("Hm")).unwrap(), json!({"kind": "thinking", "text": "Hm"}));
        assert_eq!(serde_json::to_value(Piece::End { failure: None }).unwrap(), json!({"kind": "end"}));
        assert_eq!(serde_json::to_value(Piece::End { failure: Some(Failure::new("request").at(400)) }).unwrap(),
            json!({"kind": "end", "failure": {"kind": "request", "status": 400}}));
    }
}
