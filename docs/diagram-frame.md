# Diagram frame boundary

Frames use `frame://localhost/frames/<entry>.html` on Linux, loaded with only
`sandbox="allow-scripts"`. The app CSP adds only `frame-src` for that path.
The Rust handler sets its own policy on success and error responses. No
network, IPC connection, worker, form, nested frame, or external image is
allowed. Inline styles are allowed inside the frame for Mermaid's SVG.
Navigation is guarded separately because CSP does not prevent self-navigation.

The handler uses `app.asset_resolver().iter()` to find exact embedded paths.
It never calls `get()`, whose production fallback may return the app index,
and whose dev path reads files and follows symlinks. There are no runtime
filesystem paths or symlinks to resolve here. An unknown file is a 404. Every
percent escape, dot segment, empty segment, foreign authority, query, and
non-GET method is rejected. Browser normalization can erase dot segments
before the handler sees them, but the resulting path still needs to be an
exact embedded file under `/frames/`.

This requires embedded assets: use `pnpm tauri build --debug --no-bundle`.
A `tauri dev` session with no embedded assets fails closed. No filesystem
fallback is provided. The scheme spelling and guard currently target Linux,
which is the platform this app builds for.

The host sends one bounded source string and resolved theme values. The frame
consumes its parent's first valid input. Replies contain only a finite height
between 1 and 4096 or a fixed failure sentence. The host checks window identity,
not the shared `null` origin string. A theme change creates a new frame. A
15-second fallback handles load/render failures; it is not a CPU watchdog.

Source checked: Tauri 2.12.5 `app.rs` (AssetResolver and custom protocol docs),
`manager/mod.rs` (`get_asset` fallbacks and CSP), `manager/webview.rs` (custom
protocol dispatch); wry 0.57.2 `webkitgtk/web_context.rs` (scheme registration,
response headers) and `webkitgtk/mod.rs` (navigation callback for subframes).
Custom protocol responses are passed through without Tauri's app CSP. The
embedded iterator avoids `get_asset`'s generated CSP header and nonce rewrite;
codegen adds nonce placeholders, not an app CSP meta policy.

Unit checks: `node --test tests/plugin-frame.test.js` and
`CARGO_BUILD_JOBS=1 cargo test --manifest-path src-tauri/Cargo.toml plugin_frame::tests`.
