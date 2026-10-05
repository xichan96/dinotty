/**
 * The install half of theme files: the id a file would land under, and the
 * canonical body to post.
 *
 * Parsing lives in `utils/themeImport.ts` and is not duplicated here — that
 * module already sniffs JSON from Ghostty `.conf`, which is what the server's
 * read path serves. This module only decides *where* a theme goes and in what
 * shape it is sent.
 *
 * A theme file is untrusted input: it is a file the user, or anything else on
 * the machine, can write. Two rules apply, both inherited from `themeImport.ts`
 * and `composables/i18n/localePack.ts`:
 *
 * 1. **Never `import()` one.** It is data, read with `JSON.parse` and nothing
 *    else; evaluating a dropped file as a module is arbitrary code execution.
 *
 * 2. **Validate, don't trust.** Hand-rolled rather than regex-driven, because
 *    these inputs are attacker-shaped and a regex is where ReDoS lives. This is
 *    a *usability* boundary — the server revalidates and rewrites whatever it
 *    is sent, and a client can post without ever running any of this.
 */

import type { ThemeColors } from '../composables/useDeviceThemeSelection'

/**
 * Mirrors `MAX_ID_LEN` in `src/settings/themes.rs`.
 *
 * The id becomes a filename on the server, so both ends enforce the same
 * shape. The server's copy is the one that matters — this one exists so the
 * user is told before a round-trip.
 */
const MAX_THEME_ID_LENGTH = 64

/** Mirrors `MAX_THEME_BYTES` in `src/settings/themes.rs`. */
export const MAX_THEME_BYTES = 64 * 1024

/**
 * Whether `id` is usable as a theme id.
 *
 * Character-by-character rather than a regex (see the module note). The rules
 * are the server's `is_valid_theme_id`: letters, digits and single dashes, no
 * leading or trailing dash, 2-64 characters — which is exactly "safe as a
 * filename component" with enough room for `catppuccin-mocha`.
 */
export function isValidThemeId(id: string): boolean {
  if (id.length < 2 || id.length > MAX_THEME_ID_LENGTH) return false
  if (id.startsWith('-') || id.endsWith('-')) return false

  let lastWasDash = false
  for (const ch of id) {
    if (ch === '-') {
      if (lastWasDash) return false
      lastWasDash = true
      continue
    }
    lastWasDash = false
    const isLower = ch >= 'a' && ch <= 'z'
    const isUpper = ch >= 'A' && ch <= 'Z'
    const isDigit = ch >= '0' && ch <= '9'
    if (!isLower && !isUpper && !isDigit) return false
  }
  return true
}

/**
 * The last path segment of a filename, without a regex.
 *
 * Browsers post a bare name from `<input type="file">`, but some platforms post
 * a fake path (`C:\fakepath\nord.json`), so the basename has to be taken before
 * anything else looks at it. A character sweep rather than `split(/[/\\]/)`:
 * linear by construction, which is the property the no-regex rule is protecting.
 */
function baseName(path: string): string {
  let start = 0
  for (let index = 0; index < path.length; index += 1) {
    const ch = path[index]
    if (ch === '/' || ch === '\\') start = index + 1
  }
  return path.slice(start)
}

/**
 * The id a picked file would install under.
 *
 * Both extensions are stripped because both are readable: `.conf` is what this
 * app's own "Export theme" writes, so a user who exports and re-installs must
 * not end up with an id of `nord.conf` — which the server would reject, since a
 * dot is not a legal id character.
 */
export function themeIdFromFilename(filename: string): string {
  const base = baseName(filename)
  const lower = base.toLowerCase()
  for (const suffix of ['.json', '.conf']) {
    if (lower.endsWith(suffix)) return base.slice(0, base.length - suffix.length)
  }
  return base
}

export interface InstallPayload {
  id: string
  name: string
  colors: {
    foreground: string
    background: string
    cursor: string
    ansi: string[]
  }
}

/**
 * The canonical body for `POST /api/themes`.
 *
 * A picked `.conf` is translated here rather than posted as-is: the server
 * accepts JSON only, because it has to parse what it stores in order to
 * revalidate it, and a second (Rust) Ghostty parser would duplicate
 * `themeImport.ts` for no gain. The security boundary is unchanged — the server
 * still rebuilds whatever JSON it receives from known fields.
 */
export function buildInstallPayload(id: string, name: string, colors: ThemeColors): InstallPayload {
  return {
    id,
    name,
    colors: {
      foreground: colors.foreground,
      background: colors.background,
      cursor: colors.cursor,
      // Exactly 16, always: `parseThemeFile` expands the array to that length,
      // and the server refuses a palette that is not.
      ansi: colors.ansi.slice(0, 16),
    },
  }
}
