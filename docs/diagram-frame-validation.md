# Diagram frame validation — 2026-11-14

Implementation checkout: `feat/diagram-frame`, based on `b4a0b24`.
Independent code review and the lead's own real-window check are still pending.

## Engine and build

Tested the actual debug application produced by:

```sh
NODE_ENV=development CARGO_BUILD_JOBS=1 pnpm tauri build --debug --no-bundle
```

WebKitWebDriver ran with `TAURI_WEBVIEW_AUTOMATION=true`, port 9876, and fresh
`XDG_DATA_HOME`, `XDG_CONFIG_HOME`, and `XDG_CACHE_HOME` under
`~/.cache/snowpaw-research/diagram-frame/xdg.kwcBt7/`. No owner app data or
ports 1420–1422 were used. No dev server was started.

Installed engine: `webkit2gtk4.1-2.54.2-1.fc45.x86_64`; the app links
`libwebkit2gtk-4.1.so.0` and `libjavascriptcoregtk-4.1.so.0` from `/lib64`.
The system RPM's libraries were used, but a packaged Snowpaw RPM and an
AppImage were **not tested**. This does not certify another WebKit build.

The Finance sample rendered in light and dark, including a live theme change.
Settings → Plugins → Diagrams removed the iframe and showed source; switching
it back on rendered a new diagram. A second input to a frame was ignored.
Invalid syntax and 101 edges both returned the fixed failure sentence.
A directive requesting loose security, HTML labels and injected theme CSS
produced an SVG with no HTML labels, images or links, using the app background.
Injecting the documented failure response into the real host exercised the
Markdown error boundary: source and sentence appeared and the iframe vanished.

## URL, origin and policy

The actual frame URL was `frame://localhost/frames/diagram.html`.
`location.origin` reported `frame://localhost`; the sandbox security origin
(`window.origin` and messages received by the parent) was `null`.
The app URL was `tauri://localhost` (no trailing slash).

The following policy was read **inside the frame** from
`SecurityPolicyViolationEvent.originalPolicy`, triggered by blocked requests:

```text
default-src 'none'; script-src frame://localhost/frames/; style-src frame://localhost/frames/ 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'; frame-src 'none'; worker-src 'none'; object-src 'none'
```

There was no inherited app policy in those violations. Tauri/wry pass custom
protocol headers through. The resolver computes an app CSP header but the
handler ignores it and supplies the frame CSP. The host config changes only
`frame-src`; Tauri still automatically adds its usual script hashes at runtime.
The app gains no inline-style or external-network allowance.

Source checked locally: Tauri 2.12.5 `app.rs` (resolver and scheme URL docs),
`manager/mod.rs` (SPA fallbacks/CSP), `manager/webview.rs` (custom handler
forwarding and app URL); wry 0.57.2 `webkitgtk/web_context.rs` (literal scheme
registration and response-header copying), `webkitgtk/mod.rs` (navigation
callback also sees subframes); tauri-utils 2.10.2 `assets.rs` (iterator contains
compressed bytes, `get` decompresses). Two real-window findings corrected the
implementation: the app URL's empty path and the compressed iterator bytes.

## A.5 acceptance results

These probes executed inside the real Mermaid iframe through WebKitWebDriver.
Temporary negative-control frames were created by automation and removed;
no probe frame or test command ships in the app.

