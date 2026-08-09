# Mission Control API

Mission Control (MC) is Dinotty's multi-device overview mode: an overlay grid of workspaces and tabs that the user can navigate with arrow keys, confirm with Enter, or dismiss with Esc. This page documents how external programs (automation scripts, mobile hardware keyboards, desktop remote controls) drive MC.

## Table of Contents

- [Design Notes](#design-notes)
- [Channel & Authentication](#channel--authentication)
- [Client Messages](#client-messages)
  - [Toggle](#toggle)
  - [Navigate](#navigate)
  - [Jump](#jump)
  - [Confirm](#confirm)
  - [Cancel](#cancel)
  - [Input (safety net while MC is open)](#input-safety-net-while-mc-is-open)
- [Server Messages](#server-messages)
  - [MissionControlToggled](#missioncontroltoggled)
  - [SelectionChanged](#selectionchanged)
  - [McSnapshot](#mcsnapshot)
- [Typical Flows](#typical-flows)

---

## Design Notes

**MC has no dedicated HTTP endpoint.** All control flows through the `/ws/sync` WebSocket via `mission_control_op` messages. Reasons:

- MC is a stateful real-time control (open / closed / current selection); HTTP's request-response model is a poor fit
- MC operations must fan out to every connected client (phone, desktop, web); the sync WS's event broadcast does this naturally
- Sharing the sync WS avoids spinning up a second connection just to flip a boolean

If you just want to "open the MC overview" externally, send a single `Toggle` message (see below).

---

## Channel & Authentication

- **WebSocket**: `ws://localhost:8999/ws/sync`
- **Authentication**: same as all `/api/*` endpoints. Pass the token via query string:

  ```
  ws://localhost:8999/ws/sync?token=<global-token>
  ```

  Or rely on the session cookie in browser contexts (no token needed for same-origin).

- **Wire format**: JSON text frames, discriminated by a `type` field.

After the connection is established, the server sends an initial `McSnapshot` before accepting client messages.

---

## Client Messages

All MC control messages use `type: "mission_control_op"`; the `op` field discriminates the specific operation.

### Toggle

Open or close MC. Sending Toggle again flips to the opposite state.

```json
{
  "type": "mission_control_op",
  "op": { "kind": "toggle" }
}
```

**Server behavior:**

- On open: derives `selected_tab_id` from the current `active_pane_id` so the highlight lands on the tab the user is already in. `selected_workspace_id` retains its previous value (or `null` = default workspace `__default__` on first open).
- On close: preserves `selected_*` so the next open returns to the same position.

The server broadcasts `MissionControlToggled` to all clients (including the sender).

---

### Navigate

Move the highlighted card inside MC. No-op when MC is closed.

```json
{
  "type": "mission_control_op",
  "op": { "kind": "navigate", "dir": "right" }
}
```

`dir` values:

| `dir` | Behavior |
|-------|----------|
| `up` / `down` | Move vertically through the workspace list (workspaces stack on the left of MC) |
| `left` / `right` | Move horizontally through the tab grid of the current workspace |

Crossing workspace boundaries (up/down) clears `selected_tab_id` since the old tab belongs to the previous workspace. `left` / `right` cycle within the current workspace's tabs only, matching the frontend's `filteredCards` filter.

The server broadcasts `SelectionChanged`.

---

### Jump

Jump directly to a workspace, skipping incremental Navigate. Used for mouse-driven workspace selection in the overview.

```json
{
  "type": "mission_control_op",
  "op": { "kind": "jump", "workspace_id": "ws-xxx" }
}
```

`workspace_id`:

- String = an existing workspace ID
- `null` = default workspace `__default__`

Only effective when MC is open. Jump always clears `selected_tab_id` so the highlight lands on the target workspace's first card.

The server broadcasts `SelectionChanged`.

---

### Confirm

Confirm the current selection: resolve `selected_tab_id` to its leaf pane, set it as the global `active_pane_id`, then close MC. Equivalent to pressing Enter in the overview.

```json
{
  "type": "mission_control_op",
  "op": { "kind": "confirm" }
}
```

**Server behavior:**

1. No-op if MC is closed
2. Sets the first leaf `paneId` of `selected_tab_id` as active (broadcasts `TabActivated`)
3. Closes MC (broadcasts `MissionControlToggled` with `open: false`)

If `selected_tab_id` is `null` or the tab no longer exists, MC still closes but no active-pane switch happens.

---

### Cancel

Close MC without changing the active pane. Equivalent to pressing Esc.

```json
{
  "type": "mission_control_op",
  "op": { "kind": "cancel" }
}
```

Only effective when MC is open. Broadcasts `MissionControlToggled` with `open: false`.

---

### Input (safety net while MC is open)

Hardware-keyboard clients have no dedicated `/ws/<paneId>` terminal channel; they send keystrokes via the sync WS `Input` message, and the server forwards them to the active pane's PTY.

```json
{ "type": "input", "data": "ls -la\r" }
```

**Safety net**: when MC is open, the server **drops** all `Input` messages to prevent keystrokes leaking into the PTY while the user is navigating the overview. Once MC closes, forwarding resumes.

External programs that need to send terminal input while MC is open must either explicitly verify MC is closed first, or use the [Open API](./open-api.md) (`POST /api/sessions/:pane_id/send` / `POST /api/sessions/:pane_id/input`) - those endpoints are not gated by the MC safety net.

---

## Server Messages

### MissionControlToggled

Broadcast when MC opens or closes; carries the full snapshot. Clients should refresh both `open` and the selection from this message.

```json
{
  "type": "mission_control_toggled",
  "open": true,
  "selected_workspace_id": "ws-xxx",
  "selected_tab_id": "tab-aaa"
}
```

`selected_*` are always sent (`null` means "cleared", which is distinct from "unchanged"). This matters for the default workspace, which is encoded as `selected_workspace_id: null`.

---

### SelectionChanged

Broadcast when the highlighted card moves inside MC (Navigate / Jump).

```json
{
  "type": "selection_changed",
  "selected_workspace_id": "ws-xxx",
  "selected_tab_id": "tab-aaa",
  "tab_title": "dev server"
}
```

`tab_title` is the title looked up server-side so touchscreen clients can render the card name without a separate `tab_list` round-trip. `tab_title` is omitted when no tab is selected (`Option::is_none`).

---

### McSnapshot

Sent on sync WS connect, after `tab_list` / `workspace_list`, so the client can initialize its MC state.

```json
{
  "type": "mc_snapshot",
  "open": false,
  "selected_workspace_id": null,
  "selected_tab_id": null
}
```

---

## Typical Flows

### Opening Mission Control programmatically

```javascript
const ws = new WebSocket("ws://localhost:8999/ws/sync?token=<token>");
ws.onmessage = (e) => console.log(JSON.parse(e.data));

ws.onopen = () => {
  ws.send(JSON.stringify({
    type: "mission_control_op",
    op: { kind: "toggle" }
  }));
};
// Server broadcasts: { type: "mission_control_toggled", open: true, ... }
```

### Navigate with arrow keys, then confirm

```javascript
ws.send(JSON.stringify({ type: "mission_control_op", op: { kind: "navigate", dir: "right" } }));
ws.send(JSON.stringify({ type: "mission_control_op", op: { kind: "navigate", dir: "right" } }));
ws.send(JSON.stringify({ type: "mission_control_op", op: { kind: "confirm" } }));
// Server: SelectionChanged -> SelectionChanged -> TabActivated -> MissionControlToggled(open:false)
```

### Jump to a workspace, then exit

```javascript
ws.send(JSON.stringify({
  type: "mission_control_op",
  op: { kind: "jump", workspace_id: "ws-prod" }
}));
ws.send(JSON.stringify({
  type: "mission_control_op",
  op: { kind: "cancel" }
}));
```
