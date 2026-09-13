# Notification-driven agent supervision (replace poll watcher)

Status: **proposal in review — 2026-09-09**. Not implemented. This doc explores replacing the
3s-poll `tabwatch.py` (dinotty-dispatch-tabs skill) with dinotty's built-in notification
system as the event source, per the user's direction ("dinotty 内建通知系统…可以通过通知 ws 获取").

## Problem

Supervising N remote agent tabs today = `tabwatch.py` polling every pane's `/screen` + git HEAD
every 3s, exiting on APPROVAL / COMMITTED / CRASHED / IDLE to wake the admin session.
Costs:
- Poll latency up to 3s per event; burns prompt cache while idle (screen md5 churn keeps waking).
- Manual restart of the one-shot watcher after every event.
- It only detects the *screen showing "to proceed?"* — not the richer event model dinotty already has.

## dinotty notification system (verified in code + docs)

Docs: `docs/zh/features/notifications.md`, `docs/en/features/notifications.md`. Backend
`src/notification/*`, PTY OSC detection `src/pty.rs:505-517` → `dispatch_osc_actions`,
broadcast `src/notification/broadcast.rs` (`send_notify` :129, `send_detected_bell` :66).

- Terminal output OSC 9 / OSC 777 / BEL are auto-detected server-side (`osc_notify` default true,
  `src/settings/types/notification.rs:34`) → Notification ledger → `/ws/sync` push.
- `POST /api/notify` accepts arbitrary pushes (`body` + optional `title`/`pane_id`/
  `notification_type` info|success|warning|error|urgent). `src/main.rs:429`,
  `src/notification/handler.rs`. Handles legacy snake_case `pane_id`, `notification_type`.
- Claude Code natively emits OSC 9 when waiting for input (Notification) and when a task
  finishes (Stop). Zero-config on the dinotty side. Hook template in the docs lets you customize
  type/urgency.
- Frontend consumes via `/ws/sync` `type:'bell'|'notify'` (`useSyncWebSocket.ts:712-719`), driven
  by `notification/attention` + presentation (toast/panel/badge/desktop).

## Key finding: /ws/sync is subscribable by an external client

`src/ws/sync.rs:23-44` — the upgrade does an **origin check** (`check_ws_origin`, not a bearer-token
handshake), then streams full `SyncMsg`s (tab_list, notify, bell, state_delta, monitor_data…).
No client hello needed (`useSyncWebSocket.ts:236-267` just opens and reads). `NotificationBroadcast`
feeds the same socket.

=> A supervision client can open `ws://<host>/ws/sync` with a browser-like Origin header and
receive the SAME notification events the desktop UI gets. That is the event source that replaces
polling.

## Proposed architecture

Replace "poll screen for 'to proceed?'" with "subscribe to notify/bell on /ws/sync" for the
**needs-attention** signal, and keep **git HEAD change** as the commit signal (already exact,
no polling needed — a tiny inotify/git-watch or a long-interval check; or a Stop hook).

Two event classes the admin cares about:
1. **Agent needs input / permission approval** → claude emits OSC 9 (Notification) OR a
   Stop/Notification hook POSTs `/api/notify` with type `warning`/`urgent` + `pane_id`.
   Either way a `notify` frame arrives on /ws/sync → wake admin with the pane id + body.
2. **Task complete / committed** → claude Stop hook POSTs `/api/notify` type `success`
   (`pane_id` = impl pane) → `notify` frame → admin reviews; git HEAD diff confirms.

## Two implementation shapes (decision needed)

### Shape A — zero dinotty code change (hooks + ws subscribe client only)
- Add to the remote agent's Claude Code settings (`.claude/settings.json` in the impl worktree,
  or `~/.claude/settings.json` on the remote) the Notification + Stop hooks from the docs, but
  pointing at `/api/notify` with `$DINOTTY_PANE_ID` (dinotty injects it into every pane process).
  Because claude ALREADY emits OSC 9 natively, the hooks are optional refinements (custom type,
  extra body) — native OSC detection may suffice.
- Admin side: replace `tabwatch.py` with a small `notifywatch.py` that opens `/ws/sync`, filters
  `notify`/`bell` frames whose `pane_id` is one of the supervised panes (or any pane in the remote
  that is a claude tab), prints the event, exits → wakes admin. Git HEAD still checked at lower
  frequency (e.g. every 20-30s) for COMMITTED, or rely on a Stop hook notify.
