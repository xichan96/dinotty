<p align="center">
  <img src="docs/images/logo.png" alt="Dinotty Logo" width="200" />
</p>

<h1 align="center">Dinotty</h1>

<p align="center">
  <a href="https://github.com/xichan96/dinotty/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="License"></a>
  <img src="https://img.shields.io/badge/language-Rust-orange" alt="Rust">
  <img src="https://img.shields.io/badge/frontend-Vue%203-brightgreen" alt="Vue 3">
  <a href="https://github.com/xichan96/dinotty/stargazers"><img src="https://img.shields.io/github/stars/xichan96/dinotty?style=social" alt="GitHub Stars"></a>
  <a href="https://github.com/xichan96/dinotty/releases"><img src="https://img.shields.io/github/downloads/xichan96/dinotty/total" alt="GitHub Downloads"></a>
  <a href="https://github.com/xichan96/dinotty/issues"><img src="https://img.shields.io/github/issues/xichan96/dinotty" alt="GitHub Issues"></a>
</p>

<p align="center">
  English | <a href="./README.md">中文</a>
</p>

---

A **multi-device** terminal server purpose-built for **coding agents**. Run Claude Code, opencode, Codex, or OpenClaw on any device — desktop-class on your laptop, always in your pocket on your phone. Switch seamlessly, never lose a session.

## Screenshots

<p align="center">
  <img src="docs/images/1.png" alt="Running Claude Code on mobile" width="250" />
  <img src="docs/images/2.png" alt="Full keyboard layout with htop" width="250" />
  <img src="docs/images/3.png" alt="Theme settings" width="250" />
</p>
<p align="center">
  <img src="docs/images/4.png" alt="Custom shortcut keyboard" width="250" />
  <img src="docs/images/5.png" alt="System monitor" width="250" />
  <img src="docs/images/6.png" alt="Notification system" width="250" />
</p>
<p align="center">
  <img src="docs/images/7.png" alt="Tablet landscape desktop-class layout" width="500" />
</p>

## Desktop Demo

The desktop client delivers a professional experience comparable to iTerm2:

**Split Screen** — Draggable multi-pane split with free layout adjustment:

<p align="center">
  <img src="docs/images/split-screen.GIF" alt="Split screen demo" width="600" />
</p>

**Plugin System** — Hot-reloadable JS plugins with built-in CC Switch, JSON Formatter, and more:

<p align="center">
  <img src="docs/images/plugin-system.GIF" alt="Plugin system demo" width="600" />
</p>

**Web Preview** — Preview local dev servers on your phone, built-in reverse proxy, no need to switch browsers:

<p align="center">
  <img src="docs/images/web-preview.GIF" alt="Web preview demo" width="600" />
</p>

## Why Dinotty?

Terminal-based coding agents (Claude Code, opencode, Codex, OpenClaw, etc.) are powerful, but they're locked inside a single terminal window. Dinotty lets you:

- **Manage agents from any device** — deep coding on desktop, scan a QR code on your phone when you leave your desk to keep monitoring and managing your agent's work without interruption
- **Multi-device sync, seamless switching** — start on your laptop, continue on your phone; return to your laptop and pick up right where you left off
- **Verify agent output directly** — code diffs, rendered pages, generated files, all visible in the built-in browser
- **Never lose your session** — disconnect, lock your screen, switch devices — come back and everything is exactly where you left it

### Lightweight — Not a Remote Desktop

| | Dinotty | Remote Desktop (VNC/RDP/Parsec) |
|---|---|---|
| **Data transmitted** | Text only (JSON, bytes) | Full screen pixels at 30-60 fps |
| **Bandwidth** | ~1–10 KB/s typical | ~1–10 MB/s (100–1000x more) |
| **Mobile data friendly** | ✅ Works on 3G/4G without lag | ❌ Choppy, high latency, burns data |
| **Weak signal tolerance** | ✅ Auto-reconnect, no frame loss | ❌ Frozen screen, input lag |
| **Battery consumption** | Low (text rendering) | High (video decoding) |
| **Resolution adaptation** | Native text at any size | Scaled bitmap, blurry on phone |
| **Interaction** | Native touch, custom keyboard | Simulated mouse, tiny desktop UI |

## Key Features

