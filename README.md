# Snowpaw
Tauri harness for your agents to thrive in, not to limit.

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
