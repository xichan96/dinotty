# Introduction

**Dinotty** is a multi-device terminal server purpose-built for coding agents. Run Claude Code, opencode, Codex, or OpenClaw on any device -- desktop-class on your laptop, always in your pocket on your phone. Switch seamlessly, never lose a session.

## Why Dinotty

Terminal coding agents are powerful but confined to a single terminal window. Dinotty lets you:

- **Manage agents from any device** -- deep coding on desktop, scan a QR code on mobile to keep monitoring your agent's work
- **Multi-device sync, seamless switching** -- start on laptop, continue on phone, return to laptop with everything intact
- **Verify agent output directly** -- code diffs, rendered web pages, generated files, all visible in the built-in browser
- **Never lose a session** -- disconnect, screen-off, switch devices -- everything is still there when you return

### Lightweight -- Not a Remote Desktop

| | Dinotty | Remote Desktop (VNC/RDP) |
|---|---|---|
| **Data transferred** | Plain text (byte stream) | Full-screen pixel stream 30-60 fps |
| **Bandwidth** | ~1-10 KB/s | ~1-10 MB/s (100-1000x) |
| **Mobile network** | Smooth on 3G/4G | Stuttering, high latency |
| **Weak signal tolerance** | Auto-reconnect, no loss | Frozen frame, input lag |
| **Battery** | Low | High (video decode) |

## Core Features

- **Server-side virtual terminal** - Full VTE parsing, server holds exact screen state, PTY survives disconnects
- **Session persistence** - Auto-reconnect with exponential backoff, refresh page to restore
- **Split panes & tabs** - Draggable splits, cross-tab drag-and-drop, server-led pane lifecycle
- **Workspace management** - Multi-workspace isolation, Mission Control overview, per-workspace plugin tabs
- **Broadcast mode** - Type in one pane, execute across all panes
- **Command bookmarks** - Right-click terminal text to bookmark, grouped management, one-click execution
- **SSH remote connections** - Built-in SSH client with password/key auth
- **Remote file management (SFTP)** - Browse, edit, upload, download
- **Responsive layout** - Stacked portrait, side-by-side landscape
- **Custom shortcut keyboard** - Ctrl/Esc/function keys for mobile
- **Built-in file browser** - Code highlighting, Markdown rendering, Office preview
- **Git change indicators** - Editor gutter add/modify/delete markers, inline diff
- **Web preview** - Built-in reverse proxy, preview local dev server in iframe
- **Notification system** - Terminal bell/OSC detection, WebSocket push
- **System monitor** - Real-time CPU/memory/network charts
- **Plugin system** - JS plugins + CLI bridge, hot reload
- **Open API** - HTTP endpoints for Stream Deck and other external devices
- **Desktop app** - Optional Tauri native client

## Next Steps

- [Deployment Guide](getting-started/deployment) - Install and deploy Dinotty
- [Comparison](getting-started/comparison) - Compare with ttyd/gotty/Wetty and other solutions
- [Plugin Development](/zh/plugins/plugin-development) (中文) - Build your own plugins
