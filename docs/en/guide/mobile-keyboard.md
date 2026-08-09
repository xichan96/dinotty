# Mobile Keyboard & Shortcuts

Dinotty optimizes input on phones and tablets: a customizable shortcut keyboard provides Ctrl/Esc/arrow/function keys, with multi-device hardware keyboard sync.

## Mobile Keyboard

### Enabling

Mobile shows a shortcut keyboard bar by default (at the bottom of the screen, above the native keyboard). Toggle it with the keyboard switch button (`KbToggleButton`).

### Layout

The mobile keyboard spans multiple rows:

| Row | Keys |
|-----|------|
| Modifiers | `Ctrl` `Alt` `Shift` `Esc` `Tab` `Meta` |
| Arrows | `←` `↑` `↓` `->` `Home` `End` `PageUp` `PageDown` |
| Function keys | `F1`-`F12` |
| Custom row | User-configured common keys |
| History | Recent inputs (tap to resend) |

Modifiers support **sticky mode**: tap `Ctrl` (it highlights, doesn't release), then tap a letter, equivalent to `Ctrl + letter`.

### Custom Layout

Settings -> Keyboard -> Edit Layout:

- Add / remove keys
- Edit key labels and the characters they send
- Set key width (flex-grow)
- Drag to reorder

The layout is saved on the server and shared across devices. See [Keyboard Layout Design](https://github.com/xichan96/dinotty/blob/dev/.claude/doc/additional-features-design.md).

## History Bar

The history bar at the top of the keyboard shows recent N inputs:

- Tap to resend (auto Enter)
- Long-press to delete an entry
- Swipe horizontally for more

## Hardware Keyboard Multi-device Sync

With multiple devices connected, hardware keyboard events sync:

| What syncs | Behavior |
|------------|----------|
| Selection | text selected on one device highlights on the others |
| Open state | a file opened on one device auto-expands in the others' file tree |
| Input coordination | only one device can type at a time (focus-based) |

Full design in [Hardware Keyboard Design](https://github.com/xichan96/dinotty/blob/dev/.claude/doc/hardware-keyboard-design.md).

## Shortcut Cheatsheet

### Global

| Action | macOS | Windows/Linux |
|--------|-------|---------------|
| Command Palette | `Cmd + Shift + P` | `Ctrl + Shift + P` |
| Toggle fullscreen | `Cmd + Shift + F` | `F11` |
| Settings panel | `Cmd + ,` | `Ctrl + ,` |
| Mission Control | `Cmd + Shift + M` | `Ctrl + Shift + M` |

### Tabs / Panes

| Action | macOS | Windows/Linux |
|--------|-------|---------------|
| New tab | `Cmd + T` | `Ctrl + T` |
| Close tab | `Cmd + W` | `Ctrl + W` |
| Horizontal split | `Cmd + \` | `Ctrl + \` |
| Vertical split | `Cmd + Shift + \` | `Ctrl + Shift + \` |
| Switch pane | `Cmd + Shift + ]` / `[` | `Ctrl + Shift + ]` / `[` |
| Maximize pane | `Cmd + Shift + Enter` | `Ctrl + Shift + Enter` |
| Broadcast mode | `Cmd + Shift + B` | `Ctrl + Shift + B` |

### File Editor

| Action | macOS | Windows/Linux |
|--------|-------|---------------|
| Save | `Cmd + S` | `Ctrl + S` |
| Add cursor below | `Cmd + Option + ↓` | `Ctrl + Alt + ↓` |
| Add cursor via click | `Option + Click` | `Alt + Click` |
| Command palette | `Cmd + Shift + P` | `Ctrl + Shift + P` |

See [File Editor](../features/file-editor).

## Known Issues

- **iOS Safari Chinese input**: see [WKWebView composition issue](https://github.com/xichan96/dinotty/blob/dev/.claude/doc/tech-debt-wkwebview-composition.md), worked around via `compositionend` direct `sendData`

## Next Steps

- [Multi-device Sync & Mission Control](multi-device-sync) - Three-device coordination
- [Tabs & Panes](tabs-and-panes) - Full shortcut list
- [Appearance & Themes](appearance) - Font size / font family settings
