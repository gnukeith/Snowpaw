//! One reply from a model. The conversation goes to the chat endpoint of a
//! saved connection, with that connection's key if it has one, and what the
//! model writes is handed to the page piece by piece as it arrives.

use std::collections::HashMap;
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
/// A server that says nothing for this long is given up on. A model is loaded
/// and a long conversation is read in silence, so this is generous.
const QUIET: Duration = Duration::from_secs(300);
const CONNECT: Duration = Duration::from_secs(20);

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

/// The replies being written, each with the flag that stops it.
#[derive(Default)]
pub(crate) struct Replies(Mutex<HashMap<String, Arc<AtomicBool>>>);

impl Replies {
    fn lock(&self) -> MutexGuard<'_, HashMap<String, Arc<AtomicBool>>> {
        self.0.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// Takes a place for a reply under the name the page gave it. None if a
    /// reply is already being written under that name.
    fn begin(&self, request: &str) -> Option<Writing<'_>> {
        let mut replies = self.lock();
        if replies.contains_key(request) {
            return None;
        }
        let stop = Arc::new(AtomicBool::new(false));
        replies.insert(request.to_owned(), Arc::clone(&stop));
        Some(Writing { replies: self, request: request.to_owned(), stop })
    }

    /// Asks the reply under that name to stop. One that has ended, or that
    /// never began, is nothing to stop.
    fn stop(&self, request: &str) {
        if let Some(stop) = self.lock().get(request) {
            stop.store(true, Ordering::Relaxed);
        }
    }
}

/// A reply's place among those being written, given up when it is dropped.
struct Writing<'a> {
    replies: &'a Replies,
    request: String,
    stop: Arc<AtomicBool>,
}

impl Drop for Writing<'_> {
    fn drop(&mut self) {
        self.replies.lock().remove(&self.request);
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
        let writing = replies.begin(&request).ok_or_else(|| Failure::new("address"))?;
        let key = secrets::lookup(&id, &address.origin()).await?;
        // As with the list of models: a provider that wants a key is not
        // sent a conversation without one.
        if needs_key == Some(true) && key.is_none() {
            return Err(Failure::new("refused"));
        }
        let stop = Arc::clone(&writing.stop);
        tauri::async_runtime::spawn_blocking(move || {
            let key = key.as_deref().map(String::as_str);
            ask(&address, key, &model, &turns, &stop, &mut |piece| page.send(piece).is_ok())
        }).await.map_err(|_| Failure::new("answer"))?
    }.await;
    // Nobody is left to tell if the page has gone.
    let _ = pieces.send(Piece::End { failure: outcome.err() });
    Ok(())
}

/// Stops a reply. It ends when the server next says something or goes quiet
/// for too long, which is when the connection to it is closed.
#[tauri::command]
pub(crate) fn chat_stop(replies: State<'_, Replies>, request: String) {
    replies.stop(&request);
}

/// A conversation is turned down for more reasons than a key is.
fn reply_status(status: u16) -> Result<(), Failure> {
    match status {
        400 | 413 | 422 => Err(Failure::new("request").at(status)),
        _ => providers::status_result(status),
    }
}

fn ask(
    address: &Address, key: Option<&str>, model: &str, turns: &[Turn], stop: &AtomicBool,
    emit: &mut dyn FnMut(Piece) -> bool,
) -> Result<(), Failure> {
    let body = serde_json::to_vec(&json!({ "model": model, "messages": turns, "stream": true }))
        .map_err(|_| Failure::new("answer"))?;
    let bearer = key.map(|key| Zeroizing::new(format!("Bearer {key}")));
    // No limit on the whole exchange: a long answer is not a failure. Each
    // wait within it has one.
    let agent: ureq::Agent = providers::settings()
        .timeout_resolve(Some(CONNECT))
        .timeout_connect(Some(CONNECT))
        .timeout_per_read(Some(QUIET))
        .timeout_per_write(Some(QUIET))
        .build().into();
    let mut request = agent.post(&address.endpoint("/chat/completions"))
        .header("Accept", "text/event-stream")
        .content_type("application/json");
    if let Some(bearer) = &bearer {
        request = request.header("Authorization", providers::secret_header(bearer)?);
    }
    if stop.load(Ordering::Relaxed) {
        return Err(Failure::new("stopped"));
    }
    let response = request.send(&body[..]).map_err(providers::transport_error)?;
    reply_status(response.status().as_u16())?;
    read(BufReader::new(response.into_body().into_reader()), key, stop, emit)
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

/// Keeps the connection's key out of a reply. A server may echo it, and a key
/// never goes to the page. Text passes through as it arrives, less any ending
/// that could be the start of the key: that waits for what follows it.
struct Sieve<'a> {
    key: Option<&'a str>,
    held: String,
}

