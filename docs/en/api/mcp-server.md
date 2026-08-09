# MCP Server

Dinotty ships with a built-in MCP (Model Context Protocol) JSON-RPC 2.0 server, letting AI assistants (Claude, Cursor, etc.) operate terminal sessions directly.

## Table of Contents

- [Overview](#overview)
- [Transports](#transports)
  - [HTTP + SSE](#http--sse)
  - [stdio](#stdio)
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
- **2 transports**: HTTP + SSE (recommended), stdio

---

## Transports

### HTTP + SSE

For web integration and remote access.

**Endpoints:**

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/mcp/sse` | GET | SSE stream for server messages |
| `/mcp/message` | POST | Send JSON-RPC requests |

**Flow:**

1. Client connects to `GET /mcp/sse`, receives an `endpoint` event
2. Client posts JSON-RPC requests to `POST /mcp/message`
3. Server processes the request, returns the response and broadcasts it to all SSE clients

**`endpoint` event:**

```json
{"jsonrpc":"2.0","method":"endpoint","params":{"uri":"/mcp/message"}}
```

### stdio

For local CLI integration. Receives JSON-RPC via stdin, returns responses via stdout.

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | dinotty-server --mcp-stdio
```

Windows PowerShell:

```powershell
'{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | .\dinotty-server.exe --mcp-stdio
```

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
    "timeout": 30000
  }
}
```

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