| Test | Result | Observation |
| --- | --- | --- |
| 1 Origin | Pass | `origin === "null"`; parent DOM throws `SecurityError`; `frameElement` and parent's `contentDocument` are null. |
| 2 Storage | Pass | local/session storage, IndexedDB and Cache Storage throw `SecurityError`; cookie assignment leaves an empty cookie string. Parent sentinel remains private; a replacement frame still cannot access storage. |
| 3 IPC scripts | Pass | `__TAURI_INTERNALS__` and `ipc` are undefined in the frame; parent's internals object is unchanged. |
| 4 Raw handler | Pass with exposed surface | `webkit.messageHandlers.ipc` exists. Missing and guessed keys were sent with `vm_status` and live callback IDs; no callback fired. Legitimate parent `vm_status` returned `off` before and afterward. This is key-gated, not an absent bridge. |
| 5 Protocol invoke | Pass; unsafe control confirmed | IPC fetches with omitted and `null` Origin rejected with `TypeError` under the frame CSP. A deliberately wrong `srcdoc` frame with `allow-same-origin` read the parent and invoked its bridge: `vm_status` returned `off`. The test demonstrates parent authority; it does not independently instrument Rust's raw-handler attribution. |
| 6 Spoofed bridge | Pass | Tauri-like event/command messages had no effect. Invalid or extra-field height messages were ignored. A parent-window spoof did not change height. A valid height from the actual frame is intentionally accepted; setting targetOrigin to the parent never changes sender origin from `null`. |
| 7 Network | Pass; unsafe control confirmed | HTTPS fetch, remote image, WebSocket and HTTP IPC fetch blocked, with frame CSP violations. Without the frame policy, a `srcdoc` control inherited the parent's IPC allowance: IPC fetch still failed, but produced no CSP violation; remote HTTPS did produce one. Do not claim the IPC connection itself succeeded. |
| 8 Navigation/popups | Pass | location assignment, clicked external link, popup, top navigation, `_top` link, form and data download attempts left both URLs unchanged; one window remained. Popup returned null, direct top navigation threw `SecurityError`. |
| 9 Permissions | Pass on this debug build | Clipboard and media rejected `NotAllowedError`; geolocation returned permission-denied code 1; notification permission was `denied`. No prompt observed. Packaged-build check remains pending. |
| 11 Teardown | Pass | Plugin off removes iframe and its message listener (instrumented count 1 → 0). Theme change creates a different contentWindow; parent DOM, internals and sentinel persist; fresh frame storage is denied. |
| 12 Exhaustion | **Fail, bounded probe** | A 1,000 ms loop retaining at most 16 MiB stalled the parent's 20 ms timer for 1,002 ms; frame remained mounted. No independent watchdog exists. Unbounded allocation and a spinning GPU shader were deliberately not run, to honor the desktop memory/OOM constraint. |
| 13 Reduced motion | Pass for confinement | Parent style access throws; a full-viewport style in the frame cannot change parent handling. Parent preference was unchanged (`false` on this desktop). Renderer CSS disables ordinary diagram animation. A desktop configured to request reduced motion was not separately exercised. |

Test 10 is inapplicable: no second webview or `unstable` feature was added.
These results support the bundled renderer experiment, not arbitrary code
plugins or a guarantee against engine exploits or resource exhaustion.

## Dependencies, size and checks

`mermaid` is pinned to **12.3.0**. The registry reported it as current on
2026-11-14; a fresh OSV version query returned `{}`. Grok pass 13's advisory
ranges were reviewed; its listed fixes precede 12.3.0, and its unresolved
range details are covered only by the current version query, not an independent
exhaustive advisory census. `pnpm audit` reported no Mermaid-chain finding.
It did report an existing low-severity KaTeX 0.16.47 issue through
`remark-math > micromark-extension-math` (GHSA-238p-pmpm-9mq7); unchanged here.

The isolated renderer graph adds **5,176,655 bytes** across 89 built files,
**1,490,640 bytes** when each file is gzip-compressed (level 9). That includes
the frame entry, CSS, Mermaid and its lazy diagram dependencies. The app-side
lazy host chunk adds 3.22 kB JS and 0.14 kB CSS (Vite's rounded figures).
The complete production `dist` contains 5,936,465 file-content bytes.
Nothing from the frame graph is imported by the app graph. These are shipped
asset sizes, not a measured executable-size delta or peak memory cost.

Checks completed:

- `pnpm build` (production) and the development-sample Tauri debug build.
- `pnpm test`: **121 passed** (including four channel tests).
- Four Rust path/response/navigation tests passed with one build job.
- `git diff --check` and staged whitespace checks.

`cargo fmt` is unavailable. Full QEMU/runtime tests were not rerun for this
renderer change. Build warnings: existing PostCSS `from` warning and Vite's
large Mermaid chunks warning. No OOM or memory-limit test was run.

Local evidence and automation scripts are retained under
`~/.cache/snowpaw-research/diagram-frame/`: `acceptance.json`, `controls.json`,
`lifecycle.json`, `audit.json`, light/dark PNGs, and `drive.mjs`,
`acceptance.mjs`, `controls.mjs`, `lifecycle.mjs`. These are test artifacts,
not shipped assets. The real-window driver and its app session were closed.

## Intentional design adjustments

- A navigation guard supplements CSP, since self-navigation is not blocked by CSP.
- Two Vite builds enforce separate app/frame module graphs and keep all renderer
  assets under `dist/frames/`; `pnpm build` performs both.
- Exact embedded membership is checked before resolver decompression; dev-mode
  filesystem fallback is refused. Diagrams need a built app, including debug.
- A new frame on theme change preserves the one-input rule. Failed loads use a
  15-second fallback, which cannot interrupt synchronous CPU work.
- Literal Linux scheme URLs are used. Other platform scheme spellings and
  packaged WebKit variants remain unimplemented/unverified.
