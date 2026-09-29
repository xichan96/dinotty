# Appearance & Themes

Dinotty's visual style follows a VSCode-dark muted theme (neutral gray `#8a8a8a`). The built-in theme manager lets you switch themes, adjust fonts, and customize colors.

## Theme Manager

Open Settings -> Appearance; the theme manager is at the top:

- **Theme list**: built-in, installed, and your own custom themes
- **Current theme**: highlighted
- **New theme**: clone from current
- **Import**: add a theme file to your own library
- **Install to server**: upload a theme file for every device on this server to use
- **Export**: save the current theme as a `.conf` file
- **Theme store**: install a theme listed by the configured registry (see below)

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

## Theme Sources

There are three, and they are not interchangeable:

| Source | Stored in | Seen by | Editable |
|--------|-----------|---------|----------|
| Built-in (12) | Compiled into the app | Everyone | No, but can be hidden |
| Installed | `themes/` on the server | Every device on that server | No — remove and reinstall |
| Custom | `settings.json` on the server | Every device on that server | Yes, up to 15 |

Installed themes are deliberately kept out of the 15-theme custom library: they
arrive as shared files rather than as your own work, and would otherwise be
truncated by the cap.

The *current* theme is per device. It is stored locally, so your phone and your
desktop can show different themes while sharing the same library of installed
and custom themes.

## Config Directory

Installed theme files are stored at:

| Platform | Path |
|----------|------|
| macOS / Linux | `~/.config/dinotty/themes/` |
| Windows | `%APPDATA%\dinotty\themes\` |
| Linux server | `/var/lib/dinotty/themes/` |

One file per theme, either `<id>.json` (what the app writes) or a Ghostty
`.conf` (what **Export** produces) — both are picked up, so an exported theme
can be dropped straight back in. Files are read as data and never executed.
They can be edited or backed up by hand.

Your custom themes are *not* here: they live in `settings.json`, because they
are editable settings rather than shared content.

## Theme Store

Installing themes from a remote registry is off until the server is pointed at
one:

```sh
DINOTTY_THEMES_REGISTRY_URL=https://example.com/dinotty/themes/registry.json dinotty
```

The registry is a JSON document:

```json
{
  "schema": 1,
  "themes": [
    {
      "id": "dracula-soft",
      "name": "Dracula Soft",
      "version": "1.0.0",
      "minAppVersion": "0.28.0",
      "url": "https://example.com/dinotty/themes/dracula-soft.json",
      "sha256": "<optional>"
    }
  ]
}
```

The server fetches both the registry and the theme, so a client can only name an
id — it cannot ask the server to fetch an address of its choosing. When an entry
carries a `sha256`, it is checked against the downloaded bytes and a mismatch
refuses the install.

## Next Steps

- [Mobile Keyboard & Shortcuts](mobile-keyboard) - Font size affects keyboard height
- [File Editor](../features/file-editor) - Editor colors follow theme
- [Multi-device Sync & Mission Control](multi-device-sync) - Themes shared across devices
