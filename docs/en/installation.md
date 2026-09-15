# Installation

Dinotty ships pre-built binaries for macOS, Linux, and Windows desktops, a Linux server `.deb` package, and a mobile PWA. All artifacts are published on [GitHub Releases](https://github.com/xichan96/dinotty/releases).

::: tip Two roles
- **Desktop client**: Tauri native app, works out of the box for local or LAN use
- **Server**: Long-running `dinotty-server` process for remote deployment, accessed by multiple devices
:::

## Desktop

### macOS

Download the `.dmg` installer, mount it, and drag Dinotty into Applications.

```bash
# Command-line install example
curl -LO https://github.com/xichan96/dinotty/releases/latest/download/Dinotty_<version>_aarch64.dmg
hdiutil attach Dinotty_<version>_aarch64.dmg
cp -R "/Volumes/Dinotty/Dinotty.app" /Applications/
hdiutil detach "/Volumes/Dinotty"
```

::: tip Signed & notarized
The macOS build is signed with an Apple Developer ID and notarized, so the first launch does not require `xattr -cr`.
:::

### Linux

The desktop ships in two formats:

| Format | Distro | Install |
|--------|--------|---------|
| `.deb` | Ubuntu 22.04+ / Debian 12+ / Linux Mint 21+ | `sudo dpkg -i dinotty_<version>_amd64.deb` |
| `.AppImage` | Most distros | `chmod +x Dinotty_*.AppImage && ./Dinotty_*.AppImage` |

`.AppImage` is a single executable, no install needed. If your file manager prompts for trust, enable "Allow executing" in the file properties.

::: warning Desktop `.deb` requires glibc ≥ 2.34
The desktop `.deb` is built on an Ubuntu 22.04 runner (the GNOME/WebKit runtime libraries only exist from 22.04 onward), so the binary requires `libc6 (>= 2.34)` and installs only on Ubuntu 22.04+ / Debian 12+ / Mint 21+.

On older systems such as Ubuntu 20.04 / Debian 11, `dpkg -i` reports dependency errors that `apt-get -f install` cannot fix — the glibc symbol versions simply do not match, and no package can supply them. Use the server `.deb` described below, the AppImage, or the Docker image instead.
:::

### Windows

Download the NSIS installer (`Dinotty_<version>_x64-setup.exe`) and run it, or use the portable build (`Dinotty_<version>_x64-portable.exe`) with no installation.

```powershell
# Portable launch example
.\Dinotty_<version>_x64-portable.exe
```

## Server deb (Linux)

`dinotty-server` is a standalone Rust binary with no desktop dependency, suitable for VPS or home servers.

The server `.deb` is built separately in an Ubuntu 20.04 container and requires `libc6 (>= 2.31)`, so it installs on **Ubuntu 20.04+ / Debian 11+ / Linux Mint 20+** — a wider range than the desktop `.deb`.

```bash
# Download and install the latest version in one go
VERSION=$(curl -s https://api.github.com/repos/xichan96/dinotty/releases/latest \
  | sed -n 's/.*"tag_name": *"\([^"]*\)".*/\1/p' | sed 's/^v//') \
  && curl -LO "https://github.com/xichan96/dinotty/releases/download/v${VERSION}/dinotty-server_${VERSION}-1_amd64.deb" \
  && sudo dpkg -i "dinotty-server_${VERSION}-1_amd64.deb"

# Start / enable on boot
sudo systemctl enable --now dinotty

# Check status
systemctl status dinotty
journalctl -u dinotty -f
```

For full deployment (systemd config, Docker, reverse proxy, Windows service), see [Deployment Guide](getting-started/deployment).

## Mobile PWA

There is no native mobile app; mobile uses a PWA:

1. Open the server URL in the mobile browser (e.g., `http://192.168.1.10:8999`)
2. Browser menu -> "Add to Home Screen" / "Install App"
3. Tap the home-screen icon for full-screen launch

iOS Safari, Android Chrome, and HarmonyOS Browser all support this.

## First Run

### Desktop

The first launch prompts you to connect to a server:

- **Connect to an existing server**: enter server URL and access token (if the server has token auth enabled)
- **Start a local server**: the desktop client spins up a local `dinotty-server` process for single-machine use

### Server

The server listens on `0.0.0.0:8999` by default. Open `http://<server-ip>:8999` after launch.

```bash
# Custom port
dinotty-server -p 3000

# Custom default shell
DINOTTY_SHELL=/bin/zsh dinotty-server
```

::: warning Token auth
Publicly exposed servers **must** configure token auth. See [Token Permission System](/en/internals/token-system) and the [Auth Security Design](https://github.com/xichan96/dinotty/blob/dev/.claude/doc/auth-security-design.md).
:::

## Upgrade

Download the new version and install over the old one. Config and workspace data persist at:

| Platform | Config directory |
|----------|------------------|
| macOS / Linux | `~/.config/dinotty/` |
| Windows | `%APPDATA%\dinotty\` |
| Linux server (deb) | `/var/lib/dinotty/` |

Dinotty checks the official GitHub Release once by default after login on each desktop launch or browser/PWA page reload. It does not poll while the app remains open. You can disable **Automatically check for updates** at the bottom of **Settings > About**; enabling it again runs one check immediately. You can also run a check at any time with **Check for updates**. The update card appears as soon as a newer stable version exists. Dinotty also shows one startup toast while the window is visible and in the foreground, or when the window next returns to the foreground if the result arrived in the background. Clicking the toast opens **Settings > About**.

On the desktop app, **Download update** fetches the installer built for your platform and architecture, asks where to save it, and shows the transfer progress. When it finishes, use **Show in folder** or **Open installer** to install it. Linux users can additionally download the `.deb` package. On the web/PWA there is nothing to install locally, so the card offers **Go to Downloads** instead, which opens the release page in a new browser tab. **Dinotty never installs an update or launches an installer on its own** — starting the installer is always an explicit action. Offline starts, GitHub rate limits, and check failures remain silent and do not block startup.

Server deb upgrade:

```bash
sudo dpkg -i dinotty-server_<new-version>-1_amd64.deb
sudo systemctl restart dinotty
```

## Build from Source

If you prefer not to use pre-built binaries, build from source:

```bash
git clone --depth 1 --single-branch -b dev git@github.com:xichan96/dinotty.git
cd dinotty

# Build frontend
cd frontend && pnpm install && pnpm run build && cd ..

# Run server
cargo run

# Or build desktop
pnpm dlx @tauri-apps/cli build
```

Full build steps are in [Deployment Guide](getting-started/deployment).

## Next Steps

- [Deployment Guide](getting-started/deployment) - systemd / Docker / reverse proxy / Windows service
- [Introduction](introduction) - Project positioning and core features
- [Multi-device Sync & Mission Control](guide/multi-device-sync) - Connect from desktop, mobile, web
