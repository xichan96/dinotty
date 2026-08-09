# SSH & SFTP

Dinotty has a built-in SSH client. A workspace can activate an SSH connection as its active connection -- after that, terminal, file browsing, and command bookmarks all execute on the remote host, with a local-like experience.

## Creating an SSH Connection

Open the SSH panel on the right (sidebar server icon), click `+` at the top right to create a connection:

| Field | Description |
|-------|-------------|
| Name | Display name, optional (defaults to host) |
| Host | Hostname or IP |
| Port | Default 22 |
| Username | Login user |
| Auth method | Password / Key |
| Key path | Path to private key (for key auth) |
| Passphrase | Key passphrase (if applicable) |
| Group | Optional, for grouping in the panel |

::: tip Connection reuse
SSH configs are saved as profiles and can be reused across workspaces. Each workspace can have at most one active SSH connection at a time.
:::

## Auth Methods

### Password

Enter the user password; a prompt appears on connect. The password can optionally be saved to the local keychain to avoid re-entry.

### Key

Pick a private key file (default `~/.ssh/id_rsa`, `~/.ssh/id_ed25519`, etc.). If the key has a passphrase, you'll be prompted on connect.

OpenSSH and PEM formats are supported.

## host_key Verification

On first connect to a host, the server fetches the host_key and shows the fingerprint:

- **Verify**: compare against the known correct fingerprint (e.g., from your cloud provider's console)
- **Accept**: once accepted, the host_key is saved to `~/.ssh/known_hosts` locally
- **Change alert**: if the host_key changes on subsequent connects, the connection is refused with a warning (mitigates man-in-the-middle attacks)

::: warning Refuse unknown host_keys
Do not accept unknown host_keys on untrusted networks -- it could be a man-in-the-middle attack.
:::

## SFTP File Management

After an SSH connection is established, the workspace file browser switches to SFTP mode:

- **Browse**: remote directory tree expands
- **Edit**: double-click to download to a temp cache, edit with Monaco
- **Save**: auto-uploads back to remote on save
- **Upload**: drag local files into the file browser
- **Download**: right-click a file -> Download
- **Delete / Rename**: via the right-click menu

SFTP runs over the same SSH channel, no extra port needed.

## Split Pane Inherits Connection

After a workspace activates an SSH connection, all new terminal panes **auto-inherit** it:

- Connect SSH in pane A
- `Cmd + \` to create a new split pane B
- Pane B auto-logs into the same remote host

This lets you open multiple shells on the remote -- e.g., one running an agent, one watching logs, one editing config.

## Switching to Local

A workspace can have only one active connection. To switch from SSH back to local:

1. **Command Palette** (`Cmd + Shift + P`) -> type `connection.local` / `disconnect`
2. **Sidebar server list**: right-click the current connection -> Disconnect

After switching, new panes use the local shell; existing panes keep their original connection until closed.

## SSH Config Files

Dinotty does not read `~/.ssh/config` Host aliases -- all connections are managed in the panel independently. If you rely on `~/.ssh/config`, just fill the alias's host/port/user directly into a Dinotty SSH profile.

## Known Limitations

- **SSH agent forwarding**: not yet supported (`-A`); configure manually on the remote if needed
- **Jump host (ProxyJump)**: not yet supported; set up an SSH tunnel if needed
- **Port forwarding**: not yet supported (`-L` / `-R`)

## Next Steps

- [Workspace Management](workspace) - Workspace-scoped connection config
- [Tabs & Panes](tabs-and-panes) - Splits inherit SSH connection
- [Command Favorites](command-favorites) - One-click remote command execution