- **Pros**: no dinotty source change; works against the deployed remote as-is. **Cons**: still a
  hybrid (git HEAD check remains); OSC/hook availability on the exact claude version must be
  verified empirically; the "who is a supervised pane" filter needs the pane→worktree map.

### Shape B — add a real agent-event channel in dinotty (code change)
The repo already has an agent/session subsystem (`src/agent.rs`, `/api/sessions/:pane_id/run|send|read`,
`/ws/events` at `src/main.rs:584`, OSC 133 command-completion detection at `src/agent.rs:341`).
A richer design: let dinotty's own supervision surface emit precise events (agent idle-waiting,
command done, exit) on a dedicated channel an external admin can subscribe to. This is a product
change (the user is the dinotty maintainer) but larger scope; needs its own design pass.

## PROBED 2026-09-09 — /ws/sync delivers notify to external subscribers (CONFIRMED)

A node `ws` client (stdlib-less, `ws` from /Users/CHENXI/node_modules) opened
`ws://192.168.1.245:8999/ws/sync` with `Origin: http://192.168.1.245:8999` + Bearer token.
No client hello needed. A one-shot tab emitting `printf '\e]9;WS-PROBE-HELLO\a'` produced,
~1s later, a live frame:

```json
{"type":"notify","v":1,"pane_id":"","body":"WS-PROBE-HELLO","notification_type":"info",
 "eventSeq":"10","occurredAt":...,"severity":"info","notifId":"..."}
```

Findings:
- Origin check passes with a matching Origin header; bearer token also accepted.
- `sync_hello` + `tab_list` arrive on connect; `state_delta`/`notify` stream live.
- **OSC 9 notifications carry `pane_id: ""`.** ⚠️ **The original interpretation of this was
  wrong** — see the correction below.

> ### CORRECTION 2026-09-11 — the empty `pane_id` was a design choice, not missing information
>
> This doc originally read the empty `pane_id` as "the OSC sequence has no pane identity, so the
> backend had nothing to attribute". That is **not what the code does**. The detection path knows
> the pane exactly: `src/session/manager.rs:987` matches `OscAction::Bell` and calls
> `notifier.send_notify(pane_id, …)` with the real leaf id. The frame then empties it **on
> purpose** (`src/notification/broadcast.rs`, comment on the `Notify` construction):
>
> > OSC 9/777 are explicit "notify the user" requests: record them on the pane-decoupled notif
> > path … so presentation is never suppressed by the client's focused-pane rules.
>
> So the information was never lost — it was deliberately withheld from the field that drives
> *rendering*, and kept on the debounce key, the event bus and the hooks.
>
> That decoupling is right for presentation but it made the frame useless for *routing*, which is
> why the conclusion below used to say a hook was REQUIRED. **`SyncMsg::Notify` now carries a
> separate `sourcePaneId` field** (`src/session/types.rs`) for exactly this: attribution without
> disturbing `pane_id`'s suppression semantics. The OSC path sets it to the real pane; the
> pane-less plugin producer omits it.
>
> ```json
> {"type":"notify","v":1,"pane_id":"","sourcePaneId":"<leaf pane id>","body":"…", …}
> ```
>
> Consumer rule: **read `sourcePaneId` to route, read `pane_id` to render.** Collapsing either
> into the other breaks a consumer — filling `pane_id` reintroduces focused-pane suppression, and
> dropping `sourcePaneId` makes an OSC-only watcher blind to *which* pane spoke.
> Pinned by `osc_notify_keeps_attribution_alongside_the_decoupled_pane_id` in
> `src/session/session_stub_tests.rs` (and its counterpart
> `osc_notify_uses_pane_decoupled_notif_path`, which guards the empty `pane_id`).
>
> **Follow-up not done here (frontend, separate decision):** the web UI still reads only
> `event.pane_id` (`frontend/src/composables/useNotification.ts:539`), so an OSC-detected
> notification is still not click-to-jump even though the pane is now on the wire. Wiring it up
> would also require revisiting the `source:` inference on `useNotification.ts:543`, which
> currently classifies "no `pane_id`" as a plugin notification. That is a behaviour change and
> belongs in its own change, not in the backend attribution fix.

=> **Shape A is feasible with no hook and no `.claude` file — but NOT from claude's native
OSC 9 emission, which it does not send by default.** See the probe below.

## PROBED 2026-09-11 — claude's completion signal (A/B, CONFIRMED)

Ran two claude tabs (v2.1.218, `--permission-mode auto`) with the same trivial prompt
("reply with PONG, use no tools"), while a `/ws/sync` subscriber watched every pane.

