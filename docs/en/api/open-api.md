# Open API (Terminal I/O)

The Open API is a set of HTTP / WebSocket interfaces for reading terminal screens and scrollback, writing raw input to a pane, resizing panes, executing commands synchronously, and subscribing to events. It does not create or destroy tabs/panes - that's the [Tabs & Panes API](./tabs-panes-api.md)'s job.

## Table of Contents

- [Overview](#overview)
- [Enable Switch](#enable-switch)
- [Authentication](#authentication)
- [HTTP Endpoints](#http-endpoints)
  - [GET /api/sessions](#get-apisessions)
  - [GET /api/sessions/:pane_id/screen](#get-apisessionspane_idscreen)
  - [GET /api/sessions/:pane_id/scrollback](#get-apisessionspane_idscrollback)
  - [POST /api/sessions/:pane_id/input](#post-apisessionspane_idinput)
  - [POST /api/sessions/:pane_id/resize](#post-apisessionspane_idresize)
  - [POST /api/sessions/:pane_id/run](#post-apisessionspane_idrun)
  - [POST /api/sessions/:pane_id/send](#post-apisessionspane_idsend)
  - [GET /api/sessions/:pane_id/read](#get-apisessionspane_idread)
  - [POST /api/input](#post-apiinput)
- [WebSocket](#websocket)
- [Concurrency Control](#concurrency-control)
- [Shell Integration](#shell-integration)
- [Capability Requirements](#capability-requirements)
- [Error Format](#error-format)

---

## Overview

| Operation | Endpoint | Description |
|-----------|----------|-------------|
| List sessions | `GET /api/sessions` | Metadata for all PTY sessions + active_pane_id |
| Read screen | `GET /api/sessions/:pane_id/screen` | Current visible area (plain / ansi) |
| Read scrollback | `GET /api/sessions/:pane_id/scrollback` | Last N lines of history |
| Write input (raw bytes) | `POST /api/sessions/:pane_id/input` | Inject bytes into a specific pane |
| Resize | `POST /api/sessions/:pane_id/resize` | Change PTY cols/rows |
| Synchronous exec | `POST /api/sessions/:pane_id/run` | Send command and wait for exit_code + stdout |
| Async send | `POST /api/sessions/:pane_id/send` | Send command + `\n`, fire-and-forget |
| Structured read | `GET /api/sessions/:pane_id/read` | Screen content + cursor + cwd in one call |
| Write to active pane | `POST /api/input` | Falls back to active pane when `pane_id` is omitted |
| Event stream | `WS /ws/events` | WebSocket for command execution + event subscription |

`input` vs `send`: `input` writes raw bytes (no trailing newline, no audit); `send` appends `\n` and writes an audit log entry (agent token only). Use `input` for simple scripts, `send` for command-level automation.

`screen`/`scrollback` vs `read`: `screen`/`scrollback` return plain/ansi text; `read` returns structured JSON (with cursor/cwd/scrollback). Operator scenarios use the former; agent scenarios use the latter.

The Open API operates on existing PTY sessions. To create new sessions, use the [Tabs API](./tabs-panes-api.md).

---

## Enable Switch

The Open API is disabled by default. Set `open_api.enabled = true` to unlock `/api/sessions/*` and `/api/input`.

```bash
curl -X PUT -H "Authorization: Bearer <token>" \
     http://localhost:8999/api/settings \
     -d '{"open_api":{"enabled":true}, /* ...echo other settings back */ }'
```

When disabled, every Open API endpoint returns:

```json
{ "error": "open_api is disabled" }
```

HTTP 403.

---

## Authentication

The Open API uses dual-track auth:

- **Session Cookie**: browser same-origin contexts (operator mode)
- **Global Bearer Token**: `Authorization: Bearer <global-token>`, full capabilities
- **Agent Bearer Token**: fine-grained token created via `/api/tokens`, validated by capability

`run` / `send` / `read` / `WS /ws/events` accept all three credentials; `sessions` / `screen` / `scrollback` / `input` / `resize` only accept session cookie or global token (no capability check).

### Agent Token

Fine-grained token created via `/api/tokens` with per-permission scoping:

```bash
# Create a read-only token
curl -X POST -H "Authorization: Bearer <global-token>" \
     http://localhost:8999/api/tokens \
     -d '{
       "name": "monitoring-agent",
       "capabilities": ["terminal:read"],
       "expires_in": 86400
     }'
# Returns: {"token": "dnt_...", "token_info": {...}}
```

Token format: `dnt_<64-hex>`, stored as SHA-256 hash.

### Audit Log

When a request uses an agent token, `run` / `send` write to the audit log (`~/.config/dinotty/audit.log`); session cookie / global token requests skip audit (operator mode = trusted UI user).

---

## HTTP Endpoints

### GET /api/sessions

List all PTY sessions.

**Response (200):**

```json
{
  "sessions": [
    {
      "pane_id": "pane-1",
      "tab_id": "tab-aaa",
      "shell_type": "zsh",
      "status": "connected",
      "size": { "cols": 120, "rows": 32 },
      "cwd": "/Users/dev/project"
    },
    {
      "pane_id": "pane-2",
      "tab_id": "tab-bbb",
      "shell_type": "ssh",
      "status": "detached",
      "size": { "cols": 80, "rows": 24 },
      "cwd": null
    }
  ],
  "active_pane_id": "pane-1"
}
```

`status` values:

- `connected` - PTY is alive
- `detached` - PTY has exited but the layout hasn't been cleaned up yet

`cwd` is the working directory the server derived from shell integration (OSC 7 / synchronized probing); may be `null` for SSH sessions or shells without integration.

---

### GET /api/sessions/:pane_id/screen

Read the current visible screen.

**Query params:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `format` | string | `plain` | `plain` strips ANSI; `ansi` preserves colors and cursor sequences |

**Response (200):**

```json
{
  "pane_id": "pane-1",
  "content": "$ ls -la\ntotal 0\ndrwxr-xr-x  2 dev  staff   64 Aug  8 10:00 .\n",
  "size": { "cols": 120, "rows": 32 }
}
```

`content` is a newline-joined string. `ansi` mode is good for recording / replaying terminal frames; `plain` is good for log scraping and regex matching.

---

### GET /api/sessions/:pane_id/scrollback

Read scrollback history.

**Query params:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `lines` | int | 200 (ansi) / all (plain) | Last N lines to return |
| `format` | string | `plain` | `plain` / `ansi` |

**Response (200):**

```json
{
  "pane_id": "pane-1",
  "lines": [
    "$ npm install",
    "added 312 packages in 4s",
    "$ npm run build",
    "> build",
    "> esbuild src/main.ts --bundle"
  ],
  "total": 1247
}
```

`total` is the scrollback buffer's full line count, useful for telling whether earlier output exists. `lines` is capped at 10000.

---

### POST /api/sessions/:pane_id/input

Inject raw input bytes into a specific pane (no trailing newline added).

**Request body:**

```json
{ "data": "ls -la\r" }
```

`data` is a string written to the PTY as UTF-8 bytes. Use `\r` for Enter, `` for Ctrl+C, `` for Ctrl+D.

**Response:**

- 200 `{"ok": true}`
- 404 - pane not found
- 500 - PTY write failed (session has exited)

> **Note**: This endpoint bypasses the [Mission Control safety net](./mission-control-api.md#input-safety-net-while-mc-is-open). Even when MC is open, input still reaches the PTY. If you need "user-perspective" semantics (drop input while MC is open), send `Input` over `/ws/sync` instead.

---

### POST /api/sessions/:pane_id/resize

Resize the pane (PTY cols × rows).

**Request body:**

```json
{ "cols": 120, "rows": 32 }
```

**Response:**

- 200 `{"ok": true}`
- 400 - `cols` or `rows` is 0
- 404 - pane not found
- 500 - PTY resize failed

Resize triggers TIOCSWINSZ; programs running inside the shell receive `SIGWINCH`.

---

### POST /api/sessions/:pane_id/run

Synchronously execute a command, waiting for completion or timeout. Relies on [Shell Integration](#shell-integration) for command boundary detection.

**Request body:**

```json
{
  "command": "ls -la",
  "cwd": "/tmp",           // optional, working directory; Windows example: "C:\\Users\\dev\\project"
  "env": {"KEY": "val"},   // optional, environment variables (not yet implemented)
  "timeout": 30000,        // optional, timeout in ms (default 300000, max 3600000)
  "strip_ansi": true       // optional, strip ANSI escapes (default true)
}
```

`pane_id` is specified in the path, not the request body.

**Success response (200):**

```json
{
  "exit_code": 0,
  "stdout": "file1.txt\nfile2.txt\n",
  "stderr": "",
  "duration": 150,
  "pane_id": "pane-abc123",
  "method": "shell_integration"
}
```

**`method` field:**

| Value | Description |
|-------|-------------|
| `shell_integration` | Command completion detected via OSC 133 (most accurate) |
| `prompt_detection` | Detected via prompt pattern matching (fallback) |
| `timeout` | Command timed out |

**Capability:** `terminal:write` (agent token path)

---

### POST /api/sessions/:pane_id/send

Send a command to the terminal (auto-appends `\n`), fire-and-forget.

**Request body:**

```json
{
  "command": "echo hello"
}
```

**Response (200):**

```json
{"ok": true, "pane_id": "pane-abc123"}
```

**Capability:** `terminal:write` (agent token path)

---

### GET /api/sessions/:pane_id/read

Structured read of the terminal screen, including cursor / cwd / scrollback.

**Query params:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `scrollback` | int | none | Return last N history lines (max 10000) |
| `strip_ansi` | bool | true | Strip ANSI escapes |

**Response (200):**

```json
{
  "pane_id": "pane-abc123",
  "lines": ["$ ls -la", "total 0", "drwxr-xr-x  ..."],
  "scrollback": ["previous command output..."],
  "cursor": {"row": 5, "col": 12},
  "cwd": "/Users/dev/project"
}
```

**Capability:** `terminal:read` (agent token path)

---

### POST /api/input

Inject input into the active pane. Equivalent to `POST /api/sessions/:pane_id/input` but the caller doesn't have to track the active pane.

**Request body:**

```json
{
  "pane_id": "pane-1",
  "data": "echo hi\r"
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `data` | yes | Bytes to inject |
| `pane_id` | no | Target pane; falls back to `active_pane_id` if omitted, then to the first session if active is empty |

**Response:**

- 200 `{"ok": true}`
- 400 - no session available
- 404 - specified `pane_id` does not exist

---

## WebSocket

Connect: `ws://localhost:8999/ws/events`

Auth: Bearer header or `?token=<agent_token>` query param (use query param when browser WS clients can't set headers). Session cookie path is not supported (WS route is in the outer auth exempt list).

### Client message format

**Execute command:**

```json
{
  "type": "run",
  "id": "req-1",           // request ID for matching responses
  "command": "npm test",
  "timeout": 60000
}
```

**Subscribe to events (all events are auto-subscribed):**

```json
{"type": "subscribe"}
```

**Heartbeat:**

```json
{"type": "ping"}
```

### Server message format

**Command result:**

```json
{
  "type": "result",
  "id": "req-1",
  "exit_code": 0,
  "stdout": "All tests passed\n",
  "stderr": "",
  "duration": 3200,
  "pane_id": "pane-abc123",
  "method": "shell_integration"
}
```

**Event push:**

```json
{
  "type": "event",
  "event": {
    "event": "command_finished",
    "data": {
      "pane_id": "pane-abc123",
      "command": "",
      "exit_code": 0,
      "duration_ms": 150,
      "stdout": "",
      "method": "shell_integration"
    }
  }
}
```

**Error:**

```json
{
  "type": "error",
  "id": "req-1",
  "error": {"code": "NOT_FOUND", "message": "No active session"}
}
```

**Heartbeat response:**

```json
{"type": "pong"}
```

---

## Concurrency Control

- Each token allows up to **10** concurrent `run` requests
- Exceeding returns `429 Too Many Requests` with a `Retry-After: 5` header
- `send` and `read` are not concurrency-limited

---

## Shell Integration

The `run` endpoint relies on the OSC 133 Shell Integration protocol for command boundary detection, falling back to prompt detection when the shell doesn't fully support it:

```
ESC ] 133 ; A ESC \    -> Prompt start
ESC ] 133 ; B ESC \    -> Command start (user pressed Enter)
ESC ] 133 ; D ; N ESC \ -> Command finished, N is the exit code
```

Dinotty auto-injects or enables the integration based on the local shell:

- **zsh**: injects OSC 133 via `precmd_functions` and `preexec_functions` hooks
- **bash**: injects OSC 133 via `PROMPT_COMMAND` and `BASH_ENV` trap
- **PowerShell / pwsh (Windows)**: injects a `prompt` function at startup for window title, cwd, and prompt boundary sync; command completion may still use `prompt_detection` fallback
- **cmd.exe / sh / other shells**: OSC 133 not guaranteed; auto-falls back to prompt detection

On Windows, the `command` field is sent to the actual shell of the pane; PowerShell accepts `Get-ChildItem`, cmd accepts `dir`. Windows paths in JSON strings need to be written as `C:\\Users\\dev\\project`.

---

## Capability Requirements

Only the agent token path requires capability checks; session cookie / global token pass automatically.

| Operation | Required Capability |
|-----------|---------------------|
| `POST /api/sessions/:pane_id/run` | `terminal:write` |
| `POST /api/sessions/:pane_id/send` | `terminal:write` |
| `GET /api/sessions/:pane_id/read` | `terminal:read` |
| `WS /ws/events` | none (subscribe-only) |

---

## Error Format

```json
{ "error": "pane not found" }
```

| HTTP | Meaning |
|------|---------|
| 400 | Invalid params (cols/rows=0, no active pane) |
| 401 | Unauthenticated |
| 403 | `open_api.enabled = false` or token lacks capability |
| 404 | Pane not found |
| 429 | Concurrent `run` limit exceeded |
| 500 | PTY write / resize failed |
