# Broadcast Mode

Broadcast mode sends one pane's input to all panes in the current tab simultaneously. Useful for running the same command on multiple servers.

## Enabling Broadcast

| Method | Action |
|--------|--------|
| Toolbar button | Click the "Broadcast" icon in the pane title bar |
| Command Palette | Type `broadcast.toggle` |
| Shortcut | `Cmd + Shift + B` |

When enabled, the source pane's title bar shows a **red badge**, indicating input will be broadcast.

## Input Sync

In broadcast mode, every byte typed in the source pane is sent to all terminal panes in the current tab at the same time:

- **Keyboard input**: characters, Enter, Ctrl+C, Tab completion, etc.
- **Paste**: long content pastes into all panes simultaneously
- **Shortcuts**: `Ctrl + C` interrupts the current process in all panes

::: warning What is not broadcast
- Pane resize only affects the current pane
- File editor panes are not broadcast (only terminal panes broadcast)
- Web preview and plugin panes are not broadcast
:::

## Typical Use Cases

### Multi-server batch operations

1. Split 4 terminal panes in a tab, each SSH'd to a different server
2. Enable broadcast
3. Type `sudo apt update && sudo apt upgrade -y`
4. All 4 servers run the upgrade simultaneously

### Cluster verification

1. Split panes connected to each cluster node
2. Enable broadcast
3. Type `kubectl get pods -A` or `docker ps`
4. Compare output across nodes

### Failure drills

1. Multi-pane connect to primary and backup machines
2. Broadcast a failure command (e.g., `systemctl stop nginx`)
3. Observe failover behavior

## Disabling Broadcast

Click the "Broadcast" button again or `Cmd + Shift + B` to disable. Input then only goes to the current pane.

::: tip Auto-disable
Switching tabs auto-disables broadcast, preventing accidental operation. You'll need to re-enable it when returning to the original tab.
:::

## Cross-workspace Limits

Broadcast is tab-level -- it only affects panes within the current tab, not across tabs. To sync across multiple workspaces, enable broadcast in each.

## Next Steps

- [Command Favorites](command-favorites) - Save common commands for one-click execution (not broadcast, but click in each pane to repeat)
- [Tabs & Panes](tabs-and-panes) - Multi-pane layout
- [SSH & SFTP](ssh-sftp) - Multi-server connections
