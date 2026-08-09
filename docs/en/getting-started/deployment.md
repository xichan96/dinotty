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

An AppImage is a portable package that is not maintained by the system package manager. Before enabling autostart, Dinotty asks you to keep the image in a trusted, permanent location that is available at login. Moving, renaming, or deleting it, or updating to an AppImage with a different filename, leaves the startup entry pointing to the old copy; Dinotty does not automatically scan, migrate, or remove it. Disable autostart before removing the current copy. After launching Dinotty from a new location, choose Use current file; a stable symlink can also provide a fixed entry point. Uninstalling the `.deb` does not scan user homes as root. Disable autostart before removing the app, or, after confirming the file belongs to Dinotty, manually remove `~/.config/autostart/dinotty.desktop` (or the equivalent file under a custom `XDG_CONFIG_HOME`).

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

Enable per-user login autostart under Settings → General → Startup. Dinotty writes the exact current exe path plus the single `--background` argument to the `Dinotty` value under `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`; login does not automatically open the main window. Fixed and removable local drives are supported, while mapped network drives, UNC paths, optical media, RAM disks, and unknown volume types are rejected. Portable builds are not maintained by an installer. Before enabling autostart, Dinotty asks you to keep the executable in a trusted, permanent location that is available at login. Moving, renaming, or deleting it, or updating to a differently named file, leaves the startup entry pointing to the old copy; Dinotty does not automatically migrate or remove it. Disable autostart before removing the current copy. After switching copies, configure autostart again from the replacement to take over the old entry.

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

## Install dinotty-server Inside an Existing Container

If you don't want to build a dedicated image and prefer to run `dinotty-server` inside an existing Debian/Ubuntu container, supervise it with `supervisor`. The following commands download the v0.20.0 deb inside the container and hand it off to supervisor:

```bash
apt update && apt install -y wget supervisor && \
wget https://github.com/xichan96/dinotty/releases/download/v0.20.0/dinotty-server_0.20.0-1_amd64.deb && \
(dpkg -i dinotty-server_0.20.0-1_amd64.deb || apt -f install -y) && \
rm -f dinotty-server_0.20.0-1_amd64.deb && \
echo -e "[program:dinotty-server]\ncommand=dinotty-server\nautostart=true\nautorestart=true\nstdout_logfile=/var/log/dinotty.log\nstderr_logfile=/var/log/dinotty.err.log" \
  > /etc/supervisor/conf.d/dinotty.conf && \
supervisord -c /etc/supervisor/supervisord.conf && \
supervisorctl update
```

Notes:

- `dpkg -i ... || apt -f install -y` auto-resolves missing dependencies.
- `supervisord` must run as the container's main process (PID 1); otherwise the container exits immediately.
- The server listens on `8999` by default. To change the port, set supervisor's `command=dinotty-server -p <port>` and mirror it in `docker run -p`.
- To pin a version, replace `v0.20.0` in the URL and `0.20.0` in the filename. For the latest release, use the `VERSION=...` snippet on the [Installation](../installation#server-deb-linux) page.

Minimal Dockerfile example:

```dockerfile
FROM ubuntu:22.04

RUN apt update && apt install -y wget supervisor && \
    wget https://github.com/xichan96/dinotty/releases/download/v0.20.0/dinotty-server_0.20.0-1_amd64.deb && \
    (dpkg -i dinotty-server_0.20.0-1_amd64.deb || apt -f install -y) && \
    rm -f dinotty-server_0.20.0-1_amd64.deb

COPY <<'EOF' /etc/supervisor/conf.d/dinotty.conf
[program:dinotty-server]
command=dinotty-server
autostart=true
autorestart=true
stdout_logfile=/var/log/dinotty.log
stderr_logfile=/var/log/dinotty.err.log
EOF

EXPOSE 8999
CMD ["supervisord", "-c", "/etc/supervisor/supervisord.conf"]
```

::: warning Token auth
Publicly exposed containers must configure a token. Either append `-t <token>` to the supervisor command, or write `/etc/dinotty/env` and run `supervisorctl restart dinotty-server`. See [Token Permission System](/zh/internals/token-system).
:::

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

### Shell Detection And WSL

The list under Settings → General → Shell is detected in real time on the Dinotty backend host, not on the device running the browser. Opening the picker starts a fresh probe. “Detected” only means that an executable or registered WSL distribution was found; it does not guarantee that user startup scripts will run successfully. Changes apply to new local terminals and splits only. Existing terminals do not switch shells.

On a Windows host with at least one registered distribution and a WSL version that supports `--distribution` and `--cd`, you can select either the default distribution or a specific one. Dinotty launches the system `wsl.exe` and passes the distribution name and working directory as separate arguments. With no explicit working directory, WSL starts in the Linux user's `~`; with a Windows workspace directory, WSL interprets that Windows path itself.

The initial implementation does not map Linux paths in WSL back into the Windows file workspace and does not assume an automount root such as `/mnt/<drive>`. Input, resize, close, reconnect, and split operations work for WSL terminals, but Run Code from the file workspace is disabled with an explanatory message.

### Config And Data Directories

| Platform | Config directory | Plugin directory |
|----------|------------------|------------------|
| Linux | `~/.config/dinotty` | `~/.dinotty/plugins` |
| macOS | `~/Library/Application Support/dinotty` | `~/.dinotty/plugins` |
| Windows | `%APPDATA%\dinotty` | `%USERPROFILE%\.dinotty\plugins` |

Tokens, `settings.json`, audit logs, and webhook secrets are stored in the config directory. Plugin persistent data lives under `.dinotty/plugin-data` in the user's home directory.
