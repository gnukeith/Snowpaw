use std::collections::BTreeSet;
use std::error::Error;
use std::io::{self, Read};
use std::time::Duration;
use serde::Serialize;
use serde_json::Value;
use ureq::http::HeaderValue;
use ureq::tls::{RootCerts, TlsConfig, TlsProvider};
use url::Url;
use zeroize::Zeroizing;
use crate::secrets;

const BODY_LIMIT: u64 = 8 * 1024 * 1024;
const SEARCH_ORIGIN: &str = "https://api.search.brave.com";
const SEARCH_URL: &str = "https://api.search.brave.com/res/v1/web/search?q=snowpaw&count=1";

// Only this small, fixed vocabulary crosses back into the webview. In
// particular, neither a library error nor a provider's body is an error value.
#[derive(Debug, PartialEq, Eq, Serialize)]
pub(crate) struct Failure {
    pub(crate) kind: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) status: Option<u16>,
}

impl Failure {
    pub(crate) fn new(kind: &'static str) -> Self {
        Self { kind, status: None }
    }

    fn at(mut self, status: u16) -> Self {
        self.status = Some(status);
        self
    }
}

pub(crate) struct Address(Url);

impl Address {
    pub(crate) fn parse(address: &str) -> Result<Self, Failure> {
        let url = Url::parse(address).map_err(|_| Failure::new("address"))?;
        // URL parsing erases empty user info, so check the authority as well.
        let authority = address.split_once(':').map(|(_, rest)| {
            rest.trim_start_matches(['/', '\\']).split(['/', '?', '#', '\\']).next().unwrap_or_default()
        });
        if !matches!(url.scheme(), "http" | "https") || url.host_str().is_none()
            || !url.username().is_empty() || url.password().is_some()
            || authority.is_some_and(|part| part.contains('@'))
        {
            return Err(Failure::new("address"));
        }
        Ok(Self(url))
    }

    pub(crate) fn origin(&self) -> String {
        self.0.origin().ascii_serialization()
    }

    pub(crate) fn host(&self) -> &str {
        self.0.host_str().unwrap_or_default()
    }

    fn endpoint(&self, suffix: &str) -> String {
        let mut url = self.0.clone();
        // Set the path, rather than joining a URL: even a proof beginning with
        // two slashes must stay at the saved origin.
        url.set_path(&format!("{}{}", url.path().trim_end_matches('/'), suffix));
        url.set_fragment(None);
        url.into()
    }
}

pub(crate) fn validate_id(id: &str) -> Result<(), Failure> {
    if id.is_empty() || id.len() > 64
        || !id.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'-')
    {
        return Err(Failure::new("address"));
    }
    Ok(())
}

pub(crate) fn validate_key(key: &str) -> Result<&str, Failure> {
    let key = key.trim();
    if key.is_empty() || key.len() > 4096 || key.chars().any(char::is_control) {
        return Err(Failure::new("address"));
    }
    Ok(key)
}

fn validate_proof(proof: Option<&str>) -> Result<(), Failure> {
    if proof.is_some_and(|path| !path.starts_with('/') || !path.bytes().all(|c| {
        c.is_ascii_alphanumeric() || matches!(c, b'/' | b'_' | b'-')
    })) {
        return Err(Failure::new("address"));
    }
    Ok(())
}

#[tauri::command]
pub(crate) async fn models_list(
    id: String, address: String, proof: Option<String>,
) -> Result<Vec<String>, Failure> {
    validate_id(&id)?;
    let address = Address::parse(&address)?;
    validate_proof(proof.as_deref())?;
    let key = secrets::lookup(&id, &address.origin()).await?;
    tauri::async_runtime::spawn_blocking(move || {
        list(&address, key.as_deref().map(String::as_str), proof.as_deref())
    }).await.map_err(|_| Failure::new("answer"))?
}

