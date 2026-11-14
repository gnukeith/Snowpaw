//! Only embedded frame assets, never the filesystem or the app's SPA fallback.
use tauri::http::{Method, Request, Response, StatusCode};

pub const CSP: &str = "default-src 'none'; script-src frame://localhost/frames/; style-src frame://localhost/frames/ 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'; frame-src 'none'; worker-src 'none'; object-src 'none'";

/// Do not decode: no shipped filename needs escapes. Reject ambiguous paths
/// before an asset resolver can normalize them or try an index.html fallback.
fn asset_path(uri: &tauri::http::Uri) -> Option<&str> {
    if uri.scheme_str() != Some("frame") || uri.authority()?.as_str() != "localhost" || uri.query().is_some() {
        return None;
    }
    let path = uri.path().strip_prefix("/frames/")?;
    if path.is_empty() || path.split('/').any(|part| {
        part.is_empty() || part == "." || part == ".." || !part.bytes().all(|b| b.is_ascii_alphanumeric() || b"-_.".contains(&b))
    }) {
        return None;
    }
    Some(uri.path())
}

pub fn respond(request: Request<Vec<u8>>, asset: impl FnOnce(&str) -> Option<Vec<u8>>) -> Response<Vec<u8>> {
    let found = (request.method() == Method::GET)
        .then(|| asset_path(request.uri()))
        .flatten()
        .and_then(|path| asset(path).map(|bytes| (path, bytes)));
    let (status, mime, body) = match found {
        Some((path, bytes)) => {
            let mime = if path.ends_with(".html") { "text/html; charset=utf-8" }
                else if path.ends_with(".js") { "text/javascript; charset=utf-8" }
                else if path.ends_with(".css") { "text/css; charset=utf-8" }
                else { "application/octet-stream" };
            (StatusCode::OK, mime, bytes)
        }
        None => (StatusCode::NOT_FOUND, "text/plain; charset=utf-8", b"Frame file not found.".to_vec()),
    };
    Response::builder().status(status)
        .header("Content-Type", mime)
        .header("Content-Security-Policy", CSP)
        // Module scripts are fetched from an opaque sandbox origin. This only
        // exposes public, embedded frame files, never app data or credentials.
        .header("Access-Control-Allow-Origin", "null")
        .header("X-Content-Type-Options", "nosniff")
        .header("Referrer-Policy", "no-referrer")
        .body(body).expect("fixed frame response headers are valid")
}

/// A development build has no embedded files, so its frame files are read
/// from the one directory `pnpm dev` builds them into. The path has already
/// been checked to be plain names under `/frames/`; once links are followed,
/// the file must still be inside that directory.
#[cfg(debug_assertions)]
pub fn from_disk(path: &str) -> Option<Vec<u8>> {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../dist/frames").canonicalize().ok()?;
    let file = root.join(path.strip_prefix("/frames/")?).canonicalize().ok()?;
    if !file.starts_with(&root) || !file.is_file() {
        return None;
    }
    std::fs::read(file).ok()
}

/// CSP does not stop a document navigating itself. WebKit calls this for
/// subframes too. The main app can reload; frames can only load shipped URLs.
pub fn navigation(url: &tauri::Url, app_url: &tauri::Url) -> bool {
    if url.scheme() == app_url.scheme()
        && url.host_str() == app_url.host_str()
        && url.port() == app_url.port()
        && url.username().is_empty()
        && url.password().is_none()
        && url.path().trim_end_matches('/') == app_url.path().trim_end_matches('/')
        && url.query().is_none()
    {
        return true;
    }
    url.as_str().parse().ok().and_then(|uri| asset_path(&uri).map(|p| p.ends_with(".html"))).unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(path: &str) -> Request<Vec<u8>> { Request::builder().uri(path).body(vec![]).unwrap() }

    #[test]
    fn rejects_traversal_absolute_paths_and_unknown_files() {
        for path in [
            "frame://localhost/frames/../index.html", "frame://localhost/frames/%2e%2e/index.html",
            "frame://localhost/frames/%252e%252e/index.html", "frame://localhost/frames/a%2fb.js",
            "frame://localhost/frames/a%5cb.js", "frame://localhost/frames//a.js",
            "frame://localhost/frames/./a.js", "frame://localhost/etc/passwd", "file://localhost/etc/passwd",
            "frame://other/frames/a.js", "frame://localhost:80/frames/a.js", "frame://localhost/frames/a.js?q=1",
            "frame://localhost/frames/", "/frames/a.js", "frame://localhost/frames/unknown.html",
        ] {
            let response = respond(request(path), |_| None);
            assert_eq!(response.status(), StatusCode::NOT_FOUND, "{path}");
            assert_eq!(response.headers()["Content-Security-Policy"], CSP);
        }
    }

    #[test]
    fn invalid_paths_never_reach_the_resolver() {
        for path in ["frame://localhost/frames/../index.html", "frame://localhost/frames/%2e%2e/index.html", "frame://localhost/index.html"] {
            respond(request(path), |_| panic!("invalid path reached resolver"));
        }
    }

    #[test]
    fn exact_embedded_file_and_every_response_have_policy() {
        let response = respond(request("frame://localhost/frames/assets/entry-123.js"), |key| {
            assert_eq!(key, "/frames/assets/entry-123.js");
            Some(b"embedded".to_vec())
        });
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(response.body(), b"embedded");
        assert_eq!(response.headers()["Content-Security-Policy"], CSP);
        let mut post = request("frame://localhost/frames/diagram.html");
        *post.method_mut() = Method::POST;
        assert_eq!(respond(post, |_| panic!("POST must not resolve")).headers()["Content-Security-Policy"], CSP);
        // There is no runtime filesystem resolver, so a symlink cannot be
        // followed. Even a syntactically valid path needs an embedded entry.
        assert_eq!(respond(request("frame://localhost/frames/symlink.html"), |_| None).status(), StatusCode::NOT_FOUND);
    }

    #[test]
    fn a_development_build_reads_only_inside_its_frame_directory() {
        let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../dist/frames");
        let Ok(root) = root.canonicalize() else { return };
        let outside = root.parent().unwrap().join("snowpaw-frame-test-outside.txt");
        std::fs::write(&outside, b"outside").unwrap();
        let link = root.join("snowpaw-frame-test-link.txt");
        let _ = std::fs::remove_file(&link);
        std::os::unix::fs::symlink(&outside, &link).unwrap();
        let read = from_disk("/frames/snowpaw-frame-test-link.txt");
        std::fs::remove_file(&link).unwrap();
        std::fs::remove_file(&outside).unwrap();
        assert_eq!(read, None, "a link out of the frame directory was followed");
        assert_eq!(from_disk("/frames/no-such-file.html"), None);
        assert_eq!(from_disk("/elsewhere/diagram.html"), None);
    }

    #[test]
    fn navigation_denies_network_and_non_frame_assets() {
        let app = tauri::Url::parse("tauri://localhost/").unwrap();
        for url in ["https://example.invalid", "http://ipc.localhost/", "file:///etc/passwd", "frame://localhost/index.html", "frame://localhost/frames/a.js"] {
            assert!(!navigation(&tauri::Url::parse(url).unwrap(), &app), "{url}");
        }
        assert!(navigation(&app, &app));
        assert!(navigation(&tauri::Url::parse("tauri://localhost").unwrap(), &app));
        assert!(navigation(&tauri::Url::parse("frame://localhost/frames/diagram.html").unwrap(), &app));
    }
}
