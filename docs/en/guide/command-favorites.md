# Command Favorites

Command Favorites (Command Bookmarks) lets you save common commands, group them, and execute with one click. More controllable than shell history, more visual than shell aliases.

## Bookmarking Commands

### Right-click terminal text

Select a command in the terminal pane, right-click -> **Bookmark Command**. The selected text auto-fills the new-bookmark form.

### Manual creation

Open the bookmarks panel (sidebar bookmark icon), click the `+` button at the top right:

| Field | Description |
|-------|-------------|
| Name | Display name (optional, defaults to first segment of command) |
| Command | Full command text |
| Group | Optional, for classification (e.g., `git` / `deploy` / `debug`) |

Click ✓ or press `Cmd + Enter` to save.

## Group Management

- **New group**: type a new name in the "Group" field of the bookmark form, auto-created
- **Switch group**: click group tags at the top of the panel to filter
- **All**: show bookmarks across all groups
- **Drag-to-reorder**: drag the grip icon on the left of each bookmark, can cross groups

## One-click Execution

| Action | Behavior |
|--------|----------|
| Click a bookmark | Send the command to the current terminal pane (auto Enter) |
| `Cmd + Click` | Paste the command without Enter (for editing before execution) |
| Select in search + Enter | Execute the highlighted bookmark |
| Select in search + `Cmd + Enter` | Paste without Enter |

::: tip Combined with broadcast
With [Broadcast Mode](broadcast) on, clicking a bookmark executes it across all panes simultaneously. Great for multi-server batch operations.
:::

## Edit & Delete

- **Edit**: right-click a bookmark -> Edit
- **Delete**: right-click -> Delete, confirmed before removal
- **Bulk delete**: not supported, delete one by one

## Search

The search box at the top of the panel does fuzzy matching:

- Matches name, command text, group
- `↑` / `↓` to select, `Enter` to execute
- `Esc` to clear search

## Cross-workspace Sharing

Command favorites are **account-level** (not workspace-level), shared across all workspaces. The same set of common commands is available in every project.

::: tip With SSH
After connecting SSH, clicking a bookmark executes the command on the remote host. Build different groups for different remote hosts, e.g., `prod-deploy` / `staging-debug`.
:::

## Next Steps

- [Broadcast Mode](broadcast) - Sync execution across panes
- [SSH & SFTP](ssh-sftp) - Remote command execution
- [Tabs & Panes](tabs-and-panes) - Multi-pane layout
