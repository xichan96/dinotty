# Roadmap

The direction of Dinotty. Status updates with each release; completed items are archived in [Releases](https://github.com/xichan96/dinotty/releases).

## Planned

### Terminal Workflow

Record terminal operation flows with replay and sharing support. Useful for team collaboration and agent operation review.

### Scheduled Tasks Plugin

Built-in plugin for cron-style scheduled command execution. Combined with the notification system to alert on task completion.

### Todo List Plugin

Built-in plugin to manage todo lists on the terminal side, integrated with Coding Agent workflows.

### Client Management

Centrally manage multiple dinotty servers with a unified server list and connection management.

### Docs & Website

Add screenshots to docs; build the project website.

## Delivered

### Multi-device Sync & Mission Control

- Real-time session sync across three platforms; Mission Control overview of all tabs and workspaces
- Sync stability fixes: broadcast echo, PTY exit, REST API broadcast, replay protocol
- Reconnect rendering, SSH split-pane resize debounce
- Mission Control animation and keyboard navigation
- Mission Control overview state backend-led

### Workspace Management

- Multi-workspace isolation; create/delete/switch within Mission Control
- Current workspace indicator (status bar bottom-right), light-mode palette refinement
- Mission Control workspace drag-to-reorder

### SSH & SFTP

- Built-in SSH client with password / key auth
- SSH connection management: arrow-key selection, drag-to-reorder, no auto-popup keyboard on touch devices
- Split panes inherit SSH connection; SSH resize debounce
- SFTP browse, edit, upload, download

### Terminal & Tabs

- Auto layout, tab index, title editing, scrollbar
- Long-press copy (Apple-style draggable selection range)
- Fixes: closing empty tab no longer exits dinotty, Mission Control tab-switch mismatch
- High-output CLI freeze fix (write queue cap)
- Fix for last terminal line being obscured
- Restore last session on startup (session.json snapshot persistence)
- Shell discovery, WSL selection

### Split Panes & Broadcast

- Right-click menu supports split panes (left/right/top/bottom/broadcast)
- Command favorites take effect across all panes in broadcast mode
- Broadcast + bookmark distribution chain fix

### Command Favorites

- Edit mode no longer shows delete button to prevent accidental removal
- Two-step confirmation for deletion
- Drag-to-reorder

### File Browser

- File tree blank-state fix; split-pane support
- Fix for README embedded image preview
- Fix for directory targeting under SSH
- SFTP upload/download fixes
- Web/file preview converted to a layout leaf, unified with terminal and plugin panes
- Web preview toolbar: back/forward, address bar, bookmarks, open-in-browser, DevTools
- Markdown preview initializes display state by file type
- File/web panes support drag-to-reorder (unified layout system)

### Shortcuts & Input

- Shift+Enter for newline
- Settings page shortcut reorganization; SSH shortcut adjustment
- Fix: Esc key no longer becomes newline in opencode
- Fix: right-click paste on desktop / Ubuntu
- Fix: iOS Safari scroll, WKWebView Chinese punctuation composition

### Settings & Appearance

- Configuration items grouped by functional boundary
- Theme export lets user choose save path
- Save button no longer disrupts current page
- About tab adds documentation and feedback links

### Desktop

- Closed window can be reopened from Dock
- Drag-and-drop file path paste from VSCode tree
- Auto-update check, login auto-launch
- Desktop router drift fix
- macOS signing and notarization

### Mobile

- System IME mode
- Hardware keyboard multi-device sync
- Touch devices no longer auto-popup keyboard for SSH list

### Security

- Cookie session authentication
- Token permission system (capability-based fine-grained access control)
- WebSocket origin check, login lockout
- Open API authentication (keyboard API no longer defaults to the default terminal)
- Token no longer exposed in query parameters
- Verification-code login mode (alternative to token)

### Agent API & MCP

- HTTP/WebSocket structured interaction for AI agents and automation scripts
- Built-in JSON-RPC MCP server
- Event Bus, audit log, webhook
- Plugin API passes pane identity and tab-level visibility

### Layout Templates

- Save current tab layout as a template
- One-click apply with template list preview
- Apply template enters the specified workspace

### Notifications & Monitoring

- Notifications distinguish tab source
- System monitor indicates local machine
- Status bar auto-collapses when clicking elsewhere

### Docs

- README enhanced with desktop/mobile GIFs and scenario GIFs

## Feedback

Roadmap items are subject to change with version evolution. For requests and suggestions, please open an issue on [GitHub Issues](https://github.com/xichan96/dinotty/issues).
