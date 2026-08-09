# Tabs & Panes

Dinotty's layout system unifies four pane types -- terminal, file editor, plugin, web preview -- all of which support drag-split, cross-tab drag, and extract-to-tab.

## Tab Operations

| Action | Shortcut |
|--------|----------|
| New tab | `Cmd + T` (`Ctrl + T` on Windows/Linux) |
| Close current tab | `Cmd + W` |
| Next / previous tab | `Cmd + Shift + ]` / `[` |
| Jump to tab N | `Cmd + <N>` (e.g., `Cmd + 3`) |
| Rename tab | Double-click the tab title |

Tab order is persisted per workspace and restored on page refresh.

## Splits

| Action | macOS | Windows/Linux |
|--------|-------|---------------|
| Horizontal split (new pane on the right) | `Cmd + \` | `Ctrl + \` |
| Vertical split (new pane below) | `Cmd + Shift + \` | `Ctrl + Shift + \` |
| Next / previous pane | `Cmd + Shift + ]` / `[` | `Ctrl + Shift + ]` / `[` |
| Maximize / restore current pane | `Cmd + Shift + Enter` | `Ctrl + Shift + Enter` |
| Equalize all panes | `Cmd + =` | `Ctrl + =` |
| Close current pane | `Cmd + W` (when focused on pane) | `Ctrl + W` |

## Drag-and-drop Splits

Beyond shortcuts, you can drag with the mouse:

1. **Drag pane title bar**: hold and drop into a target region (top/bottom/left/right half, or center to overlay)
2. **Drag tab into a pane**: drag a tab from the tab bar onto a pane to convert it into that pane's content
3. **Drag to screen edge**: auto-snaps to half-screen

A **drop indicator** shows the placement target during drag.

## Cross-tab Drag

Drag a pane from the current tab to another tab:

1. Hold the pane title bar to start dragging
2. Hover over the target tab for ~0.5s, the target tab auto-activates
3. After it switches, continue dragging into the target pane region and release

You can also drop a pane onto empty space in the tab bar to **extract it as a new tab**.

## Layout Templates

Complex split layouts can be saved as templates for reuse:

- **Save**: current tab's split layout -> toolbar "Save as Template" button -> name it
- **Apply**: pick a template when creating a new tab, or apply onto an existing tab
- **Manage**: view/edit/delete saved templates in the settings panel

A template captures pane types (terminal/file/plugin/web), relative sizes, and associated SSH connections (if any).

::: tip Phase 5 pending
The template management UI (Phase 5) is not yet finished; templates currently can only be managed via the save/apply flow. See [Layout Templates Design](https://github.com/xichan96/dinotty/blob/dev/.claude/doc/layout-templates-design.md).
:::

## Pane Types

| Type | Description |
|------|-------------|
| Terminal | Default pane, runs shell / coding agent |
| File editor | Monaco-based editor, see [File Editor](../features/file-editor) |
| Plugin | Vue 3 rendered plugin UI, see [Plugins](../plugins/plugins) |
| Web preview | Built-in reverse proxy + iframe, see [Web Preview](web-preview) |

All four pane types share the same split/drag/tab rules.

## Multi-cursor & Cursor Group

- **Monaco native multi-cursor**: multi-cursor editing within a single file, see [File Editor](../features/file-editor#multi-cursor-editing)
- **Cursor Group**: cross-file / cross-split broadcast of cursor position, used for multi-device collaborative editing

## Next Steps

- [File Editor](../features/file-editor) - Monaco editing features in detail
- [Web Preview](web-preview) - Built-in web preview pane
- [Workspace Management](workspace) - Multi-workspace isolation
