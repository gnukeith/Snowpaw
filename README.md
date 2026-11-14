# Snowpaw

A harness for your agents to thrive in, not to limit.

Snowpaw is a desktop app for AI agents that work for you around the clock.
That is what it is being built to be; [What works today](#what-works-today)
says how far it has got.

The agents are meant to work not on your system but in a virtual machine of
their own, which Snowpaw runs on your computer inside a sandbox, where they can
install, build and break things without asking. You watch and steer from an app
that feels like a group chat, and you check what an agent did after the fact:
its reasoning, the output of what it ran, the files it changed and its screen.

It is for everyone, and it is shaped by what it will mostly be used for: coding,
research, mathematics and automation.

## The ideas behind it

- **Security and privacy first.** The agents get freedom because their computer
  is cut off from yours, not because you click "allow" all day.
- **Everything is a plugin.** Themes, skills, tools and the views agents build
  are meant to be plugins, including the ones Snowpaw ships with, and an agent
  should be able to write a new one when you ask.
- **Lean.** Tauri, React and a small Rust core. No dependency that a few lines
  would replace.
- **One look.** Every size, radius and colour comes from design tokens, so the
  whole app can be restyled at once.
- **Familiar.** A sidebar, settings in categories, and the things you already
  know from the tools you use.

## What works today

Snowpaw is early. This is what you can see and use now:

- The app shell: agents with names and pictures in a sidebar, a conversation
  with each, and settings for your name, picture, theme and accent colour.
- A panel beside each conversation for checking an agent's work: its activity
  (reasoning and outputs), its file changes as a diff, and its scheduled tasks.
  Nothing produces that work yet, so a development build fills these views
  with sample data.
- The agents' computer: a QEMU virtual machine inside a bubblewrap sandbox,
  with no network, no shared folder and no clipboard, which boots Fedora
  Workstation and shows its screen in the panel.

What is not built yet: nothing answers when you write to an agent. Connecting a
model, running agents on the computer, plugins, skills and deep research are
the work in progress.

## Thanks

Snowpaw stands on other people's work, and a few projects shaped it directly.

- [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) is where
  the plugin idea comes from. It showed that a harness can be made of plugins
  all the way down, themes and backgrounds included, and that an agent can
  write a new one when you ask. It is open source and generous with its
  documentation, and Snowpaw's plugin system, still being built, takes it as
  its model. Thank you.
- [T3 Code](https://github.com/pingdotgg/t3code) and
  [tstack](https://github.com/t3dotgg/tstack) for showing how several models
  can review each other's work, which is also how Snowpaw itself is built.
- [Superpowers](https://github.com/obra/superpowers) and the
  [Agent Skills](https://agentskills.io) format for the idea that a short,
  well-written procedure can make a model more careful.
- [Tauri](https://tauri.app), [QEMU](https://www.qemu.org),
  [bubblewrap](https://github.com/containers/bubblewrap), WebKitGTK, React and
  [Fedora](https://fedoraproject.org), which Snowpaw runs on.

## Run it

Needs Node with pnpm, Rust, and the Tauri system packages. On Fedora:

```sh
sudo dnf install rust cargo gcc webkit2gtk4.1-devel openssl-devel librsvg2-devel libappindicator-gtk3-devel libxdo-devel qemu-system-x86-core bubblewrap
```

Then:

```sh
pnpm install
pnpm tauri dev
```

In a development build, Settings has a Developer category that loads sample
agents, so every part of the app can be seen with something in it. Open
Settings by clicking your name at the bottom of the sidebar.

## The computer's operating system

The Computer view boots Fedora Workstation 45 from a live image that the app
does not download itself yet. Fetch it once, check it against Fedora's signed
checksum, and put it in the app's data directory:

```sh
mkdir -p ~/.local/share/dev.snowpaw.app/images
cd ~/.local/share/dev.snowpaw.app/images
url=https://dl.fedoraproject.org/pub/fedora/linux/releases/45/Workstation/x86_64/iso
curl -fLO $url/Fedora-Workstation-45-1.4-x86_64-CHECKSUM
curl -fLO $url/Fedora-Workstation-Live-45-1.4.x86_64.iso

# The key ships with Fedora (package fedora-gpg-keys).
gpg --dearmor < /usr/share/pki/rpm-gpg/RPM-GPG-KEY-fedora-45-primary > fedora-45.gpg
# Keep only the text Fedora signed, then check the image against that text.
gpgv --keyring ./fedora-45.gpg --output signed.txt Fedora-Workstation-45-1.4-x86_64-CHECKSUM &&
  grep -F '(Fedora-Workstation-Live-45-1.4.x86_64.iso)' signed.txt | sha256sum --check
rm fedora-45.gpg signed.txt
```

The last check has to print `Fedora-Workstation-Live-45-1.4.x86_64.iso: OK`. If
it prints anything else, delete the image.

The image is attached read-only and the machine has no disk of its own, so
nothing the guest does survives a stop.

## Check it

```sh
pnpm typecheck
pnpm test
(cd src-tauri && cargo test)
```

## Diagrams

Mermaid fences render by default; Settings → Plugins → Diagrams switches them
back to source text. Diagrams run in a sandboxed document with a separate
network-denying policy, described in [the frame boundary](docs/diagram-frame.md).
`pnpm tauri dev` builds the frames once when it starts, so restart it after
changing anything under `src/frames`.
