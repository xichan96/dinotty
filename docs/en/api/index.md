# API Overview

Dinotty's external interfaces fall into three layers. This page helps you find the right API quickly.

## Layers

| Layer | Channel | Use case | Doc |
|-------|---------|----------|-----|
| **Tabs & Panes API** | HTTP REST | Create / close / rename tabs, split panes, move panes across tabs | [tabs-panes-api.md](./tabs-panes-api.md) |
| **Open API** | HTTP + WebSocket | Read and write existing terminals: byte streams (screen/scrollback/input/resize) + command-level semantics (run/send/read) + event subscription | [open-api.md](./open-api.md) |
| **Mission Control API** | WebSocket (`/ws/sync`) | Programmatically open / navigate / close the MC overview | [mission-control-api.md](./mission-control-api.md) |

Plus two standalone subsystem docs:

- [Clipboard API](./clipboard-api.md) - read the host's clipboard
- [MCP Server](./mcp-server.md) - Model Context Protocol server

## Find by scenario

### I want to...

- **Start a terminal tab from outside** -> [POST /api/tabs](./tabs-panes-api.md#post-apitabs)
- **Connect to SSH and auto-open a tab** -> [POST /api/tabs/ssh/quick](./tabs-panes-api.md#post-apitabssshquick)
- **Split an existing terminal** -> [POST /api/tabs/:tab_id/pane](./tabs-panes-api.md#post-apitabstab_idpane)
- **Pull a pane into its own tab** -> [POST /api/tabs/extract](./tabs-panes-api.md#post-apitabsextract)
- **Capture the current terminal screen** -> [GET /api/sessions/:pane_id/screen](./open-api.md#get-apisessionspane_idscreen)
- **Inject characters into a terminal** -> [POST /api/sessions/:pane_id/input](./open-api.md#post-apisessionspane_idinput)
- **Run a command and get the exit code** -> [POST /api/sessions/:pane_id/run](./open-api.md#post-apisessionspane_idrun)
- **Subscribe to command-finished events** -> [WS /ws/events](./open-api.md#websocket)
- **Open Mission Control remotely** -> [mission_control_op / toggle](./mission-control-api.md#toggle)
- **Jump to a specific workspace from MC** -> [mission_control_op / jump](./mission-control-api.md#jump)
- **Read the host clipboard** -> [GET /api/clipboard](./clipboard-api.md)
- **Plug into Claude / LLM MCP clients** -> [MCP Server](./mcp-server.md)

## Auth model

Dinotty's auth has two layers. Open API's `run`/`send`/`read`/`WS /ws/events` accept both credentials (dual-track auth):

```
┌─────────────────────────────────────────────────────────────────┐
│  Global Token / Session Cookie                                  │
│  - Master token configured at startup, or the cookie obtained   │
│    via POST /api/auth                                           │
│  - Covers: Tabs API, Open API (all endpoints), Clipboard,       │
│    Settings, Plugins - all /api/* endpoints                     │
└─────────────────────────────────────────────────────────────────┘
         │
         │  /api/sessions/{run,send,read} + /ws/events also accept
         ▼
┌─────────────────────────────────────────────────────────────────┐
│  Agent Token (dnt_*)                                            │
│  - Fine-grained token created via /api/tokens                   │
│  - Carries capabilities: terminal:read / terminal:write / etc.  │
│  - Covers: /api/sessions/{run,send,read}, /ws/events,           │
│    /api/tokens/*, /mcp/*                                        │
└─────────────────────────────────────────────────────────────────┘
```

Mission Control flows through `/ws/sync` and uses the global token (query string `?token=<token>`) or the session cookie.

## Enable conditions

| API | Enable condition |
|-----|------------------|
| Tabs & Panes API | Always enabled (auth only) |
| Open API | Requires `open_api.enabled = true` in settings; `run`/`send`/`read` also accept Agent Token (capability check) |
| Mission Control API | Always enabled (over `/ws/sync`) |
| Clipboard | Always enabled; requires token or session + same-origin proof |
| MCP Server | Requires `open_api.enabled = true` and an Agent Token |

## Internals

For the "non-API" design layer - event system, permission model, audit logs (docs are Chinese-only):

- [Event Bus](/zh/internals/event-bus) - internal event bus
- [Token Permission System](/zh/internals/token-system) - Agent Token capability model
- [Audit & Webhook](/zh/internals/audit-webhook) - operation audit log and external webhook delivery
