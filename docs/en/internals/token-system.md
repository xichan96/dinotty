# Token Permission System

Dinotty implements a capability-based multi-token permission system with fine-grained API access control.

## Table of Contents

- [Overview](#overview)
- [Token Types](#token-types)
- [Capability List](#capability-list)
- [Token Management API](#token-management-api)
- [Storage & Security](#storage-security)
- [Expiry & Cleanup](#expiry-cleanup)

---

## Overview

The permission system supports two token types:

| Type | Source | Permissions | Storage |
|------|--------|-------------|---------|
| Global Token | Server configuration | All permissions | In memory (`auth_token`) |
| Agent Token | Created via `/api/tokens` | Controlled per capability | `~/.config/dinotty/tokens.json` |

---

## Token Types

### Global Token

- Configured at server startup
- Holds all capabilities
- Used for administrative operations and initial setup
- Set via environment variable or config file

### Agent Token

- Created via the API, format: `dnt_<64 hex chars>`
- Can specify capabilities and scopes
- Supports expiry
- Displayed only once at creation; afterwards only the prefix is shown (e.g. `dnt_a1b2c3d4...`)

---

## Capability List

| Capability | Description | Typical Use |
|------------|-------------|-------------|
| `terminal:read` | Read terminal screen | Monitoring, log collection |
| `terminal:write` | Send commands to a terminal | Agents executing commands |
| `terminal:create` | Create new terminal sessions | Environment automation |
| `terminal:kill` | Terminate terminal sessions | Resource cleanup |
| `workspace:read` | Read workspace files | Code analysis |
| `workspace:write` | Write workspace files | Automated code changes |
| `workspace:execute` | Execute workspace operations | Build, test |
| `plugin:exec` | Execute plugins | Plugin automation |
| `settings:read` | Read settings | Config inspection |
| `settings:write` | Modify settings, manage tokens | System administration |

---

## Token Management API

### Create a Token

```bash
POST /api/tokens
Authorization: Bearer <global-token>

{
  "name": "ci-agent",
  "description": "CI/CD pipeline agent",
  "capabilities": ["terminal:read", "terminal:write", "workspace:read"],
  "scopes": {
    "terminal:write": ["pane-abc123"]
  },
  "expires_in": 86400
}
```

**Response (201):**

```json
{
  "token": "dnt_a1b2c3d4e5f6...",
  "token_info": {
    "id": "uuid-xxx",
    "name": "ci-agent",
    "token_prefix": "dnt_a1b2c3d4...",
    "capabilities": ["terminal:read", "terminal:write", "workspace:read"],
    "scopes": {"terminal:write": ["pane-abc123"]},
    "created_at": 1719312000,
    "expires_at": 1719398400,
    "description": "CI/CD pipeline agent"
  }
}
```

**Note:** the `token` field is returned only once at creation and cannot be retrieved later.

### List All Tokens

```bash
GET /api/tokens
Authorization: Bearer <global-token>
```

Returns info for all tokens (raw token values are not included).

### View Token Details

```bash
GET /api/tokens/:id
Authorization: Bearer <global-token>
```

### Update a Token

```bash
PUT /api/tokens/:id
Authorization: Bearer <global-token>

{
  "name": "updated-name",
  "capabilities": ["terminal:read"]
}
```

### Revoke a Token

```bash
DELETE /api/tokens/:id
Authorization: Bearer <global-token>
```

A revoked token becomes invalid immediately and is added to the revocation list (cleaned up after 24 hours).

---

## Storage & Security

### Storage Location

Token metadata is stored in `tokens.json` under the platform config directory:

| Platform | Token Metadata Path |
|----------|---------------------|
| Linux | `~/.config/dinotty/tokens.json` |
| macOS | `~/Library/Application Support/dinotty/tokens.json` |
| Windows | `%APPDATA%\dinotty\tokens.json` |

The revocation list lives in memory (DashMap) and is cleaned up periodically.

### Hashing

Tokens are stored as SHA-256 hashes; raw token values are never persisted:

```rust
fn hash_token(token: &str) -> String {
    // SHA-256 hash -> 64-char hex
}
```

### Verification Flow

1. Extract the token from `Authorization: Bearer <token>`
2. First check against the global token (constant-time comparison)
3. Compute the SHA-256 hash of the token
4. Look up the matching token record in DashMap
5. Check whether it has been revoked or expired
6. Return TokenInfo (including capability and scope)

### Scope Restrictions

Scopes restrict which resources a capability applies to. Each entry in `scopes` maps to one capability, whose value lists the allowed resources; a capability without a scope entry is unrestricted.

**Terminal scope** (`terminal:read` / `terminal:write`): resource is a pane ID.

```json
{
  "capabilities": ["terminal:write"],
  "scopes": {
    "terminal:write": ["pane-abc123"]
  }
}
```

This token can only write to `pane-abc123`. Both the Agent API (`run` / `send` / `read`) and MCP terminal tools enforce this: once the actual pane is resolved from the request, out-of-scope access returns `403 SCOPE_DENIED` (Agent API) or an error (MCP). `terminal_list` filters out panes outside the scope without leaking their existence.

**Workspace scope** (`workspace:read` / `workspace:write`): resource is a directory path (`~/` prefix supported), matched by directory prefix -- the target path must lie within one of the scoped directories (the directory itself included):

```json
{
  "capabilities": ["workspace:read", "workspace:write"],
  "scopes": {
    "workspace:read": ["~/projects/foo"],
    "workspace:write": ["~/projects/foo"]
  }
}
```

This token can only read/write files under `~/projects/foo` and its subdirectories (MCP `file_read` / `file_write` / `file_list` / `git_diff`). Note that `git_status` operates on the service process's working directory and takes no path argument, so it is only checked for capability and is not restricted by the workspace scope.

---

## Expiry & Cleanup

### Expiry

- `expires_in` (seconds) can be set at creation
- Expired tokens become invalid automatically
- The `expires_at` field is checked during verification

### Cleanup Task

Runs hourly:

1. Removes expired token records
2. Cleans up revocation records older than 24 hours

```rust
pub fn start_cleanup_task(self: &Arc<Self>) {
    // runs every 3600 seconds
    // 1. remove tokens where expires_at < now
    // 2. remove revocations older than 24h
}
```
