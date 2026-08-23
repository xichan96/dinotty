# Audit Log & Webhook

Dinotty provides an audit log and webhook mechanism for tracking API usage and sending external notifications.

## Table of Contents

- [Audit Log](#audit-log)
  - [Overview](#overview)
  - [Log Format](#log-format)
  - [Recorded Actions](#recorded-actions)
  - [Log Location](#log-location)
- [Webhook](#webhook-1)
  - [Overview](#overview-1)
  - [Configuration](#configuration)
  - [Request Format](#request-format)
  - [Signature Verification](#signature-verification)
  - [Event Filtering](#event-filtering)

---

## Audit Log

### Overview

The audit log records all Agent API calls for security auditing and troubleshooting.

### Log Format

JSONL format (one JSON object per line):

```json
{
  "ts": "2026-06-25T10:30:00Z",
  "token_id": "agent",
  "action": "terminal:execute",
  "resource": "pane-abc123",
  "details": {
    "command": "ls -la",
    "exit_code": 0,
    "duration": 150
  },
  "audit_id": "uuid-xxx"
}
```

### Fields

| Field | Type | Description |
|-------|------|-------------|
| `ts` | string | ISO 8601 timestamp |
| `token_id` | string | Caller identity ("agent" or token ID) |
| `action` | string | Action type |
| `resource` | string | Action target (pane_id, etc.) |
| `details` | object | Action details (command, result, etc.) |
| `audit_id` | string | Unique audit ID |

### Recorded Actions

| Action | Description |
|--------|-------------|
| `agent:terminal:execute` | Agent API executes a command |
| `agent:terminal:send` | Agent API sends input |

### Log Location

The audit log lives under the platform config directory:

| Platform | Log Path |
|----------|----------|
| Linux | `~/.config/dinotty/audit.log` |
| macOS | `~/Library/Application Support/dinotty/audit.log` |
| Windows | `%APPDATA%\dinotty\audit.log` |

### Usage Examples

```bash
# Show the most recent command executions
tail -20 ~/.config/dinotty/audit.log | jq .

# Count calls per token
cat ~/.config/dinotty/audit.log | jq -r '.token_id' | sort | uniq -c

# Find failed commands
cat ~/.config/dinotty/audit.log | jq 'select(.details.exit_code != 0)'
```

Windows PowerShell example:

```powershell
$log = Join-Path $env:APPDATA "dinotty\audit.log"
Get-Content $log -Tail 20 | ConvertFrom-Json
Get-Content $log | ConvertFrom-Json | Group-Object token_id
Get-Content $log | ConvertFrom-Json | Where-Object { $_.details.exit_code -ne 0 }
```

---

## Webhook

### Overview

Webhooks let Dinotty send HTTP POST notifications to external services when events occur.

### Configuration

Webhooks are configured in `settings.json` under the platform config directory (`~/.config/dinotty/settings.json` on Linux, `~/Library/Application Support/dinotty/settings.json` on macOS, `%APPDATA%\dinotty\settings.json` on Windows):

```json
{
  "webhooks": [
    {
      "url": "https://hooks.slack.com/services/xxx",
      "events": ["command_finished", "session_created"],
      "secret_ref": "slack-signing-secret",
      "enabled": true
    }
  ]
}
```

### Config Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `url` | string | Yes | Target URL |
| `events` | string[] | Yes | Events to listen for (`"*"` matches all) |
| `secret_ref` | string | No | Signing secret reference (see below) |
| `enabled` | bool | No | Whether enabled (default true) |

### Secret Management

Secrets are stored in `secrets.json` under the platform config directory (`~/.config/dinotty/secrets.json` on Linux, `~/Library/Application Support/dinotty/secrets.json` on macOS, `%APPDATA%\dinotty\secrets.json` on Windows). On Unix the recommended permission is 0600:

```json
{
  "slack-signing-secret": "your-secret-here",
  "github-webhook-secret": "another-secret"
}
```

Reference a secret by name through the `secret_ref` field.

### Request Format

```http
POST /your-webhook-url HTTP/1.1
Content-Type: application/json
User-Agent: dinotty-webhook/1.0
X-Dinotty-Signature: sha256=<hex-signature>

{
  "event": "command_finished",
  "timestamp": "2026-06-25T10:30:00Z",
  "data": {
    "pane_id": "pane-abc123",
    "command": "",
    "exit_code": 0,
    "duration_ms": 150,
    "stdout": "",
    "method": "shell_integration"
  }
}
```

### Signature Verification

If `secret_ref` is configured, requests include the `X-Dinotty-Signature` header:

```
X-Dinotty-Signature: sha256=<64-char hex HMAC-SHA256>
```

Verification example:

```python
import hmac
import hashlib

def verify_signature(payload: bytes, signature: str, secret: str) -> bool:
    expected = hmac.new(
        secret.encode(),
        payload,
        hashlib.sha256
    ).hexdigest()
    return hmac.compare_digest(f"sha256={expected}", signature)
```

### Event Filtering

The `events` array supports:

- Specific event names: `"command_finished"`, `"session_created"`, etc.
- Wildcard: `"*"` matches all events

### Available Events

| Event | Description |
|-------|-------------|
| `command_finished` | A command finished executing |
| `session_created` | A terminal session was created |
| `session_closed` | A terminal session was closed |
| `tab_created` | A tab was created |
| `tab_closed` | A tab was closed |
| `file_changed` | A file changed |
| `custom` | Custom event |

### Error Handling

- Webhooks are fire-and-forget
- HTTP errors are logged to the server log without affecting the main flow
- There is no retry mechanism (implement idempotent handling on the receiver side)

### Use Cases

- **Slack/Lark notifications**: notify the team when commands finish
- **CI/CD integration**: terminal output triggers build pipelines
- **Monitoring & alerting**: abnormal exit codes trigger alerts
- **Log shipping**: forward events to ELK/Datadog