| Tab | argv | Frames received |
|---|---|---|
| A | `claude --permission-mode auto "…"` | **none** — tab reached `⏺ PONG`, `✻ Cogitated for 1s`, cursor idle at the prompt, and emitted nothing |
| B | `claude --settings '{"preferredNotifChannel":"terminal_bell"}' --permission-mode auto "…"` | **one** — `{"type":"bell", …}` |

Tab B's frame, as captured:

```
EVENT: <pane> pane=a7477779-54fa-4868-be3c-88f7cefb36cf type=bell body=Bell
```

Conclusions (these supersede the assumptions they replace):

1. **claude does not emit OSC 9 on turn completion by default.** Open question 1 below is
   answered: the reliable trigger is *not* native OSC. Anything built on "claude already rings
   the bell" would have been silently dead.
2. **`preferredNotifChannel: "terminal_bell"` makes it emit a plain BEL**, which dinotty's PTY
   detection turns into a `bell` frame. Valid values in the binary (v2.1.218):
   `terminal_bell`, `iterm2_with_bell`, `iterm2+bell`, `none`.
3. **The setting needs no file.** `claude --settings '<json>'` accepts inline JSON, so it rides in
   the tab's argv — the same place the model override goes. No `.claude/settings.json`, no
   per-worktree config, nothing to install and nothing to forget on a new worktree.
4. **The `bell` frame already carries the real `pane_id`** (`SyncMsg::Bell` is not
   pane-decoupled, unlike `Notify`). So this path did not need `sourcePaneId` at all — that field
   remains the fix for *OSC 9 messages*, a different trigger this probe did not exercise.

**Not verified:** whether claude rings on "needs your input / permission" as well as on
completion. Tab B's prompt finished unattended under `auto` mode, so no approval prompt was
raised. Worth probing before relying on the bell for the approval case too.

## Open questions to resolve before building (verified-by-experiment)

1. **Does claude emit anything when it *waits for input* (rather than finishing)?** The
   2026-09-11 probe answered the completion half: no native OSC, but yes with
   `preferredNotifChannel: terminal_bell`. The approval half is still unprobed — run a tab that
   trips a permission prompt (i.e. not under `auto`) and watch whether a `bell` arrives.
2. ~~**Does a `notify` frame carry the target `pane_id`?**~~ **ANSWERED 2026-09-11**: yes, via
   `sourcePaneId` (added to `SyncMsg::Notify`). `pane_id` itself stays empty by design. See the
   correction above.
3. **Origin check specifics** — what Origin header/value does `check_ws_origin` accept for a
   non-browser client (same host? configured allowed_origins? `*`?). Must read `src/auth` origin
   logic or just probe with `Origin: http://192.168.1.245:8999`.
4. **Supervised-pane identity**: a claude tab's pane_id (from `POST /api/tabs` response) vs the
   pane_id dinotty injects as `DINOTTY_PANE_ID` into the claude process — are they the same leaf?
   (Very likely yes, but confirm — the hooks need the right id to make notifications jumpable.)

## Recommendation

Proceed in two steps:
1. **Probe** (cheap, no code change): while an agent tab is parked at an approval prompt, open
   `/ws/sync` from the admin host and record whether a notify/bell frame arrives, its shape, and
   whether `sourcePaneId` matches the tab's leaf pane. This settles question 1 (the only one still
   open — it is about *claude's* emission, not about dinotty's attribution).
2. Implement **Shape A** as `notifywatch.py` — a `/ws/sync` subscriber, **no hooks and no
   `.claude` change**, replacing the polling `tabwatch.py` in the dinotty-dispatch-tabs skill.
   Only fall back to hooks if step 1 shows claude's native OSC emission is absent on the deployed
   version.

Shape B (native agent-event channel) is a separate, larger design if the user wants the *product*
to expose supervision events rather than the admin-side script adapting to notify.

## Files referenced

- Notify API: `src/notification/handler.rs`, route `src/main.rs:429`
- Broadcast/ledger: `src/notification/broadcast.rs`, `src/attention/ledger.rs`
- PTY OSC detect: `src/pty.rs:476,505-517`
- Sync WS: `src/ws/sync.rs`, route `src/main.rs:426`, origin check `src/auth`
- Frontend consume: `frontend/src/composables/useSyncWebSocket.ts:712-719`
- Notify settings: `src/settings/types/notification.rs`
- Agent subprocess + OSC 133: `src/agent.rs`, `/ws/events` `src/main.rs:584`
- Docs: `docs/{zh,en}/features/notifications.md`