- **Server-side virtual terminal** — full VTE parser, server knows exact screen state, enables session recovery & screen snapshots
- **Session persistence** — PTY processes survive disconnection, auto-reconnect with exponential backoff, refresh page to restore
- **Split pane & multi-tab** — draggable split, multi-tab management with server-led pane lifecycle
- **Broadcast mode** — input in one pane, execute in all panes simultaneously, free
- **Command bookmarks** — right-click terminal text to bookmark, group management, one-click execution
- **Server list** — manage multiple remote servers, quick switch connections
- **Responsive layout** — portrait stacks vertically, landscape side-by-side; touch-optimized buttons & pane resizing
- **Customizable shortcut keyboard** — add Ctrl/Esc/function keys for mobile, supports arbitrary escape sequences
- **Built-in file browser** — code highlighting, Markdown rendering, Office document preview, audio/video playback
- **Git change indicators** — gutter marks for added/modified/deleted lines, inline diff, Stage/Revert
- **Web preview** — built-in reverse proxy to preview local dev servers in iframe
- **Notification system** — terminal bell/OSC detection, WebSocket push, configurable sound alerts
- **System monitor** — real-time CPU/memory/network charts
- **Plugin system** — JS plugins + CLI bridge, hot-reload; ships with CC Switch, JSON Formatter, Claude Code conversation manager, etc.
- **Open API** — HTTP endpoint for external device control (Stream Deck, Shortcuts, automation scripts)
- **Command palette** — quick-access command launcher
- **Desktop app** — optional Tauri-based native client

## Comparison with Other Terminals

| Capability | Dinotty | ttyd | gotty | Wetty |
|---|---|---|---|---|
| Server-side virtual terminal (VT Screen) | ✅ | ❌ | ❌ | ❌ |
| Session survives network disconnect | ✅ | ❌ | ❌ | ❌ |
| Refresh page = restore session | ✅ | ❌ | ❌ | ❌ |
| Built-in file browser & preview | ✅ | ❌ | ❌ | ❌ |
| Git change indicators | ✅ | ❌ | ❌ | ❌ |
| Built-in web preview (reverse proxy) | ✅ | ❌ | ❌ | ❌ |
| Customizable shortcut keyboard | ✅ | ❌ | ❌ | ❌ |
| Broadcast mode | ✅ | ❌ | ❌ | ❌ |
| Command bookmarks | ✅ | ❌ | ❌ | ❌ |
| Plugin system | ✅ | ❌ | ❌ | ❌ |
| Token auth | ✅ | ✅ | ❌ | ✅ |

Other web terminals are thin WebSocket-to-PTY pipes. Dinotty runs a **full virtual terminal emulator on the server**, enabling session recovery and screen snapshots. Combined with the built-in file/web browser, it provides a self-contained environment where coding agents work and users verify results.

## AI Coding Solutions Comparison

| | Dinotty | Claude Code Remote | Codex Web | Happy | hapi | Termius | tmux |
|---|---|---|---|---|---|---|---|
| Positioning | Web terminal server | Built-in multi-device | Cloud agent | AI Agent remote client | AI Agent remote client | SSH client | Terminal multiplexer |
| Approach | Server-side VTE + Web UI | Anthropic cloud + local | OpenAI cloud | CLI proxy wrapper | CLI proxy wrapper | Native app | Server-side process |
| Web access | ✅ | ✅ claude.ai/code | ✅ chatgpt.com/codex | ✅ | ✅ PWA | ❌ | ❌ |
| Native app | Tauri (optional) | iOS + Android | ❌ | iOS + Android | ❌ (PWA) | All platforms | ❌ |
| General terminal | ✅ Any command | ❌ AI agents only | ❌ AI agents only | ❌ AI agents only | ❌ AI agents only | ✅ SSH | ✅ |
| Coding agent support | ✅ File browser/preview/notify | ✅ Built-in | ✅ Built-in | ✅ Voice/approve | ✅ Voice/workspace | ❌ | ❌ |
| Split screen | ✅ Native drag | ❌ | ❌ | ❌ | ❌ | ❌ | ⚠️ tmux commands |
| Broadcast mode | ✅ Free | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Command bookmarks | ✅ Free | ❌ | ❌ | ❌ | ❌ | 💰 Paid | ❌ |
| Plugin system | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Multi-device sync | ✅ Browser-based | ✅ Cross-device session sync | ✅ Cloud sessions | ✅ | ✅ | ✅ Vault | ❌ Requires SSH |
| Relay service | Planned | ✅ Anthropic hosted | ✅ OpenAI hosted | ✅ | ✅ | SaaS | ❌ |
| Deployment | Self-hosted | SaaS | SaaS | Relay service | Self-hosted/relay | SaaS | Self-hosted |
| Code runs on | Your own server | Local / Anthropic cloud | OpenAI cloud | Local | Local | Remote SSH | Remote server |
| Price | 🆓 Free & open source | 💰 Pro subscription | 💰 Plus subscription | Relay service | Self-hosted/relay | 💰 $10/mo | 🆓 but painful |

Claude Code and Codex each offer built-in remote solutions, but are limited to their own agent ecosystem. Happy and hapi are third-party remote control layers that wrap CLI tools for phone-based approval and voice interaction. Dinotty is a general-purpose web terminal server where agents run natively on the server, with a full working environment including file browser, web preview, and plugin system, delivering a professional experience on both desktop and mobile.

