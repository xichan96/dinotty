# Notification System

Dinotty has a built-in notification system supporting terminal bell detection and custom notification push, designed for AI agent and automation tool integration.

## User Side

### Notification Panel

When a notification arrives, a toast pops up in the bottom right; the notification panel (sidebar bell icon) accumulates history:

- **Toast**: auto-dismisses after 5s; has a "Jump" button
- **Notification panel**: lists notifications in reverse chronological order, unread highlighted
- **Unread count**: badge on the bell icon
- **Clear**: "Mark all read" button at the top of the panel

### Notification Types

| Type | Use | Visual |
|------|-----|--------|
| `info` | General info | Gray |
| `success` | Task succeeded | Green |
| `warning` | Needs attention | Yellow |
| `error` | Error | Red |
| `urgent` | Urgent (agent waiting for input) | Red, emphasized |

### Click to Jump

Each notification card shows a `workspace › tab / pane` label for easy source identification:

- **Click a card in the panel**: auto-switch workspace -> open the tab -> focus the pane
- **Click "Jump" on a toast**: same full jump chain

Jump requires the sender to include `pane_id` when calling the HTTP API (see below).

## HTTP API

Send notifications via `POST /api/notify`:

```bash
curl -s -X POST ${DINOTTY_URL}/api/notify \
  -H "Content-Type: application/json" \
  -d '{"body": "Task completed", "title": "My Agent", "notification_type": "info"}'
```

Request body fields:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `body` | string | ✅ | Notification body |
| `title` | string | ❌ | Notification title |
| `pane_id` | string | ❌ | Associated pane ID (enables click-to-jump) |
| `notification_type` | string | ❌ | Type: `info` (default) / `success` / `warning` / `error` / `urgent` |

Include `pane_id` to enable click-to-jump (see [User Side -> Click to Jump](#click-to-jump) above).

## Environment Variables

Dinotty automatically injects the following environment variables when creating each terminal:

| Variable | Description |
|----------|-------------|
| `DINOTTY_PANE_ID` | Unique ID of the current pane (leaf pane) |
| `DINOTTY_TAB_ID` | Tab ID of the current pane |
| `DINOTTY_URL` | the notify base URL of the dinotty surface that owns this pane (`http://127.0.0.1:<port>`) — use it instead of a hardcoded port. |

Environment variables are **process-level isolated** — each pane is set independently and will not overwrite others.

Send notifications with these IDs for precise jump targeting:

```bash
curl -X POST ${DINOTTY_URL}/api/notify \
  -H "Content-Type: application/json" \
  -d "{
    \"pane_id\": \"$DINOTTY_PANE_ID\",
    \"title\": \"Task Complete\",
    \"body\": \"Build finished\",
    \"notification_type\": \"success\"
  }"
```

## Claude Code Integration

When running Claude Code in a dinotty terminal, you can use hooks to automatically send notifications at key moments:

```jsonc
// .claude/settings.json
{
  "hooks": {
    "Notification": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "curl -s -X POST ${DINOTTY_URL}/api/notify -H 'Content-Type: application/json' -d '{\"body\":\"Claude needs your input\",\"title\":\"Claude Code\",\"notification_type\":\"warning\",\"pane_id\":\"'\"$DINOTTY_PANE_ID\"'\"}'"
          }
        ]
      }
    ],
    "Stop": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "curl -s -X POST ${DINOTTY_URL}/api/notify -H 'Content-Type: application/json' -d '{\"body\":\"Task completed\",\"title\":\"Claude Code\",\"notification_type\":\"success\",\"pane_id\":\"'\"$DINOTTY_PANE_ID\"'\"}'"
          }
        ]
      }
    ]
  }
}
```

| Hook | Purpose |
|------|---------|
| `Notification` | Alert when Claude needs user input or permission confirmation |
| `Stop` | Alert when a task completes |

Other AI agents and automation scripts can also call the HTTP API to send notifications without additional configuration.

> **Tip**: Use `$DINOTTY_PANE_ID` and `$DINOTTY_TAB_ID` environment variables directly in hook commands to ensure notifications can jump to the correct pane.

## Notification Command Hooks

You can configure shell commands in Settings that execute automatically when notification events fire. Useful for triggering system-level alerts (e.g., macOS `osascript`, Linux `notify-send`, Windows PowerShell sounds or toasts, etc.).

Hooks run on the **server platform**:

| Platform | Execution method |
|----------|------------------|
| Linux / macOS | `sh -c <command>` |
| Windows | `pwsh.exe -NoProfile -Command <command>` first, then `powershell.exe`, then `cmd.exe /C` |

Examples:

```bash
# Linux
notify-send "Dinotty" "$DINOTTY_TITLE: $DINOTTY_BODY"

# macOS
osascript -e 'display notification "'$DINOTTY_BODY'" with title "Dinotty"'
```

```powershell
# Windows PowerShell
[System.Media.SystemSounds]::Asterisk.Play()
```

Hooks receive the following environment variables:

| Variable | Description |
|----------|-------------|
| `DINOTTY_NOTIFICATION_TYPE` | Notification type |
| `DINOTTY_PANE_ID` | Pane ID that triggered the notification |
| `DINOTTY_TITLE` | Notification title |
| `DINOTTY_BODY` | Notification body |

## Open API (External Device Control)

The `POST /api/input` endpoint allows external devices (Stream Deck, iOS Shortcuts, automation scripts, etc.) to send input to the terminal for remote control.

Open API must be enabled in Settings.

```bash
# Send input to the active pane
curl -X POST http://127.0.0.1:8999/api/input \
  -H "Content-Type: application/json" \
  -d '{"data": "ls -la\n"}'

# Send input to a specific pane
curl -X POST http://127.0.0.1:8999/api/input \
  -H "Content-Type: application/json" \
  -d '{"data": "echo hello\n", "pane_id": "pane-1"}'
```
