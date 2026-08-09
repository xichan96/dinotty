# Tabs & Panes API

Create, close, rename terminal tabs; split panes; move panes across tabs; or extract a pane into its own tab — all via HTTP REST. Covers every pane type: local PTY, SSH, plugin, files, and web preview.

## Table of Contents

- [Overview](#overview)
- [Authentication](#authentication)
- [Tab Model](#tab-model)
- [Endpoints](#endpoints)
  - [GET /api/tabs](#get-apitabs)
  - [POST /api/tabs](#post-apitabs)
  - [POST /api/tabs/ssh/quick](#post-apitabssshquick)
  - [POST /api/tabs/ssh](#post-apitabsssh)
  - [POST /api/tabs/plugin](#post-apitabsplugin)
  - [DELETE /api/tabs/:tab_id](#delete-apitabstab_id)
  - [POST /api/tabs/:tab_id/rename](#post-apitabstab_idrename)
  - [POST /api/tabs/:tab_id/pane](#post-apitabstab_idpane)
  - [POST /api/tabs/:tab_id/pane/plugin](#post-apitabstab_idpaneplugin)
  - [POST /api/tabs/:tab_id/pane/files](#post-apitabstab_idpanefiles)
  - [POST /api/tabs/:tab_id/pane/web](#post-apitabstab_idpaneweb)
  - [POST /api/tabs/:tab_id/pane/move](#post-apitabstab_idpanemove)
  - [POST /api/tabs/extract](#post-apitabsextract)
  - [DELETE /api/tabs/:tab_id/pane/:pane_id](#delete-apitabstab_idpanepane_id)
  - [PUT /api/tabs/:tab_id/pane/:pane_id/activate](#put-apitabstab_idpanepane_idactivate)
  - [PUT /api/tabs/:tab_id/layout](#put-apitabstab_idlayout)
- [Error Format](#error-format)
- [Typical Scenarios](#typical-scenarios)

---

## Overview

| Operation | Endpoint | Description |
|-----------|----------|-------------|
| List tabs | `GET /api/tabs` | All tab layouts + current active pane |
| Create terminal tab | `POST /api/tabs` | Spawn local PTY as a new tab |
| Create SSH tab | `POST /api/tabs/ssh/quick` / `POST /api/tabs/ssh` | SSH session tab via params or saved profile |
| Create plugin tab | `POST /api/tabs/plugin` | No PTY; tab renders a single plugin |
| Close tab | `DELETE /api/tabs/:tab_id` | Close all panes inside the tab |
| Rename tab | `POST /api/tabs/:tab_id/rename` | Change tab title |
| Split pane | `POST /api/tabs/:tab_id/pane` | Create a new pane next to an existing one |
| Create non-terminal pane | `POST /api/tabs/:tab_id/pane/{plugin,files,web}` | Insert plugin / files / web pane |
| Cross-tab move | `POST /api/tabs/:tab_id/pane/move` | Whole-tab merge or single-pane move |
| Extract to new tab | `POST /api/tabs/extract` | Pull a pane out into its own tab |
| Close pane | `DELETE /api/tabs/:tab_id/pane/:pane_id` | Remove a single pane |
| Activate pane | `PUT /api/tabs/:tab_id/pane/:pane_id/activate` | Switch active pane |
| Update layout | `PUT /api/tabs/:tab_id/layout` | Replace the tab's layout tree |

Every write operation also broadcasts `TabCreated` / `TabClosed` / `LayoutUpdated` / `TabActivated` / `TabRenamed` over `/ws/sync` so all connected clients stay in sync.

---

## Authentication

All `/api/tabs/*` endpoints are protected by the global auth middleware. Requests must carry one of:

- **Session Cookie**: obtained via `POST /api/auth` (cookie name like `dinotty_session_<port>`). Used automatically by browsers in same-origin contexts.
- **Bearer Token**: `Authorization: Bearer <global-token>`, where the token is the master token configured at server startup.

```bash
curl -H "Authorization: Bearer <token>" \
     http://localhost:8999/api/tabs
```

`/api/tabs/*` does not require `open_api.enabled`. For fine-grained agent tokens over terminal I/O, use the [Open API](./open-api.md) `run`/`send`/`read` endpoints.

---

## Tab Model

Each tab holds a layout tree whose leaf nodes (`type: "leaf"`) are panes. Layout nodes are JSON:

```json
{
  "type": "leaf",
  "paneId": "pane-uuid",
  "title": "Terminal",
  "shell_type": "zsh",
  "ratio": 1,
  "zoomed": false
}
```

Non-terminal panes carry an extra `kind` field on the leaf:

| `kind` | Extra fields | Description |
|--------|--------------|-------------|
| `plugin` | `pluginId` | Renders a plugin |
| `files` | `path`, `sourcePaneId` | File browser rooted at `path` |
| `web` | `url`, `sourcePaneId` | iframe web preview |
| (omitted) | - | Terminal pane backed by a PTY |

Split layouts wrap children in `type: "split"` nodes (see the [unified layout system design](https://github.com/xichan96/dinotty/blob/dev/.claude/doc/layout-system-unification-design.md)). The API does not require callers to understand split nodes — `split_pane` / `create_*_pane` generate the new layout tree server-side; callers only pass `direction` and the target `pane_id`.

---

## Endpoints

### GET /api/tabs

List all tabs and the current active pane.

**Response (200):**

```json
{
  "tabs": [
    {
      "tab_id": "tab-aaa",
      "layout": { "type": "leaf", "paneId": "pane-1", "title": "Terminal", "shell_type": "zsh", "ratio": 1, "zoomed": false },
      "active_pane_id": "pane-1"
    }
  ],
  "active_pane_id": "pane-1"
}
```

---

### POST /api/tabs

Create a local terminal tab and spawn a new PTY.

**Request body:**

```json
{
  "cwd": "/Users/dev/project",
  "argv": ["npm", "run", "dev"],
  "title": "dev server"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `cwd` | string | no | Working directory; must exist. Falls back to the default workspace root from settings |
| `argv` | string[] | no | Launch `argv[0]` directly (bypasses shell). When non-empty, shell preferences are ignored |
| `title` | string | no | Tab title; defaults to `"Terminal"` |

**Success response (200):**

```json
{
  "tab_id": "tab-aaa",
  "pane_id": "pane-1",
  "layout": { "type": "leaf", "paneId": "pane-1", "title": "dev server", "shell_type": "zsh", "ratio": 1, "zoomed": false },
  "cwd": "/Users/dev/project"
}
```

**Errors:**

| Status | Trigger |
|--------|---------|
| 400 | `cwd` does not exist or isn't a directory; `argv` is empty or `argv[0]` is empty |
| 409 | Shell resolution failed (e.g. WSL listed but unavailable) |
| 503 | WSL timeout / WSL list failed |
| 500 | PTY creation failed, or session exited before the tab was published |

---

### POST /api/tabs/ssh/quick

Create an SSH tab from inline parameters, without a saved profile.

**Request body:**

```json
{
  "host": "192.168.1.10",
  "port": 22,
  "username": "dev",
  "auth_method": "password",
  "password": "secret",
  "profile_id": "ad-hoc",
  "workspace_id": null,
  "initial_cwd": "/srv/app"
}
```

Fields follow `SshConnectRequest` (see `src/ssh/mod.rs`). `auth_method` accepts `password` / `publickey` / `keyboard-interactive`. `keyboard-interactive` triggers the `SshAuthResponse` flow (handled over `/ws/sync`).

**Success response (200):**

```json
{
  "tab_id": "tab-bbb",
  "pane_id": "pane-2",
  "layout": { "type": "leaf", "paneId": "pane-2", "title": "dev@192.168.1.10", "shell_type": "ssh", "ratio": 1, "zoomed": false },
  "connection_id": "ad-hoc"
}
```

---

### POST /api/tabs/ssh

Create a tab from an SSH profile saved in settings.

**Request body:**

```json
{
  "profile_id": "profile-uuid",
  "workspace_id": "ws-xxx",
  "initial_cwd": "/srv/app"
}
```

`profile_id` must exist in settings' `ssh_profiles`, otherwise 404. `workspace_id` / `initial_cwd` are optional.

**Success response (200):** Same as `ssh/quick`, but `connection_id` equals `profile_id` and the response includes `workspace_id`.

---

### POST /api/tabs/plugin

Create a PTY-less tab whose root layout is a single plugin leaf.

**Request body:**

```json
{
  "plugin_id": "my-plugin",
  "title": "My Plugin",
  "tab_id": "custom-tab-id"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `plugin_id` | string | yes | Installed plugin ID |
| `title` | string | no | Tab title; defaults to `plugin_id` |
| `tab_id` | string | no | Custom tab ID; a UUID is generated if omitted. Convention: plugin tabs use the same value for `tab_id` and `pane_id` |

**Success response (200):**

```json
{
  "tab_id": "custom-tab-id",
  "pane_id": "custom-tab-id",
  "layout": { "type": "leaf", "kind": "plugin", "paneId": "custom-tab-id", "title": "My Plugin", "ratio": 1, "zoomed": false, "pluginId": "my-plugin" }
}
```

---

### DELETE /api/tabs/:tab_id

Close the whole tab and kill every PTY session inside.

**Response (200):**

```json
{ "ok": true }
```

Returns 200 whether or not the tab existed. Broadcasts `TabClosed` after deletion.

---

### POST /api/tabs/:tab_id/rename

Change the tab title.

**Request body:**

```json
{ "title": "new name" }
```

**Response:**

- 200 `{"ok": true}` — success
- 400 — `title` is empty
- 404 — tab not found

Broadcasts `TabRenamed` on success.

---

### POST /api/tabs/:tab_id/pane

Split an existing pane to create a new terminal pane. The new pane inherits the source pane's environment:

- Source is SSH → new pane opens a fresh SSH connection to the same host (unless `force_local`)
- Source is local PTY → new pane inherits the source's current working directory

**Request body:**

```json
{
  "pane_id": "pane-1",
  "direction": "vertical",
  "force_local": false,
  "cwd": "/tmp"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `pane_id` | string | yes | Source pane ID; must be a leaf in the current tab |
| `direction` | string | yes | `"horizontal"` or `"vertical"` |
| `force_local` | bool | no | Force a local PTY instead of inheriting SSH; pair with `cwd` |
| `cwd` | string | no | Only used with `force_local=true`; falls back to the source pane's CWD |

**Success response (200):**

```json
{
  "new_pane_id": "pane-2",
  "layout": { /* full updated layout tree */ }
}
```

---

### POST /api/tabs/:tab_id/pane/plugin

Insert a plugin pane (no PTY) next to an existing pane.

**Request body:**

```json
{
  "plugin_id": "my-plugin",
  "target_pane_id": "pane-1",
  "direction": "horizontal"
}
```

**Success response (200):**

```json
{
  "new_pane_id": "pane-3",
  "layout": { /* updated layout tree */ }
}
```

---

### POST /api/tabs/:tab_id/pane/files

Insert a file browser pane next to an existing pane.

**Request body:**

```json
{
  "path": "/Users/dev/project",
  "target_pane_id": "pane-1",
  "direction": "horizontal"
}
```

`path` must exist. The new leaf also records `sourcePaneId` so the frontend can wire interactions (e.g. reflecting files opened in the pane back to the source terminal's CWD).

---

### POST /api/tabs/:tab_id/pane/web

Insert a web preview pane next to an existing pane.

**Request body:**

```json
{
  "url": "http://localhost:3000",
  "target_pane_id": "pane-1",
  "direction": "horizontal"
}
```

`url` is loaded as an iframe `src`. For URLs that need server-side proxying, see the [web preview design](https://github.com/xichan96/dinotty/blob/dev/.claude/doc/web-preview-design.md).

---

### POST /api/tabs/:tab_id/pane/move

Move a pane or a whole tab into the destination tab. Two modes:

**Mode A (whole-tab merge)** — `source_pane_id` omitted: insert `source_tab_id`'s entire layout as a subtree next to `target_pane_id`; the source tab is deleted.

**Mode B (single-pane move)** — `source_pane_id` given: extract the specified pane and insert it into the destination tab. The source tab must have at least 2 panes.

**Request body:**

```json
{
  "source_tab_id": "tab-aaa",
  "source_pane_id": "pane-1",
  "target_pane_id": "pane-2",
  "direction": "horizontal"
}
```

**Success response (200):**

- Mode A: `{ "layout": <dst>, "active_pane_id": "...", "mode": "a" }`
- Mode B: `{ "source_layout": <src>, "layout": <dst>, "active_pane_id": "...", "mode": "b" }`

**Errors:**

| Status | Trigger |
|--------|---------|
| 400 | Source and destination are the same tab; Mode B with a single-pane source |
| 404 | Source / destination tab missing; `target_pane_id` / `source_pane_id` not in its layout |
| 500 | Layout insertion failed (usually indicates a corrupted layout tree) |

---

### POST /api/tabs/extract

Pull a pane out of its source tab and create a brand-new tab with that pane as the root layout. The PTY session is preserved (no respawn).

**Request body:**

```json
{
  "source_tab_id": "tab-aaa",
  "pane_id": "pane-1"
}
```

**Success response (200):**

```json
{
  "new_tab_id": "tab-ccc",
  "pane_id": "pane-1",
  "source_layout": { /* source tab's updated layout */ }
}
```

Source tab must have at least 2 panes, otherwise 400.

---

### DELETE /api/tabs/:tab_id/pane/:pane_id

Close a single pane. Terminal panes kill their PTY; non-terminal panes are simply removed from the layout. When the last pane in a tab is closed, the tab itself is also closed (`tab_closed: true` in the response).

**Response (200):**

```json
{ "ok": true, "tab_closed": false }
```

---

### PUT /api/tabs/:tab_id/pane/:pane_id/activate

Mark a pane as the active one. Only updates `active_pane_id`; layout structure is unchanged.

**Response (200):** `{"ok": true}`

Broadcasts `TabActivated` to other clients.

---

### PUT /api/tabs/:tab_id/layout

Replace the tab's entire layout tree. Typically called after the client rearranges panes via drag / resize.

**Request body:**

```json
{
  "layout": { /* full layout tree */ },
  "active_pane_id": "pane-1"
}
```

**Response (200):** `{"ok": true}`

The server does not deeply validate layout legality; the caller must ensure referenced `paneId`s exist in the tree.

---

## Error Format

Errors are JSON:

```json
{ "error": "tab not found" }
```

Or, for shell-resolution failures:

```json
{ "error": { "code": "wsl_timeout" } }
```

Common status codes:

| HTTP | Meaning |
|------|---------|
| 400 | Invalid params (empty title, illegal direction, cwd missing, etc.) |
| 401 | Unauthenticated |
| 404 | Tab / pane not found |
| 409 | Shell resolution conflict (e.g. WSL requested but unavailable) |
| 500 | PTY creation failed, layout update failed, session exited prematurely |
| 503 | WSL timeout / WSL list failed |

---

## Typical Scenarios

### Bootstrapping a dev environment

```bash
# 1. Create a tab running the dev server
curl -X POST -H "Authorization: Bearer $TOKEN" \
     http://localhost:8999/api/tabs \
     -d '{"cwd":"/Users/dev/app","argv":["npm","run","dev"],"title":"dev"}'

# 2. Create an SSH tab to production
curl -X POST -H "Authorization: Bearer $TOKEN" \
     http://localhost:8999/api/tabs/ssh/quick \
     -d '{"host":"10.0.0.5","port":22,"username":"ops","auth_method":"password","password":"..."}'
```

### Splitting a pane in an existing tab

```bash
# After you have tab_id and pane_id, split to the right
curl -X POST -H "Authorization: Bearer $TOKEN" \
     http://localhost:8999/api/tabs/$TAB_ID/pane \
     -d '{"pane_id":"pane-1","direction":"horizontal"}'
```

### Extracting a pane into its own tab

```bash
curl -X POST -H "Authorization: Bearer $TOKEN" \
     http://localhost:8999/api/tabs/extract \
     -d '{"source_tab_id":"tab-aaa","pane_id":"pane-3"}'
```

### Opening Mission Control programmatically

Mission Control has no dedicated HTTP endpoint. Send a `MissionControlOp` message over `/ws/sync` instead — see [Mission Control API](./mission-control-api.md).
