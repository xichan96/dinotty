# Dinotty Docs

A terminal built for coding agents.

Run Claude Code, opencode, Codex, or OpenClaw on any device -- simple, extensible, multi-device, never lose a session.

Docs are split into two tracks: **User Docs** for end users, and **Dev Docs** for plugin authors, API integrators, and project contributors.

## User Docs

- [Introduction](introduction) - Why Dinotty, core features
- [Comparison](getting-started/comparison) - vs ttyd/gotty/Wetty and other AI coding remote solutions
- [Installation](installation) - Download pre-built binaries from GitHub Releases
- [Deployment Guide](getting-started/deployment) - systemd, Docker, Windows, cross-platform build

### Usage Guide

- [Multi-device Sync & Mission Control](guide/multi-device-sync) - Three-device connect, device switch, session recovery
- [Tabs & Panes](guide/tabs-and-panes) - Splits, cross-tab drag, layout templates
- [Workspace Management](guide/workspace) - Multi-workspace isolation, Mission Control overview
- [SSH & SFTP](guide/ssh-sftp) - Built-in SSH client, remote file management
- [Broadcast Mode](guide/broadcast) - One pane input, sync execution across panes
- [Command Favorites](guide/command-favorites) - Right-click bookmark, grouped management, one-click run
- [Web Preview](guide/web-preview) - Built-in reverse proxy, preview local dev server in pane
- [Mobile Keyboard & Shortcuts](guide/mobile-keyboard) - Mobile keyboard, custom layout, shortcut cheatsheet
- [System Monitor](guide/system-monitor) - Real-time CPU/memory/network charts
- [Appearance & Themes](guide/appearance) - Theme manager, font settings, color tokens

### Features

- [File Editor](features/file-editor) - Split, multi-cursor, cursor group cross-file sync
- [Notifications](features/notifications) - HTTP API, Claude Code integration, Open API

### Plugins

- [Install & Use](plugins/plugins) - Install plugins, built-in plugins, plugin API overview

## Dev Docs

- [Plugin Development Guide (中文)](/zh/plugins/plugin-development) - Full plugin development guide

### API (中文)

- [Open API](/zh/api/open-api) - Terminal I/O, command execution, event subscription (supports AI agents and automation)
- [Clipboard API](/zh/api/clipboard-api) - Mobile host paste authentication interface
- [MCP Server](/zh/api/mcp-server) - Built-in MCP JSON-RPC server

### Internals (中文)

- [Event Bus](/zh/internals/event-bus) - Global event bus for inter-module dispatch
- [Token Permission System](/zh/internals/token-system) - Capability-based multi-token access control
- [Audit Log & Webhook](/zh/internals/audit-webhook) - API usage tracking and external notifications

### Contributing

- [Contributing Guide](getting-started/contributing) - Branch strategy, commit conventions, code style
- [Releasing Guide](getting-started/releasing) - Version management, version PR, tag and GitHub Release

## Resources

- [GitHub Repository](https://github.com/xichan96/dinotty)
- [Releases](https://github.com/xichan96/dinotty/releases)
- [Issue Tracker](https://github.com/xichan96/dinotty/issues)
