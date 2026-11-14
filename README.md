# Snowpaw
Tauri harness for your agents to thrive in, not to limit.

## Run it

Needs Node with pnpm, Rust, and the Tauri system packages. On Fedora:

```sh
sudo dnf install rust cargo gcc webkit2gtk4.1-devel openssl-devel librsvg2-devel libappindicator-gtk3-devel libxdo-devel
```

Then:

```sh
pnpm install
pnpm tauri dev
```

In a development build, Settings has a Developer category that loads sample
agents, so every part of the app can be seen with something in it. Open
Settings by clicking your name at the bottom of the sidebar.

## Check it

```sh
pnpm typecheck
pnpm test
(cd src-tauri && cargo test)
```
