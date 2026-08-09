# Workspace Management

A workspace is Dinotty's top-level isolation unit: each workspace has its own tab layout, terminal sessions, SSH connections, and plugin config. Multiple workspaces let you build separate environments for different projects (or different tasks of the same project).

## Workspace Concepts

- **Isolation**: tabs, panes, and terminal sessions do not interfere across workspaces
- **Persistent**: workspace state lives on the server, restored after restart
- **Multi-device shared**: all devices connected to the same server see the same workspace list
- **Color-coded**: each workspace has its own color, visible in Mission Control

## Creating a Workspace

| Entry | Action |
|-------|--------|
| Sidebar bottom | Click the `+` button |
| Mission Control | "New Workspace" button at the top right |
| Command Palette | Run the `workspace.new` command |

Options when creating:

- **Empty**: start from scratch
- **From template**: apply a saved layout template
- **Clone existing**: copy an existing workspace's layout (without session state)

## Switching Workspaces

- **Sidebar**: click the workspace name
- **Mission Control**: click the workspace thumbnail
- **Shortcut**: `Cmd + Shift + P` to open Command Palette, type the workspace name to jump

Switching workspaces preserves the current workspace's state (no suspend), background terminal sessions keep running.

## Workspace Panel

The sidebar workspace list shows:

- Workspace name
- Color badge
- Active pane count
- Current connection state (local / SSH)
- Unread notification indicator

Right-click a workspace for:

- Rename
- Change color
- Copy layout as template
- Delete workspace

## Per-workspace Plugin Tabs

Plugin tabs are workspace-scoped: a plugin opened in one workspace is only visible there. This lets you configure different toolsets for different projects (e.g., JSON Formatter for frontend, DB Browser for backend).

See [Plugins](../plugins/plugins).

## Workspace Color

Each workspace gets a color from the One Dark Pro muted palette:

- Used in sidebar badges, Mission Control thumbnail borders, tab title decorations
- Auto-assigned on creation, editable
- The palette is uniformly muted, avoiding high-saturation candy colors

## Mission Control Overview

Mission Control shows a bird's-eye view of all workspaces:

- Workspace thumbnails (live-synced pane content)
- Per-device connection state
- Active pane highlight
- Drag to reorder workspaces

See [Multi-device Sync & Mission Control](multi-device-sync).

## Next Steps

- [Multi-device Sync & Mission Control](multi-device-sync) - Multi-device coordination
- [Tabs & Panes](tabs-and-panes) - Layout inside a workspace
- [SSH & SFTP](ssh-sftp) - Connect a workspace to a remote host