## Installation

Download the installer for your platform from [GitHub Releases](https://github.com/xichan96/dinotty/releases):

| Platform | Format | Notes |
|----------|--------|-------|
| **macOS** | `.dmg` | Open and drag to Applications |
| **Linux** | `.deb` | `sudo dpkg -i dinotty_*.deb` |

> You can also build from source, see "Quick Start" below.

**macOS Note**: Since the app is unsigned, macOS may show **"Dinotty" is damaged and can't be opened**. Run the following command after installation to remove the restriction:

```bash
xattr -cr /Applications/Dinotty.app
```

**Linux one-liner install**:

```bash
curl -LO https://github.com/xichan96/dinotty/releases/download/v0.11.2/dinotty-server_0.11.2-1_amd64.deb && sudo dpkg -i dinotty-server_0.11.2-1_amd64.deb
```

**Linux startup**:

```bash
# systemd
systemctl start dinotty-server
systemctl enable dinotty-server  # auto-start on boot

# Docker container
nohup dinotty-server &
```

Default port is **8999**. After starting, visit `http://<your-ip>:8999`. Use `-p` to specify a custom port:

```bash
dinotty-server -p 3000
```

## Quick Start

```bash
# Build frontend
cd frontend && pnpm install && pnpm run build && cd ..

# Run server
cargo run
```

Open http://127.0.0.1:8999 in your browser.

```bash
# Backend with debug logging
RUST_LOG=debug cargo run

# Frontend type-check
cd frontend && npx vue-tsc --noEmit
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Rust, Axum 0.7, Tokio, portable-pty, vte |
| Frontend | Vue 3, TypeScript, Vite, xterm.js 5 |
| Desktop | Tauri |

**Written in Rust · Single binary · Zero dependencies** — Runs a full VT state machine on the server, not a pipe-forwarding proxy, so sessions survive disconnection.

## Project Structure

```
src/               # Rust backend
  main.rs          # Axum router & server entry
  lib.rs           # Library entry point
  ws.rs            # WebSocket ↔ PTY bridge
  vt_screen.rs     # Virtual terminal emulator (VTE-based)
  session.rs       # Session manager (multi-pane)
  pty.rs           # PTY creation & management
  tabs.rs          # Tab & pane management
  history.rs       # Session history
  workspace/       # File workspace API
  proxy/           # Reverse proxy for preview
  monitor.rs       # System monitor
  notification.rs  # Notification broadcast (bell/OSC detection)
  plugin/          # Plugin system management
  settings.rs      # Settings persistence
  auth.rs          # Authentication
  file_watcher.rs  # File change watching

frontend/          # Vue 3 SPA
  src/
    App.vue
    components/
      split/           # SplitContainer, TabBar, PaneHeader, StatusBar
      terminal/        # TerminalPane, MonitorPopover
      command/         # CommandPalette, CommandBookmarks
      keyboard/        # MobileKeyboard, HistoryPanel, SuggestionBar
      notification/    # NotificationPanel, NotificationCard
      preview/         # FileWorkspacePreview, PreviewPanel, WebPreview
      settings/        # Settings tabs (General, Theme, Keyboard, etc.)
      workspace/       # MonacoEditor, FilePreviewContent, gitDecorations
      plugin/          # PluginView
      ui/              # ConfirmModal and other shared components
      ServerList.vue   # Server list
    composables/   # useTerminal, useTransport, useSettings, useTabApi, etc.

src-tauri/         # Tauri desktop client
docs/              # Design documents
```

## WebSocket Protocol

JSON messages over `/ws`:

| Direction | `type` | Fields |
|-----------|--------|--------|
| Client → Server | `input` | `data: String` |
| Client → Server | `resize` | `cols: u16, rows: u16` |
| Server → Client | `output` | `data: String` |
| Server → Client | `shell_info` | `shell_type: String` |

## More Documentation

- [Deployment Guide](docs/deployment.en.md) — systemd, Docker, cross-platform build, configuration
- [Notification System](docs/notifications.en.md) — HTTP API, Claude Code integration, Open API
- [Plugin System](docs/plugins.en.md) — installation, manifest, API, built-in plugins
- [Plugin Development](docs/plugin-development.md) — full plugin development guide
- [Contributing](docs/contributing.en.md) — branch strategy, commit convention, code style

## Contributors

Thanks to all the people who have contributed to Dinotty!

<a href="https://github.com/xichan96/dinotty/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=xichan96/dinotty" />
</a>

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=xichan96/dinotty&type=Date)](https://star-history.com/#xichan96/dinotty&Date)

## License

MIT
