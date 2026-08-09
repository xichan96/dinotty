# Introduction

A terminal built for coding agents.

Run Claude Code, opencode, Codex, or OpenClaw on any device -- simple, extensible, multi-device, never lose a session.

## Philosophy

Terminal coding agents - Claude Code, opencode, Codex, OpenClaw - are powerful, yet confined to a single window. Dinotty sets them free. One terminal. Every device. Every possibility.

### Sync everywhere

Half-done on your laptop. Pick up your phone, keep going. Back to your laptop, exactly as you left it.

### Endless extensibility

JS plugins with hot reload. CC Switch, JSON Formatter, Claude Code dialog management - built in. Custom commands, terminal interaction, event subscriptions, CLI integration - the API is ready.

### Everything is a pane

Terminal, files, web preview, Git changes, SSH remote. Drag to split, move across tabs. All in one flow.

### Never drops

Server-side VTE. PTY survives disconnects. Refresh the page, you're back where you were.

### Free and open

Self-hosted. No subscriptions. No relay. Your data stays on your machine.

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