#[tauri::command]
pub(crate) async fn search_test() -> Result<(), Failure> {
    let key = secrets::lookup("search", SEARCH_ORIGIN).await?
        .ok_or_else(|| Failure::new("refused"))?;
    tauri::async_runtime::spawn_blocking(move || {
        let (status, body) = get(&agent(), SEARCH_URL, Some(("X-Subscription-Token", &key)))?;
        let value: Value = serde_json::from_slice(&body)
            .map_err(|_| Failure::new("answer").at(status))?;
        // A successful search can have no web results, but must identify the query.
        if value.get("query").and_then(|q| q.get("original")).and_then(Value::as_str).is_none() {
            return Err(Failure::new("answer").at(status));
        }
        Ok(())
    }).await.map_err(|_| Failure::new("answer"))?
}

fn agent() -> ureq::Agent {
    ureq::Agent::config_builder()
        .tls_config(TlsConfig::builder()
            .provider(TlsProvider::NativeTls)
            .root_certs(RootCerts::PlatformVerifier)
            .build())
        .max_redirects(0)
        .max_redirects_will_error(false)
        .http_status_as_error(false)
        .timeout_global(Some(Duration::from_secs(20)))
        // Do not let a process environment variable route provider keys through
        // a proxy. Local providers must also remain local.
        .proxy(None)
        .build().into()
}

fn status_result(status: u16) -> Result<(), Failure> {
    let kind = match status {
        200..=299 => return Ok(()),
        300..=399 => "redirect",
        400 | 401 | 403 | 422 => "refused",
        404 => "missing",
        429 => "limit",
        500..=599 => "server",
        _ => "answer",
    };
    Err(Failure::new(kind).at(status))
}

fn transport_error(error: ureq::Error) -> Failure {
    let kind = match error {
        ureq::Error::Timeout(_) => "timeout",
        // native-tls exposes OpenSSL's error stack through its source. Inspect
        // the fixed reason, never the formatted error or its private data.
        ureq::Error::NativeTls(error) => {
            let certificate = error.source()
                .and_then(|source| source.downcast_ref::<openssl::error::ErrorStack>())
                .is_some_and(|stack| stack.errors().iter().any(|error| {
                    error.reason() == Some("certificate verify failed")
                }));
            if certificate { "certificate" } else { "answer" }
        },
        ureq::Error::HostNotFound | ureq::Error::ConnectionFailed => "unreachable",
        ureq::Error::Io(ref error) => match error.kind() {
            io::ErrorKind::TimedOut | io::ErrorKind::WouldBlock => "timeout",
            io::ErrorKind::ConnectionRefused | io::ErrorKind::NotConnected
            | io::ErrorKind::AddrNotAvailable | io::ErrorKind::NetworkUnreachable
            | io::ErrorKind::HostUnreachable => "unreachable",
            _ => "answer",
        },
        _ => "answer",
    };
    Failure::new(kind)
}

fn secret_header(value: &str) -> Result<HeaderValue, Failure> {
    let mut header = HeaderValue::from_bytes(value.as_bytes())
        .map_err(|_| Failure::new("address"))?;
    header.set_sensitive(true);
    Ok(header)
}

fn get(agent: &ureq::Agent, url: &str, auth: Option<(&str, &str)>) -> Result<(u16, Vec<u8>), Failure> {
    let mut request = agent.get(url).header("Accept", "application/json");
    if let Some((name, value)) = auth {
        request = request.header(name, secret_header(value)?);
    }
    let mut response = request.call().map_err(transport_error)?;
    let status = response.status().as_u16();
    status_result(status)?;
    let mut body = Vec::new();
    response.body_mut().as_reader().take(BODY_LIMIT + 1).read_to_end(&mut body)
        .map_err(|error| transport_error(error.into()).at(status))?;
    if body.len() as u64 > BODY_LIMIT {
        return Err(Failure::new("answer").at(status));
    }
    Ok((status, body))
}

fn list(address: &Address, key: Option<&str>, proof: Option<&str>) -> Result<Vec<String>, Failure> {
    validate_proof(proof)?;
    let bearer = key.map(|key| Zeroizing::new(format!("Bearer {key}")));
    let auth = bearer.as_ref().map(|value| ("Authorization", value.as_str()));
    let agent = agent();
    let (status, body) = get(&agent, &address.endpoint("/models"), auth)?;
    let models = parse_models(&body, key).map_err(|error| error.at(status))?;
    if let Some(proof) = proof.filter(|_| key.is_some()) {
        get(&agent, &address.endpoint(proof), auth)?;
    }
    Ok(models)
}