impl<'a> Sieve<'a> {
    fn new(key: Option<&'a str>) -> Self {
        Self { key, held: String::new() }
    }

    fn pass(&mut self, more: &str) -> String {
        let Some(key) = self.key else { return more.to_owned() };
        self.held.push_str(more);
        // Taking a key out can bring the halves of another together.
        while self.held.contains(key) {
            self.held = self.held.replace(key, "");
        }
        let held = (1..key.len()).rev()
            .find(|&length| key.is_char_boundary(length) && self.held.ends_with(&key[..length]))
            .unwrap_or(0);
        let rest = self.held.split_off(self.held.len() - held);
        std::mem::replace(&mut self.held, rest)
    }

    /// What was held back, once nothing more can follow it.
    fn rest(&mut self) -> String {
        std::mem::take(&mut self.held)
    }
}

/// Hands on a piece that has something in it. False once nobody takes them.
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
                    break Err(Failure::new("stopped"));
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
    use std::io::Cursor;
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
        assert_eq!(outcome, Err(Failure::new("stopped")));

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
        assert_eq!(sieve.pass("-key, and sk-dummy-keys"), ", and ");
        assert_eq!(sieve.pass("k"), "");
        assert_eq!(sieve.pass("ip"), "skip");
        assert_eq!(sieve.pass(" s"), " ");
        assert_eq!(sieve.rest(), "s");
        assert_eq!(sieve.rest(), "");
        // A key cut out must not leave a key behind.
        assert_eq!(Sieve::new(Some("ab")).pass("aabb!"), "!");
        // Characters of more than one byte are never split.
        let mut sieve = Sieve::new(Some("éa"));
        assert_eq!(sieve.pass("xé"), "x");
        assert_eq!(sieve.pass("b"), "éb");
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
            assert_eq!(said, "a  b  c", "in parts of {size}");
            assert!(pieces.iter().all(|piece| !format!("{piece:?}").contains(key)));
        }
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
            let outcome = ask(&address, key, "some/model:1", &turns(), &AtomicBool::new(false), &mut |piece| {
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
            let outcome = ask(&address, Some("dummy-key"), "model", &turns(), &AtomicBool::new(false), &mut |piece| {
                pieces.push(piece);
                true
            });
            assert_eq!((pieces, outcome), (vec![], Err(Failure::new(kind).at(status))));
            thread.join().unwrap();
        }
    }

    #[test]
    fn nothing_is_sent_for_a_reply_already_stopped() {
        let (address, _thread) = server(vec![]);
        let outcome = ask(&address, None, "model", &turns(), &AtomicBool::new(true), &mut |_| true);
        assert_eq!(outcome, Err(Failure::new("stopped")));
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
        assert!(replies.begin("one").is_none());
        let other = replies.begin("two").unwrap();
        replies.stop("one");
        replies.stop("nobody");
        assert!(writing.stop.load(Ordering::Relaxed));
        assert!(!other.stop.load(Ordering::Relaxed));
        drop(writing);
        // A new reply under a name that was stopped starts unstopped.
        assert!(!replies.begin("one").unwrap().stop.load(Ordering::Relaxed));
        assert_eq!(replies.lock().len(), 1);
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
