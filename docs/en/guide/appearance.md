# Appearance & Themes

Dinotty's visual style follows a VSCode-dark muted theme (neutral gray `#8a8a8a`). The built-in theme manager lets you switch themes, adjust fonts, and customize colors.

## Theme Manager

Open Settings -> Appearance; the theme manager is at the top:

- **Theme list**: built-in + custom themes
- **Current theme**: highlighted
- **New theme**: clone from current
- **Import**: from a JSON file
- **Export**: share the current theme as JSON

## Built-in Themes

| Theme | Style |
|-------|-------|
| One Dark Pro Muted | Default, low-saturation muted dark |
| GitHub Dark | Cool blue-gray |
| Monokai Pro | Warm, classic editor palette |
| Solarized Dark | Blue-green base, soft on the eyes |
| Dracula | Purple, high contrast |

The palette is uniformly muted, avoiding high-saturation candy colors (e.g., `#FF5D5D`).

## Font Settings

| Setting | Range | Default |
|---------|-------|---------|
| Font size | 8-32 px | 14 |
| Font family | System fonts + common monospace fonts | SF Mono / Cascadia Code / Consolas |
| Line height | 1.0-2.0 | 1.4 |
| Letter spacing | -2 to 5 | 0 |

The font dropdown shows **a preview of each font** (each item rendered in its own font).

::: tip Recommended monospace fonts
- macOS: SF Mono, JetBrains Mono
- Windows: Cascadia Code, Consolas
- Linux: Fira Code, JetBrains Mono
:::

## Theme Editor

Click "Edit" in the theme manager to open the theme editor:

- **Color token editing**: one row per token, color picker to modify
- **Live preview**: right-side sample terminal reflects changes in real time
- **Save / Save as**: overwrite the current theme or save as new

### Color Tokens

A theme is defined by a set of tokens:

| Token | Use |
|-------|-----|
| `--bg-*` | Background layers (base / panel / hover / active) |
| `--fg-*` | Foreground layers (base / muted / subtle) |
| `--color-*` | Accents (accent / success / warning / error) |
| `--border-*` | Border layers |

New colors should be registered as tokens in `frontend/src/styles/base.css` first, then referenced via `var(--color-*)` in components; avoid hardcoding hex in components. See [Visual Style](https://github.com/xichan96/dinotty/blob/dev/CLAUDE.md#visual-style).

## Workspace Colors

Workspace badge colors are independent of theme:

- Auto-assigned on workspace creation
- Picked from the One Dark Pro muted palette
- Right-click a workspace -> Change color

See [Workspace Management -> Workspace Color](workspace#workspace-color).

## Multi-device Sharing

Themes are **server-level** config, shared across all connected devices. Switch theme on mobile, desktop updates in real time.

## Config Directory

Theme configs are stored at:

| Platform | Path |
|----------|------|
| macOS / Linux | `~/.config/dinotty/themes/` |
| Windows | `%APPDATA%\dinotty\themes\` |
| Linux server | `/var/lib/dinotty/themes/` |

One JSON file per theme, directly editable or backup-able.

## Next Steps

- [Mobile Keyboard & Shortcuts](mobile-keyboard) - Font size affects keyboard height
- [File Editor](../features/file-editor) - Editor colors follow theme
- [Multi-device Sync & Mission Control](multi-device-sync) - Themes shared across devices
