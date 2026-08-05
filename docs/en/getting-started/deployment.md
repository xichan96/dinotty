# Deployment Guide

This guide explains how to install and deploy build artifacts. Repository maintainers preparing a version, creating a tag, or monitoring an official release should see the [Release Guide](releasing.md).

## Recommended Release Flow (CI/CD)

Use the repository `Package` workflow (`.github/workflows/package.yml`) for release and deployment artifacts. Do not treat local script output as the official release source.

- Manual package: open GitHub Actions → `Package` → `Run workflow`, then choose `dev` or `main`; manual runs upload Actions artifacts only.
- Official release: push a `v*` tag on `main`; CI builds packages and publishes GitHub Release assets.
- CI artifacts: `dinotty-macos` contains `.dmg`, `dinotty-linux` contains desktop `.deb` / `.AppImage` and the server `dinotty-server_*.deb`, and `dinotty-windows` contains the NSIS installer and portable `.exe`.
- Artifact staging: CI copies packages to `dist/package-artifacts/` before upload. Manual-run artifacts are retained for 14 days by default.

## Local Script Scope

`./scripts/build.sh` and `./scripts/build-linux-deb.sh` are only for temporary local builds, verification, or troubleshooting after changing code. Use the CI/CD flow above for deployment and releases.

```bash
# macOS, run from the repository root; only for temporary local builds after code changes
./scripts/build.sh native
./scripts/build.sh list

# Remote Linux deb build; only for local troubleshooting after code changes
./scripts/build-linux-deb.sh
```

## Linux systemd Deploy (Use CI deb)

Download the server deb from the `Package` workflow `dinotty-linux` artifact or from GitHub Releases, then install it:

```bash
sudo apt install ./dinotty-server_*.deb

# Management commands
systemctl status dinotty       # Check status
systemctl restart dinotty      # Restart
systemctl stop dinotty         # Stop
journalctl -u dinotty -f       # View live logs

# Update config and restart
sudo vim /etc/dinotty/env      # Edit port, token, log level
sudo systemctl restart dinotty
```

Installing the deb deploys `dinotty-server`, the systemd unit, and `/etc/dinotty/env.example`, then enables and starts `dinotty.service`.

For temporary local binary validation after changing code, pass the local build output explicitly:

```bash
sudo bash deploy/systemd/install.sh --bin target/release/dinotty-server --token your-secret-token
sudo bash deploy/systemd/uninstall.sh
```

## Linux Desktop Package

Download desktop packages from the CI `dinotty-linux` artifact or from GitHub Releases:

```bash
# deb installer
sudo apt install ./Dinotty*.deb

# Or run the AppImage directly
chmod +x ./Dinotty*.AppImage
./Dinotty*.AppImage
```

The Linux system tray integration is experimental and requires an AppIndicator host and compatible runtime libraries. GNOME commonly also needs an AppIndicator extension, while KDE Plasma usually provides a system tray host. If the host or libraries are missing, Dinotty records diagnostics and continues running normally without hiding its main window. It does not install runtime libraries or desktop extensions.

Desktop `.deb` and AppImage builds can enable per-user login autostart under Settings → General → Startup. At login, Dinotty starts only the background desktop process and system tray; it does not pre-create the main window, WebView, or a PTY. The tray, global shortcut, or another interactive Dinotty launch creates the window on demand. Linux writes `${XDG_CONFIG_HOME:-$HOME/.config}/autostart/dinotty.desktop` on a best-effort basis: Dinotty guarantees a valid XDG Desktop Entry, but whether it runs still depends on the desktop environment's autostart and AppIndicator support. Autostart cannot be enabled without a tray, and an autostart launch exits quietly if tray installation fails.

AppImage autostart is bound to the original image path used when it was enabled. Moving, renaming, or replacing that file does not trigger a scan or silent repair; launch Dinotty from the new location to choose Use current file, or disable the old entry. A stable symlink can be used as a fixed entry point. Uninstalling the `.deb` does not scan user homes as root. Disable autostart before removing the app, or, after confirming the file belongs to Dinotty, manually remove `~/.config/autostart/dinotty.desktop` (or the equivalent file under a custom `XDG_CONFIG_HOME`).

## macOS Desktop Package

Download the `.dmg` from the CI `dinotty-macos` artifact or from GitHub Releases, then open it and follow the system installer prompts.

After placing the `.app` in `/Applications` or `~/Applications`, enable per-user login autostart under Settings → General → Startup. It cannot be enabled from a DMG, App Translocation, a read-only volume, or another location. The record is stored at `~/Library/LaunchAgents/com.dinotty.terminal.autostart.plist`; login keeps only the tray and background capabilities alive, and the main window is created on the first explicit open request.

