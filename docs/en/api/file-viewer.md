# Standalone File Viewer API

Open a single file in a read-only viewer: a native window on the desktop, a full-screen overlay in the browser and on mobile. The caller names a terminal pane; that pane's current working directory is the workspace root that confines the path. There is no directory tree, no editor tab, and no save/edit entry point.

## Table of Contents

- [Overview](#overview)
- [Authentication](#authentication)
- [Path Resolution](#path-resolution)
- [Interface List](#interface-list)
  - [POST /api/sessions/:pane_id/viewer](#post-apisessionspane_idviewer)
  - [MCP tool file_viewer_open](#mcp-tool-file_viewer_open)
- [Response](#response)
- [Error Codes](#error-codes)
- [Delivery Model](#delivery-model)
- [Examples](#examples)
- [Relationship to Open API](#relationship-to-open-api)
- [Limitations](#limitations)

---

## Overview

| Trigger | Channel | Use case |
|---------|---------|----------|
| `POST /api/sessions/:pane_id/viewer` | HTTP REST | External scripts and services |
| `file_viewer_open` | MCP | Agents running inside a Dinotty terminal pane (Claude Code, etc.) |

Both triggers resolve the path and deliver the request through the same server-side logic, so they behave identically: the only difference is how errors are serialized.

The request is broadcast to connected main-window clients over `/ws/sync`:

- **Desktop**: a native window labeled `preview-file-<paneId>`, created on first open. Opening another file from the same pane focuses the existing window and navigates it instead of creating a second one.
- **Web / mobile**: a full-screen overlay inside the main window; `Esc` closes it.

Supported content types are the existing preview formats: Markdown, images, SVG, PDF, audio/video, CSV, Excel, Office documents, logs, ipynb, JSON/YAML/TOML, and plain text.

---

## Authentication

The route is mounted in the **sessions token middleware group**, the only group that accepts all three credential types:

- **Session cookie**: obtained by logging in through `POST /api/auth`.
- **Global token**: `Authorization: Bearer <global-token>`.
- **Agent token**: `Authorization: Bearer dnt_...`, created through `/api/tokens`.

Agent tokens require the `workspace:read` capability, and the canonical target path must pass the token's `workspace:read` path scope (`SCOPE_DENIED` otherwise). As an additional guard, agent tokens can only reach files under the user's home directory, matching `file_read`'s sandbox rule.

The endpoint is **not** gated by `settings.open_api.enabled` — see [Relationship to Open API](#relationship-to-open-api).

```bash
curl -H "Authorization: Bearer <token>" \
     -X POST http://localhost:8999/api/sessions/pane-123/viewer \
     -H "Content-Type: application/json" \
     -d '{"path":"docs/design.md"}'
```

---

## Path Resolution

The workspace root is the **pane's current cwd** at request time, following the same behavior as `/api/workspace/*`. If the agent `cd`s in its shell, the base for relative paths changes accordingly.

| Input | Result |
|-------|--------|
| `docs/design.md` | Joined to the workspace root (`normalize_join`) |
| `/Users/me/project/docs/a.md` (inside the root) | Accepted — canonicalized, then must stay under the root |
| `~/project/docs/a.md` | Home is expanded first, then handled as an absolute path |
| `../../etc/passwd` or any `..` component | `INVALID_PATH` |
| A symlink that resolves outside the root | `OUTSIDE_WORKSPACE` |
| A directory or special file | `NOT_A_FILE` |
| A file larger than 500 MiB | `FILE_TOO_LARGE` |
| A missing file | `PATH_NOT_FOUND` |

Absolute paths are accepted inside the workspace so that an agent whose process cwd differs from the pane root can `pwd` first and pass a full path — the server still only serves files under the workspace. Paths outside the workspace are rejected in v1, even for the global token.

---

## Interface List

### POST /api/sessions/:pane_id/viewer

Open a file in the standalone viewer owned by the given pane.

**Request body:**

```json
{
  "path": "docs/design.md"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `path` | string | Yes | File path under the pane's workspace root. Relative paths resolve against the root; absolute paths are accepted only if they stay inside it after canonicalization. |

**Success response (200):**

```json
{
  "ok": true,
  "request_id": "5f4c1d2e-…",
  "pane_id": "pane-123",
  "path": "docs/design.md",
  "title": "design.md",
  "delivered_clients": 1
}
```

`path` is normalized to a workspace-relative path, and `title` is the file name. See [Response](#response) for field semantics.

**Errors:** see [Error Codes](#error-codes).

---

### MCP tool file_viewer_open

The MCP counterpart of the HTTP endpoint. Dinotty's MCP server manages credentials, so this is the simplest way for agents to trigger the viewer.

**Input schema:**

```json
{
  "name": "file_viewer_open",
  "description": "Open a file in a standalone read-only viewer window.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "path": {
        "type": "string",
        "description": "Path under the pane's workspace root. Relative paths are resolved against the workspace root; absolute paths are accepted only if they stay inside it."
      },
      "pane_id": {
        "type": "string",
        "description": "Terminal pane whose workspace root confines the path; defaults to the active pane. Agents should pass DINOTTY_PANE_ID."
      }
    },
    "required": ["path"]
  },
  "annotations": {
    "readOnlyHint": true,
    "destructiveHint": false,
    "idempotentHint": true,
    "openWorldHint": false
  }
}
```

| Argument | Required | Description |
|----------|----------|-------------|
| `path` | Yes | Same rules as the HTTP `path` field. |
| `pane_id` | No | Pane that supplies the workspace root. Defaults to `active` (the currently active pane). Agents should pass `DINOTTY_PANE_ID` so the path resolves against their own terminal. |

**Capability:** `workspace:read` (with the token's path scope enforced).

**Returns:** a JSON string with the same fields as the HTTP success response (`ok`, `request_id`, `pane_id`, `path`, `title`, `delivered_clients`).

MCP errors are returned as tool error messages (the JSON-RPC layer wraps them), not as the HTTP `{ "error": { "code", "message" } }` object. The underlying error conditions and codes are the same.

---

## Response

| Field | Type | Description |
|-------|------|-------------|
| `ok` | boolean | Always `true` on success |
| `request_id` | string | Unique id for this delivery; the front end uses it to key the overlay |
| `pane_id` | string | Pane whose workspace root resolved the path |
| `path` | string | Workspace-relative path that was delivered |
| `title` | string | File name shown in the native window / overlay title bar |
| `delivered_clients` | number | Number of main-window clients the sync message was queued to |

---

## Error Codes

Errors use a uniform body:

```json
{ "error": { "code": "OUTSIDE_WORKSPACE", "message": "outside workspace" } }
```

| Code | HTTP | Meaning |
|------|------|---------|
| `UNKNOWN_PANE` | 404 | The pane does not exist |
| `CWD_UNAVAILABLE` | 409 | The pane has not reported a usable cwd yet |
| `INVALID_PATH` | 400 | Empty path, `..` component, or otherwise invalid path |
| `PATH_NOT_FOUND` | 404 | The file does not exist |
| `OUTSIDE_WORKSPACE` | 403 | After canonicalization the path is outside the workspace root (including symlink escapes) |
| `NOT_A_FILE` | 400 | The target is a directory or a special file |
| `FILE_TOO_LARGE` | 413 | The file exceeds 500 MiB |
| `SCOPE_DENIED` | 403 | The agent token's `workspace:read` path scope does not cover the target |
| `SSH_UNSUPPORTED` | 400 | SSH panes are not supported in v1 |
| `NO_UI_CLIENT` | 409 | No main-window client is connected to display the viewer |

---

## Delivery Model

The server validates the request, then broadcasts a sync message over `/ws/sync`:

```json
{
  "type": "open_file_viewer",
  "request_id": "5f4c1d2e-…",
  "pane_id": "pane-123",
  "path": "docs/design.md",
  "title": "design.md"
}
```

- Only **main-window** clients receive it. Detached terminal windows are connected to the same socket but are ignored, so `delivered_clients` reflects clients that can actually present the viewer.
- Desktop clients create or focus `preview-file-<paneId>` and navigate it to the new file. Re-opening from the same pane never creates a second window.
- Web / mobile clients open the full-screen overlay. Every connected main client receives the message, which is acceptable multi-client behavior in v1.
- `delivered_clients > 0` only means the message was queued to at least one client — it does **not** confirm that the window rendered or the file was read. There is no ACK in v1.
- `delivered_clients == 0` produces `NO_UI_CLIENT`, so the API never reports success when nobody can show the file.

---

## Examples

### Open a Markdown file over HTTP

```bash
curl -s -X POST "$DINOTTY_URL/api/sessions/$DINOTTY_PANE_ID/viewer" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"path":"README.md"}'
```

### Navigate the same window to another file

```bash
curl -s -X POST "$DINOTTY_URL/api/sessions/$DINOTTY_PANE_ID/viewer" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"path":"docs/logo.png"}'
```

The desktop window opened by the first call is focused and navigated to the image instead of a second window appearing.

### Call the MCP tool

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "file_viewer_open",
    "arguments": { "pane_id": "pane-123", "path": "docs/design.md" }
  }
}
```

### Environment variables available to agents

| Variable | Purpose |
|----------|---------|
| `DINOTTY_PANE_ID` | The pane whose workspace root confines the path |
| `DINOTTY_URL` | HTTP base of the current service (`http://127.0.0.1:<port>`) |

The HTTP endpoint needs a Bearer token. Agents should normally use the MCP tool, because Dinotty already manages its credentials.

---

## Relationship to Open API

| | Open API | Standalone File Viewer |
|--|----------|------------------------|
| Purpose | Read/write terminal sessions | Present a file in the UI |
| Gated by `open_api.enabled` | Yes | **No** |
| Agent token capability | `terminal:read` / `terminal:write` | `workspace:read` |
| Example | `POST /api/sessions/:pane_id/run` | `POST /api/sessions/:pane_id/viewer` |

The viewer is a UI presentation action, not terminal I/O, so it is always enabled, like `/api/tabs/*`. This matters in dispatch mode, where Open API is turned off but agents still need to show files to the user.

---

## Limitations

- **SSH panes** return `SSH_UNSUPPORTED` in v1.
- **Workspace confinement is mandatory**: paths outside the pane's workspace root are rejected, even with the global token.
- **Read-only**: no editing, saving, directory tree, or editor tabs.
- **One file at a time**: each pane owns one viewer window; opening a new file navigates the existing window.
- **No ACK**: a successful response means delivery to a UI client, not that rendering finished.
- **No restore**: viewer windows are not restored across application restarts and do not participate in preview-window docking.

## See Also

- [MCP Server](./mcp-server.md) — tool list and capability mapping
- [Open API](./open-api.md) — terminal read/write endpoints
- [Tabs & Panes API](./tabs-panes-api.md) — creating and splitting panes
- [Token Permission System](/en/internals/token-system) — capability and scope model
