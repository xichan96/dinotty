# Dinotty Docs

Dinotty is a multi-device terminal server purpose-built for coding agents. Run Claude Code, opencode, Codex, or OpenClaw on any device -- desktop-class on your laptop, always in your pocket on your phone. Switch seamlessly, never lose a session.

## Getting Started

- [Introduction](introduction) - Why Dinotty, core features
- [Comparison](getting-started/comparison) - vs ttyd/gotty/Wetty and other AI coding remote solutions
- [Deployment](getting-started/deployment) - systemd, Docker, Windows, cross-platform build
- [Releasing](getting-started/releasing) - Version management, version PR, tag and GitHub Release
- [Contributing](getting-started/contributing) - Branch strategy, commit conventions, code style

## Features

- [File Editor](features/file-editor) - Split, multi-cursor, cursor group cross-file sync
- [Notifications](features/notifications) - HTTP API, Claude Code integration, Open API

## Plugins

- [Plugin System](plugins/plugins) - Install, manifest, API, built-in plugins
- [Plugin Development (中文)](/zh/plugins/plugin-development) - Full plugin development guide

## API (中文)

- [Agent API](/zh/api/agent-api) - HTTP/WebSocket structured interaction for AI agents and automation
- [Clipboard API](/zh/api/clipboard-api) - Mobile host paste authentication interface
- [MCP Server](/zh/api/mcp-server) - Built-in MCP JSON-RPC server

## Internals (中文)

- [Event Bus](/zh/internals/event-bus) - Global event bus for inter-module dispatch
- [Token Permission System](/zh/internals/token-system) - Capability-based multi-token access control
- [Audit Log & Webhook](/zh/internals/audit-webhook) - API usage tracking and external notifications

## Resources

- [GitHub Repository](https://github.com/xichan96/dinotty)
- [Releases](https://github.com/xichan96/dinotty/releases)
- [Issue Tracker](https://github.com/xichan96/dinotty/issues)