fn parse_models(body: &[u8], key: Option<&str>) -> Result<Vec<String>, Failure> {
    let value: Value = serde_json::from_slice(body).map_err(|_| Failure::new("answer"))?;
    let entries = value.as_array()
        .or_else(|| value.get("data").and_then(Value::as_array))
        .or_else(|| value.get("models").and_then(Value::as_array))
        .ok_or_else(|| Failure::new("answer"))?;
    let mut models = BTreeSet::new();
    for entry in entries {
        let Some(id) = entry.get("id").and_then(Value::as_str)
            .or_else(|| entry.get("name").and_then(Value::as_str)) else { continue };
        if id.is_empty() || id.chars().count() > 200 || id.chars().any(char::is_control)
            // A server may echo the credential; never return that to the page.
            || key.is_some_and(|key| id.contains(key))
        {
            continue;
        }
        models.insert(id.to_owned());
        if models.len() > 2000 {
            models.pop_last();
        }
    }
    Ok(models.into_iter().collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use std::net::TcpListener;
    use std::thread;
    use std::time::Instant;
    use serde_json::json;

    #[test]
    fn validates_addresses_and_normalizes_origins() {
        for address in ["", "localhost:1234", "file:///tmp/a", "ftp://example.com", "https://",
            "https://user@example.com", "https://:pass@example.com", "https://@example.com", "https:@example.com"]
        {
            assert_eq!(Address::parse(address).err(), Some(Failure::new("address")));
        }
        for (address, origin) in [
            ("HTTPS://EXAMPLE.COM:443/v1/", "https://example.com"),
            ("http://EXAMPLE.COM:80", "http://example.com"),
            ("http://localhost:1234/v1", "http://localhost:1234"),
            ("http://[::1]:80/v1", "http://[::1]"),
        ] {
            assert_eq!(Address::parse(address).unwrap().origin(), origin);
        }
        let address = Address::parse("https://example.com/v1/").unwrap();
        assert_eq!(address.endpoint("/models"), "https://example.com/v1/models");
        assert_eq!(address.endpoint("//other-host/key"), "https://example.com/v1//other-host/key");
        assert_ne!(address.origin(), Address::parse("http://example.com").unwrap().origin());
        assert_ne!(address.origin(), Address::parse("https://example.com:444").unwrap().origin());
    }

    #[test]
    fn validates_ids_keys_and_proofs() {
        for id in ["", "a_b", "a/b", "a b", "é", &"a".repeat(65)] {
            assert!(validate_id(id).is_err());
        }
        assert!(validate_id("Connection-123").is_ok());
        assert!(validate_id(&"a".repeat(64)).is_ok());
        for key in ["", " \n ", "a\nb", "a\0b", "a\u{7f}b", "a\u{85}b", &"x".repeat(4097)] {
            assert!(validate_key(key).is_err());
        }
        assert_eq!(validate_key("  sample  "), Ok("sample"));
        assert!(validate_key(&"x".repeat(4096)).is_ok());
        assert!(validate_key(&"é".repeat(2049)).is_err());
        for proof in ["", "key", "/key?x", "/../key", "/%2fkey", "/key#", "/é", "/\\host"] {
            assert!(validate_proof(Some(proof)).is_err());
        }
        assert!(validate_proof(None).is_ok());
        assert!(validate_proof(Some("/key_1/check-2")).is_ok());
    }

    #[test]
    fn parses_all_list_shapes_and_drops_invalid_or_echoed_ids() {
        for value in [
            json!({"data": [{"id": "z"}, {"id": "a"}, {"id": "z"}]}),
            json!([{"id": "z"}, {"name": "a"}]),
            json!({"models": [{"name": "z"}, {"id": 42, "name": "a"}]}),
        ] {
            assert_eq!(parse_models(&serde_json::to_vec(&value).unwrap(), None).unwrap(), ["a", "z"]);
        }
        for body in [b"null".as_slice(), b"true", b"{}", b"{\"data\":{}}", b"not json"] {
            assert_eq!(parse_models(body, None), Err(Failure::new("answer")));
        }
        let value = json!({"data": [null, 12, "bad", {}, {"id": ""}, {"id": "a\nb"},
            {"id": "x".repeat(201)}, {"id": "é".repeat(200)}, {"id": "echo-dummy-key"}]});
        assert_eq!(parse_models(&serde_json::to_vec(&value).unwrap(), Some("dummy-key")).unwrap(),
            ["é".repeat(200)]);
        assert_eq!(parse_models(b"[]", None).unwrap(), Vec::<String>::new());
        let value: Vec<_> = (0..2100).rev().map(|i| json!({"id": format!("model-{i:04}")})).collect();
        let ids = parse_models(&serde_json::to_vec(&value).unwrap(), None).unwrap();
        assert_eq!(ids.len(), 2000);
        assert_eq!(ids.first().unwrap(), "model-0000");
        assert_eq!(ids.last().unwrap(), "model-1999");
    }

    #[test]
    fn maps_statuses_and_never_serializes_error_details() {
        for (status, kind) in [(100, "answer"), (301, "redirect"), (302, "redirect"),
            (307, "redirect"), (399, "redirect"), (400, "refused"), (401, "refused"),
            (403, "refused"), (422, "refused"), (404, "missing"), (429, "limit"),
            (500, "server"), (599, "server"), (402, "answer")]
        {
            let error = status_result(status).unwrap_err();
            assert_eq!(serde_json::to_value(error).unwrap(), json!({"kind": kind, "status": status}));
        }
        assert!(status_result(200).is_ok());
        assert_eq!(serde_json::to_value(Failure::new("timeout")).unwrap(), json!({"kind": "timeout"}));
        assert_eq!(transport_error(ureq::Error::HostNotFound).kind, "unreachable");
        assert_eq!(transport_error(io::Error::from(io::ErrorKind::TimedOut).into()).kind, "timeout");
        assert_eq!(transport_error(io::Error::from(io::ErrorKind::ConnectionRefused).into()).kind,
            "unreachable");
        assert!(!format!("{:?}", secret_header("dummy-key").unwrap()).contains("dummy-key"));
        assert_eq!(log::STATIC_MAX_LEVEL, log::LevelFilter::Off);
    }

    fn server(responses: Vec<String>) -> (Address, thread::JoinHandle<Vec<String>>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = Address::parse(&format!("http://{}/v1", listener.local_addr().unwrap())).unwrap();
        listener.set_nonblocking(true).unwrap();
        let thread = thread::spawn(move || {
            let mut requests = Vec::new();
            for response in responses {
                let deadline = Instant::now() + Duration::from_secs(5);
                let mut stream = loop {
                    match listener.accept() {
                        Ok((stream, _)) => break stream,
                        Err(error) if error.kind() == io::ErrorKind::WouldBlock => {
                            assert!(Instant::now() < deadline, "request did not arrive");
                            thread::sleep(Duration::from_millis(5));
                        }
                        Err(_) => panic!("test listener failed"),
                    }
                };
                stream.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
                let mut bytes = Vec::new();
                while !bytes.ends_with(b"\r\n\r\n") {
                    let mut byte = [0];
                    stream.read_exact(&mut byte).unwrap();
                    bytes.push(byte[0]);
                    assert!(bytes.len() < 16384);
                }
                requests.push(String::from_utf8(bytes).unwrap());
                // An oversized response can be cut off by the client before we finish.
                let _ = stream.write_all(response.as_bytes());
            }
            requests
        });
        (address, thread)
    }

    fn ok(body: &str) -> String {
        format!("HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len())
    }

    #[test]
    fn sends_authorization_and_requests_proof_only_with_a_key() {
        for key in [None, Some("dummy-key")] {
            let mut responses = vec![ok("{\"data\":[{\"id\":\"model\"}]}")];
            if key.is_some() { responses.push(ok("{}")); }
            let (address, thread) = server(responses);
            assert_eq!(list(&address, key, Some("/key")).unwrap(), ["model"]);
            let requests = thread.join().unwrap();
            assert_eq!(requests.len(), if key.is_some() { 2 } else { 1 });
            assert!(requests[0].starts_with("GET /v1/models HTTP/1.1\r\n"));
            for request in &requests {
                let request = request.to_ascii_lowercase();
                assert_eq!(request.contains("authorization: bearer dummy-key\r\n"), key.is_some());
                assert_eq!(request.contains("authorization:"), key.is_some());
            }
            if key.is_some() { assert!(requests[1].starts_with("GET /v1/key HTTP/1.1\r\n")); }
        }
    }

    #[test]
    fn proof_rejection_fails_the_list() {
        let (address, thread) = server(vec![ok("[]"),
            "HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\n\r\n".into()]);
        assert_eq!(list(&address, Some("dummy-key"), Some("/key")),
            Err(Failure::new("refused").at(401)));
        assert_eq!(thread.join().unwrap().len(), 2);
    }

    #[test]
    fn never_follows_a_redirect() {
        let target = TcpListener::bind("127.0.0.1:0").unwrap();
        target.set_nonblocking(true).unwrap();
        let (address, thread) = server(vec![format!(
            "HTTP/1.1 302 Found\r\nLocation: http://{}/stolen\r\nContent-Length: 0\r\n\r\n",
            target.local_addr().unwrap())]);
        assert_eq!(list(&address, Some("dummy-key"), None), Err(Failure::new("redirect").at(302)));
        thread.join().unwrap();
        assert_eq!(target.accept().unwrap_err().kind(), io::ErrorKind::WouldBlock);
    }

    #[test]
    fn a_plain_http_server_on_a_tls_port_is_not_a_certificate_failure() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("https://{}/models", listener.local_addr().unwrap());
        let thread = thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            stream.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
            let mut hello = [0; 64];
            stream.read_exact(&mut hello).unwrap();
            stream.write_all(b"HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\n\r\n").unwrap();
        });
        assert_eq!(get(&agent(), &url, None).err(), Some(Failure::new("answer")));
        thread.join().unwrap();
    }

    #[test]
    fn caps_bodies_with_and_without_content_length() {
        for known_length in [true, false] {
            let body = "x".repeat(BODY_LIMIT as usize + 1);
            let response = if known_length { ok(&body) } else {
                format!("HTTP/1.1 200 OK\r\nConnection: close\r\n\r\n{body}")
            };
            let (address, thread) = server(vec![response]);
            assert_eq!(get(&agent(), &address.endpoint("/models"), None).err(),
                Some(Failure::new("answer").at(200)));
            thread.join().unwrap();
        }
    }

    #[test]
    fn retains_status_when_a_success_body_is_malformed() {
        let (address, thread) = server(vec![ok("not json")]);
        assert_eq!(list(&address, None, None), Err(Failure::new("answer").at(200)));
        thread.join().unwrap();
    }

    #[test]
    fn brave_header_is_sent_without_bearer_auth() {
        let (address, thread) = server(vec![ok("{}")]);
        get(&agent(), &address.endpoint("/search"), Some(("X-Subscription-Token", "dummy-key"))).unwrap();
        let request = thread.join().unwrap().remove(0).to_ascii_lowercase();
        assert!(request.contains("x-subscription-token: dummy-key\r\n"));
        assert!(!request.contains("authorization:"));
    }

    #[test]
    #[ignore = "manual check: contacts OpenAI and badssl using system trust"]
    fn manual_system_certificates() {
        let openai = get(&agent(), "https://api.openai.com/v1/models", None).err().unwrap();
        println!("OpenAI without a key: {openai:?}");
        assert_eq!(openai, Failure::new("refused").at(401));
        let invalid = get(&agent(), "https://self-signed.badssl.com/", None).err().unwrap();
        println!("Self-signed certificate: {invalid:?}");
        assert_eq!(invalid, Failure::new("certificate"));
    }
}
