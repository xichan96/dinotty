# File Editor

Dinotty ships with a built-in file browser (file tree on the left, editor/preview on the right). The right side is powered by Monaco and supports split panes, multi-cursor editing, and cross-file synchronization.

## Split Panes

| Action | Shortcut |
|--------|----------|
| Split horizontally (new pane on the right) | `Cmd + \` (`Ctrl + \` on Windows/Linux) |
| Split vertically (new pane below) | `Cmd + Shift + \` |
| Close the active editor pane | `Cmd + W` (when the file browser is focused) |
| Switch to the next / previous pane | `Cmd + Shift + ]` / `[` |
| Toggle maximize / restore the active pane | `Cmd + Shift + Enter` |
| Equalize all panes | `Cmd + =` |
| Open a file in a new split pane | `Cmd/Ctrl + Click` the file in the tree |

The split layout is persisted per tab in localStorage and restored on refresh.

## Multi-line Editing (Multi-cursor)

The file editor provides two multi-cursor mechanisms: Monaco native multi-cursor (within a single file) and Cursor Group (cross-file / cross-pane broadcast).

### Monaco Native Multi-cursor

Use Monaco's built-in shortcuts directly inside an editor pane. Input lands at every cursor position; undo / redo is the per-pane stack:

| Action | macOS | Windows/Linux |
|--------|-------|---------------|
| Add a cursor at a position | `Option + Click` | `Alt + Click` |
| Add cursor below / above | `Cmd + Option + ↓` / `↑` | `Ctrl + Alt + ↓` / `↑` |
| Select next occurrence of word | `Cmd + D` | `Ctrl + D` |
| Select all occurrences of word | `Cmd + Shift + L` | `Ctrl + Shift + L` |
| Column selection (drag) | `Shift + Option + drag` | `Shift + Alt + drag` |

Best for editing multiple spots inside a single file.

### Cursor Group (cross-file / cross-pane broadcast)

For cases where the same change must land across multiple files or multiple positions — e.g. renaming an identifier referenced in many places.

**Workflow:**

1. Select a word in the editor (or place the cursor on it).
2. Press `Shift + L` to trigger the "Add Cursors in Files" command.
3. Dinotty runs ripgrep across the working directory, then shows a picker for you to select which matches to include.
4. After confirming:
   - **Single file matches**: the current pane keeps multiple selections, equivalent to multi-cursor.
   - **Multi-file matches**: each file opens in its own split pane, with multi-cursor set inside each pane.
5. Typing in any pane broadcasts the change to every pane in the same group.
6. `Cmd + Z` / `Cmd + Shift + Z` undoes / redoes the entire group together.

> Cursor Group undo / redo only applies to the active group. If you've switched to another pane or group, click back into a pane of the original group before undoing.

### Cursor Group vs Terminal Split Broadcast

| Dimension | Terminal split broadcast | File editor Cursor Group |
|-----------|--------------------------|--------------------------|
| Target | PTY input byte stream | Monaco editor text changes |
| How to trigger | Enable broadcast mode after splitting | `Shift + L` triggers search + picker |
| Sync granularity | Input characters | Text deltas (insert / delete ranges) |
| Undo behavior | PTY itself | Group-wide synchronous undo / redo |

## Supported File Types

| Category | Examples | Behavior |
|----------|----------|----------|
| Code / scripts | `.rs` `.ts` `.py` `.go` … | Syntax highlighting + editable |
| Documents | `.md` `.txt` `.log` | Markdown render / plain text |
| Images | `.png` `.jpg` `.gif` `.webp` `.svg` | Scaled display |
| Video | `.mp4` `.webm` `.mov` | Built-in player |
| Audio | `.mp3` `.wav` `.flac` | Playback controls |
| Office | `.docx` `.xlsx` `.pptx` | Rendered preview (read-only) |
| Binary / other | - | No content, hint only |

## Saving

- A `●` next to the title indicates unsaved changes.
- Click the save button or press `Cmd + S` to write the file.
- When the same file is open in multiple panes, each tracks its own dirty state; the last write wins on save.
