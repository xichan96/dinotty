# MCP Server

Dinotty ships with a built-in MCP (Model Context Protocol) JSON-RPC 2.0 server, letting AI assistants (Claude, Cursor, etc.) operate terminal sessions directly.

## Table of Contents

- [Overview](#overview)
- [Transports](#transports)
  - [HTTP](#http)
  - [stdio](#stdio)
- [MCP Switches](#mcp-switches)
- [Authentication](#authentication)
- [Tools](#tools)
- [Resources](#resources)
- [JSON-RPC Methods](#json-rpc-methods)
- [Configuration Examples](#configuration-examples)

---

## Overview

The MCP server implements protocol version `2024-11-05` and supports:

- **9 tools**: terminal operations, file read/write, Git queries
- **3 resources**: session list, screen contents, history
- **2 transports**: HTTP (Streamable HTTP compatible), stdio (the legacy HTTP+SSE stream is kept for compatibility only)

---

## Transports

### HTTP

For web integration and remote access. `POST /mcp/message` returns the complete JSON-RPC response body directly — the same semantics as the MCP spec's Streamable HTTP transport, compatible with current mainstream clients (Claude Code, Claude.ai, Cursor, etc.).

**Endpoints:**

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/mcp/message` | POST | Send a JSON-RPC request; returns the JSON-RPC response body directly (empty body for notifications without an id) |
| `/mcp/sse` | GET | Legacy HTTP+SSE stream for server-pushed messages (deprecated by the spec, kept for compatibility) |

**Flow (POST /mcp/message):**

1. Client posts a JSON-RPC request to `POST /mcp/message` (with the Bearer token)
2. Server returns the complete JSON-RPC response body

**Legacy SSE stream (`GET /mcp/sse`):**

The MCP spec deprecated the HTTP+SSE transport (replaced by Streamable HTTP on 2025-03-26). `GET /mcp/sse` is kept for legacy clients: connect, receive the `endpoint` event, then post requests to `POST /mcp/message`; responses are also broadcast to all connected SSE clients.

**`endpoint` event:**

```json
{"jsonrpc":"2.0","method":"endpoint","params":{"uri":"/mcp/message"}}
```

### stdio

For local CLI integration. `dinotty-server --mcp-stdio` runs as a stdio proxy: reads line-delimited JSON-RPC from stdin, forwards each request to the local main service (`POST /mcp/message`, with the Bearer token), and writes the response body back to stdout. It does not start its own HTTP server — it connects to an already-running dinotty main process.

**Prerequisites:**

1. The main service is running on a matching port (`--port` defaults to 8999)
2. `mcp.stdio_enabled` is `true` in settings (otherwise the process exits with an error)
3. The token is readable (`settings::load_token()`, falling back to the `DINOTTY_TOKEN` environment variable)

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | dinotty-server --mcp-stdio --port 8999
```

Windows PowerShell:

```powershell
'{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | .\dinotty-server.exe --mcp-stdio --port 8999
```

---

## MCP Switches

MCP is enabled by default; the `mcp` block in settings can disable HTTP and/or stdio as needed (checked per-request, so changes apply immediately without a restart):

```json
"mcp": { "http_enabled": true, "stdio_enabled": false }
```

| Switch | Default | Effect |
|--------|---------|--------|
| `mcp.http_enabled` | `true` | Controls the HTTP endpoints (`POST /mcp/message` and the legacy `GET /mcp/sse`); both return 404 when `false` |
| `mcp.stdio_enabled` | `false` | Controls the `--mcp-stdio` proxy; the proxy exits with an error when `false` |

`POST /mcp/message` is gated by both switches: it is served while `http_enabled || stdio_enabled` is `true` (the stdio proxy also uses this endpoint), and returns 404 otherwise. The four combinations:

| `http_enabled` | `stdio_enabled` | Behavior |
|----------------|-----------------|----------|
| `true` | `false` | HTTP available, stdio proxy unavailable (default) |
| `false` | `true` | stdio proxy only; HTTP endpoints return 404 |
| `true` | `true` | Both modes available |
| `false` | `false` | Fully disabled; `/mcp/sse` and `/mcp/message` both return 404 |

---

## Authentication

MCP endpoints require Bearer Token auth - either the global token or an Agent Token.

```bash
# Test with curl
curl -H "Authorization: Bearer <token>" \
     -X POST http://localhost:8999/mcp/message \
     -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

Agent Tokens require the matching capability:

| Operation | Required Capability |
|-----------|---------------------|
| `terminal_*` tools | `terminal:read` / `terminal:write` |
| `file_*` tools | `workspace:read` / `workspace:write` |
| `git_*` tools | `workspace:read` |

Agent Token scopes are also enforced (see the [Token System](/zh/internals/token-system) doc, Chinese): `terminal:read` / `terminal:write` scopes restrict the accessible panes (`terminal_list` filters out panes outside the scope), and `workspace:read` / `workspace:write` scopes restrict the accessible directories (directory-prefix matching). `git_status` operates on the process working directory and is not restricted by workspace scopes.

---

## Tools

### terminal_execute

Execute a shell command and wait for completion.

```json
{
  "name": "terminal_execute",
  "arguments": {
    "command": "ls -la",
    "cwd": "/tmp",
    "pane_id": "active",
    "timeout": 30000
  }
}
```

`pane_id` is optional, defaulting to `active` (the currently active pane, or the first pane when none is active).

**Returns:** JSON string containing `exit_code`, `stdout`, `duration_ms`, `method`

**Hints:** `readOnlyHint: false`, `destructiveHint: true`

### terminal_read

Read the terminal screen.

```json
{
  "name": "terminal_read",
  "arguments": {
    "pane_id": "active"
  }
}
```

**Returns:** Plain-text screen contents

### terminal_send

Send input to the terminal (fire-and-forget).

```json
{
  "name": "terminal_send",
  "arguments": {
    "command": "echo hello",
    "pane_id": "active"
  }
}
```

### terminal_list

List all active terminal sessions.

```json
{"name": "terminal_list", "arguments": {}}
```

**Returns:** JSON array; each item has `pane_id`, `shell`, `cols`, `rows`, `cwd`

### file_read

Read a file's contents (restricted to the user's home directory). Paths use the server platform's native format; Windows paths in JSON need escaped backslashes, e.g. `C:\\Users\\dev\\project\\main.rs`.

```json
{
  "name": "file_read",
  "arguments": {
    "path": "/Users/dev/project/main.rs",
    "pane_id": "active"
  }
}
```

### file_write

Write a file (restricted to the user's home directory).

```json
{
  "name": "file_write",
  "arguments": {
    "path": "/Users/dev/project/output.txt",
    "content": "Hello World"
  }
}
```

### file_list

List directory contents.

```json
{
  "name": "file_list",
  "arguments": {
    "path": "/Users/dev/project"
  }
}
```

### git_status

Get git status (equivalent to `git status --porcelain`).

```json
{"name": "git_status", "arguments": {}}
```

### git_diff

Get the git diff for a file.

```json
{
  "name": "git_diff",
  "arguments": {
    "path": "src/main.rs"
  }
}
```

---

## Resources

### terminal://sessions

JSON list of all active terminal sessions.

```json
{"jsonrpc":"2.0","id":1,"method":"resources/read","params":{"uri":"terminal://sessions"}}
```

### terminal://{pane_id}/screen

Current screen contents for the given pane (URI template).

```json
{"jsonrpc":"2.0","id":1,"method":"resources/read","params":{"uri":"terminal://pane-abc/screen"}}
```

### terminal://{pane_id}/scrollback

History for the given pane (last 1000 lines).

---

## JSON-RPC Methods

| Method | Description |
|--------|-------------|
| `initialize` | Initialize the connection; returns protocol version and server capabilities |
| `ping` | Heartbeat |
| `tools/list` | List available tools |
| `tools/call` | Invoke a tool |
| `resources/list` | List static resources |
| `resources/read` | Read a resource |
| `resources/subscribe` | Subscribe to resource changes (currently a no-op) |
| `resources/templates/list` | List URI templates |
| `prompts/list` | List prompt templates (currently empty) |

---

## Configuration Examples

### Claude Desktop

```json
{
  "mcpServers": {
    "dinotty": {
      "url": "http://localhost:8999/mcp/sse",
      "headers": {
        "Authorization": "Bearer your-token-here"
      }
    }
  }
}
```

### Cursor

In `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "dinotty": {
      "url": "http://localhost:8999/mcp/sse",
      "headers": {
        "Authorization": "Bearer your-token-here"
      }
    }
  }
}
```

### Security recommendations

1. **Create a dedicated Agent Token for MCP clients**, granting only the capabilities they need
2. **Set an expiry** to avoid long-lived tokens
3. **Audit MCP calls periodically**: on Linux at `~/.config/dinotty/audit.log`, macOS at `~/Library/Application Support/dinotty/audit.log`, Windows at `%APPDATA%\dinotty\audit.log`
