# Multi-device Sync & Mission Control

Dinotty's core capability is **multi-device sync**: operate on desktop, mobile, or web, and the other devices see the same view in real time. Switch devices without losing sessions. Mission Control is the overview mode for managing all workspaces.

## Connecting from Three Devices

| Device | Connection | Use case |
|--------|-----------|----------|
| Desktop | Tauri native client, connects to a server on launch | Local or LAN development, native experience |
| Web | Browser at `http://<server>:8999` | Quick access, cross-platform |
| Mobile | Mobile browser + PWA install | Check agent progress away from the desk |

When all three connect to the same server, every pane's output is **broadcast to each device**, and input is sent by whichever device has focus.

## Mission Control Overview

Mission Control is a workspace-level overview mode:

- **Enter**: triggered via shortcut or toolbar button
- **Shows**: thumbnails of all workspaces, the active pane, and per-device connection state
- **Quick jump**: click any workspace thumbnail to enter it
- **Multi-device visibility**: see whether another device is currently operating a workspace

## Device Switching

Switching devices requires **no manual save**:

1. Mid-coding on desktop
2. Pull out your phone, open the PWA
3. The phone auto-connects to the same server
4. The view is identical to the desktop, with cursor and scroll position preserved
5. Continue typing on the phone, the desktop updates in real time

## Session Recovery

After network drop, screen-off, or page refresh:

- **WebSocket auto-reconnect**: exponential backoff, no manual refresh
- **PTY survives**: the server-side shell process is unaffected by frontend disconnects, agent tasks keep running
- **Screen snapshot restore**: on reconnect the server sends a full screen snapshot, no replay needed
- **Unsubmitted input preserved**: text typed but not yet enter'd before disconnect is still there

::: tip Server-side virtual terminal
Dinotty runs a full virtual terminal emulator (VTE) on the server, holding the exact screen state. This is impossible for other web terminals (ttyd/gotty/Wetty) -- they are just WebSocket-to-PTY pipes and lose the screen on disconnect.
:::

## Hardware Keyboard Multi-device Sync

With multiple devices connected simultaneously, hardware keyboard events sync:

- **Selection sync**: text selected on one device is highlighted on the others
- **Open state sync**: a file opened on one device auto-expands in the others' file tree
- **Input coordination**: only one device can type at a time, avoiding conflicts

Full design in [Hardware Keyboard Design](https://github.com/xichan96/dinotty/blob/dev/.claude/doc/hardware-keyboard-design.md).

## Notification Push

When the server detects a terminal bell / OSC 133 event, it pushes a notification over WebSocket to all connected devices. Even with the phone in the background, the PWA can receive the push (subject to browser/OS notification permissions).

See [Notifications](../features/notifications).

## Next Steps

- [Tabs & Panes](tabs-and-panes) - Multi-pane layout
- [Workspace Management](workspace) - Multi-workspace isolation
- [Mobile Keyboard & Shortcuts](mobile-keyboard) - Mobile input