Deleting an `.app` directly does not run an uninstall hook. Disable autostart in Settings first. If the app has already been removed, manually delete the plist above only after confirming that it belongs to Dinotty.

## Windows Desktop Package

Download packages from the CI `dinotty-windows` artifact or from GitHub Releases:

- NSIS installer: suitable for normal install and uninstall flows.
- Portable `.exe`: suitable for install-free testing.

Dinotty registers one system tray icon for the lifetime of the process. Windows decides whether it appears next to the clock or in the `^` overflow area; Dinotty does not modify this preference:

- Windows 11: open Settings → Personalization → Taskbar → Other system tray icons, then enable Dinotty.
- Windows 10: open Taskbar settings → Select which icons appear on the taskbar, then enable Dinotty.
- The NSIS installer and portable executable use different paths, so Windows may treat them as separate entries that must be enabled independently.

Enable per-user login autostart under Settings → General → Startup. Dinotty writes the exact current exe path plus the single `--background` argument to the `Dinotty` value under `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`; login does not automatically open the main window. Fixed and removable local drives are supported, while mapped network drives, UNC paths, optical media, RAM disks, and unknown volume types are rejected. Portable builds can still enable autostart after acknowledging the path-binding warning. Moving or renaming the file, or changing a removable drive letter, does not make Dinotty search for it; explicitly adopt the new file or disable the old entry.

NSIS in-place updates preserve autostart. A normal uninstall removes the Run value only when it is a `REG_SZ` that still points exactly to the executable in that installation directory. Values pointing to another Dinotty copy, containing extra arguments, using another registry type, or having malformed content are left untouched. Windows may also suppress a configured startup item in system settings; Dinotty does not modify the undocumented `StartupApproved` state.

Closing the main window offers hide to tray, quit, or cancel when tray hiding is available. Hiding keeps PTYs, terminal sessions, and the embedded service running. Quitting makes a best-effort frontend save before cleaning up sessions; forced termination, power loss, and crashes cannot guarantee that save completes.

This feature covers desktop startup after the current user signs in. It does not install a Windows Service or run before login.

## Docker Deploy

Docker images are still built through the local Compose flow:

```bash
cd deploy/docker

# Configure environment variables
cp .env.example .env
# Edit .env to set DINOTTY_TOKEN, WORKSPACE_DIR, etc.

# Build and start (supports amd64 and arm64)
docker compose up -d --build

# Management commands
docker compose logs -f         # View logs
docker compose restart         # Restart
docker compose down            # Stop and remove

# Multi-arch build and push
docker buildx build --platform linux/amd64,linux/arm64 \
  -t your-registry/dinotty:latest --push \
  -f deploy/docker/Dockerfile .
```

On Windows, use Docker Desktop with Linux containers. Set workspace paths in `.env` using paths visible inside Docker Desktop mounts.

## Cross-Platform Packages

Cross-platform desktop packages are generated by the `Package` workflow matrix:

| Platform | CI runner | Artifacts |
|----------|-----------|-----------|
| macOS | `macos-latest` | `.dmg` |
| Linux | `ubuntu-22.04` | desktop `.deb` / `.AppImage`, server `dinotty-server_*.deb` |
| Windows | `windows-latest` | NSIS `.exe`, portable `.exe` |

## Configuration

| Parameter | Method | Default | Description |
|-----------|--------|---------|-------------|
| Port | `--port` / `-p` | 8999 | Server listen port |
| Token | `DINOTTY_TOKEN` env var or config file | Unconfigured / first-time setup | Access auth token; when empty, Dinotty starts the first-time setup flow |
| Log level | `RUST_LOG` env var | info | trace / debug / info / warn / error |
| Shell | Unix: `SHELL`; Windows: `DINOTTY_SHELL` | Auto-detect | Windows tries `DINOTTY_SHELL`, then `pwsh.exe`, `powershell.exe`, `%ComSpec%` / `cmd.exe` |

### Config And Data Directories

| Platform | Config directory | Plugin directory |
|----------|------------------|------------------|
| Linux | `~/.config/dinotty` | `~/.dinotty/plugins` |
| macOS | `~/Library/Application Support/dinotty` | `~/.dinotty/plugins` |
| Windows | `%APPDATA%\dinotty` | `%USERPROFILE%\.dinotty\plugins` |

Tokens, `settings.json`, audit logs, and webhook secrets are stored in the config directory. Plugin persistent data lives under `.dinotty/plugin-data` in the user's home directory.
