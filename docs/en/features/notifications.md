# Notification System

Dinotty has a built-in notification system that auto-detects terminal notification escape sequences (OSC 9 / OSC 777 / BEL) in pane output, plus custom notification push for AI agent and automation tool integration.

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

## Terminal Notification Auto-Detection (Zero Config)

Dinotty parses each terminal pane's output stream on the backend and converts terminal notification escape sequences emitted by programs into notifications - **no hooks or extra configuration required**:

| Sequence | Format | Origin | Effect |
|----------|--------|--------|--------|
| `OSC 9` | `ESC ] 9 ; <message> BEL`/`ST` | iTerm2 / Windows Terminal / WezTerm notification protocol | info notification with the message as body |
| `OSC 777` | `ESC ] 777 ; notifysend ; <title> ; <body> BEL` | ConEmu / urxvt / Ghostty notification protocol | info notification with title |
| `BEL` | `\a` | all terminals; agent fallback path | bell notification |

Highlights:

- **Background tabs covered**: detection happens on the backend. Switch to another tab or workspace and notifications still arrive, with an unread badge on the source tab; each notification carries `pane_id` for click-to-jump
- **Zero-config agent integration**: Claude Code, Codex CLI, OpenCode and other agents emit these sequences natively on task completion or when waiting for input - notifications work out of the box (no hook needed)
- **Flood protection**: identical notifications are deduplicated within a window (default 2s); sustained `BEL` from binary output is rate-limited to at most one per pane per window
- **No false positives**: terminal-announce sequences such as `OSC 9;4` (taskbar progress) and `OSC 9;9` (cwd tracking) are ignored

Manual verification:

```bash
printf '\e]9;Task done\a'                    # OSC 9 notification
printf '\e]777;notifysend;Title;Body\a'      # OSC 777 notification
printf '\a'                                  # bell notification
```

> **Popup suppression rules**: no toast when the source pane is the focused pane with the app in the foreground, or when "Ignore current tab popup" is enabled (default on) and the source pane is in the current tab - by design, to avoid disturbing a user who is already looking at that pane. The notification still lands in the bell panel history. To observe a toast: `sleep 3; printf '\e]9;hello\a'` and switch to another tab within 3 seconds.

See `scripts/test-osc-notifications.sh` in the repository for a full interactive verification script.

Related settings:

- **Notification sequences** (settings panel, `notification.osc_notify`): master switch, on by default
- **Dedup window** (settings panel, `notification.osc_notify_debounce_ms`): dedup window in ms for identical notifications, default 2000

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

Recent versions of Claude Code emit OSC 9 notification sequences natively on task completion and when waiting for input; Dinotty detects them automatically, **so notifications work without any configuration**. Use hooks if you need custom notification types, wording, or trigger points:

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
