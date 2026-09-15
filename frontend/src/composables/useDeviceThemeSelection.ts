import { computed, reactive, readonly, watch, type ComputedRef } from 'vue'
import { fillDefaults, getThemeByName, getThemeByNameStrict } from '../themes'
import { settings, type SettingsData } from './useSettings'
import { themePacks } from './useThemePacks'

export interface ThemeColors {
  foreground: string
  background: string
  cursor: string
  ansi: string[] // 16
}
export interface SavedTheme {
  uuid: string
  name: string
  colors: ThemeColors
}
/**
 * Which theme this device is showing.
 *
 * Three sources, and they are genuinely different things rather than three
 * spellings of one:
 *
 * - `builtin` — one of the 12 compiled-in themes, hidden by `hidden_builtins`.
 * - `custom` — the user's own editable theme, from `settings.custom_themes`.
 * - `installed` — a theme file installed on the *server*, shared by every
 *   device attached to it and read-only on this one. Identified by its file,
 *   not by a uuid, because that is what the delete route takes.
 */
export type Selection =
  | { kind: 'builtin'; name: string }
  | { kind: 'custom'; uuid: string }
  | { kind: 'installed'; id: string }
export interface ResolvedTheme {
  colors: Record<string, string>
  source: Selection | 'server-default'
}

const STORAGE_KEY = 'dinotty_device_theme_v1'
const ANSI_KEYS = [
  '--color-black',
  '--color-red',
  '--color-green',
  '--color-yellow',
  '--color-blue',
  '--color-magenta',
  '--color-cyan',
  '--color-white',
  '--color-bright-black',
  '--color-bright-red',
  '--color-bright-green',
  '--color-bright-yellow',
  '--color-bright-blue',
  '--color-bright-magenta',
  '--color-bright-cyan',
  '--color-bright-white',
] as const

const selectionState = reactive<{ selection: Selection | null }>({ selection: null })
let loaded = false

function removeStored() {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(STORAGE_KEY)
  } catch {}
}
function persistSelection() {
  if (typeof window === 'undefined') return
  try {
    if (selectionState.selection === null) window.localStorage.removeItem(STORAGE_KEY)
    else
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ version: 1, selection: selectionState.selection })
      )
  } catch {
    // R6/A6: storage unavailable or quota exceeded; do not keep a device-inconsistent selection.
    selectionState.selection = null
  }
}
function isValidSelection(s: unknown): s is Selection {
  if (typeof s !== 'object' || s === null) return false
  const t = s as Record<string, unknown>
  if (t.kind === 'builtin') return typeof t.name === 'string'
  if (t.kind === 'custom') return typeof t.uuid === 'string'
  if (t.kind === 'installed') return typeof t.id === 'string'
  return false
}
function loadStored() {
  selectionState.selection = null
  if (typeof window === 'undefined') return
  let raw: string | null
  try {
    raw = window.localStorage.getItem(STORAGE_KEY)
  } catch {
    return
  }
  if (raw === null) return
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    removeStored()
    return
  }
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    (parsed as { version?: unknown }).version !== 1
  ) {
    removeStored()
    return
  }
  const sel = (parsed as { selection?: unknown }).selection
  if (sel === null) {
    selectionState.selection = null
    return
  }
  if (isValidSelection(sel)) selectionState.selection = sel
  else removeStored()
}
function ensureLoaded() {
  if (loaded) return
  loaded = true
  loadStored()
}
ensureLoaded()

/**
 * Expand a saved or installed theme's 19 colours into the full variable set.
 *
 * Takes the shape rather than a `SavedTheme` because an installed theme has no
 * `uuid` — its identity is its filename — and both kinds are reduced to
 * colours the same way.
 */
export function buildCustomThemeColors(saved: {
  name: string
  colors: ThemeColors
}): Record<string, string> {
  const base: Record<string, string> = {
    '--bg': saved.colors.background,
    '--fg': saved.colors.foreground,
    '--cursor': saved.colors.cursor,
  }
  saved.colors.ansi.forEach((c, i) => {
    if (ANSI_KEYS[i] && c) base[ANSI_KEYS[i]] = c
  })
  return fillDefaults({ name: 'custom', label: saved.name, colors: base }).colors
}

function serverDefaultColors(
  preset: string,
  legacyCustom: SettingsData['theme']['custom']
): Record<string, string> {
  const colors: Record<string, string> = { ...getThemeByName(preset).colors }
  if (legacyCustom) {
    if (legacyCustom.foreground) colors['--fg'] = legacyCustom.foreground
    if (legacyCustom.background) colors['--bg'] = legacyCustom.background
    if (legacyCustom.cursor) {
      colors['--fg-muted'] = legacyCustom.cursor
      colors['--cursor'] = legacyCustom.cursor
    }
    if (legacyCustom.ansi)
      legacyCustom.ansi.forEach((c, i) => {
        if (c && ANSI_KEYS[i]) colors[ANSI_KEYS[i]] = c
      })
  }
  return colors
}

export function resolveTheme(input: {
  selection: Selection | null
  preset: string
  legacyCustom: SettingsData['theme']['custom']
  customThemes: SavedTheme[]
  installedThemes: { id: string; name: string; colors: ThemeColors }[]
  hiddenBuiltins: string[]
}): ResolvedTheme {
  const { selection } = input
  if (selection) {
    if (selection.kind === 'builtin') {
      if (!input.hiddenBuiltins.includes(selection.name)) {
        const strict = getThemeByNameStrict(selection.name)
        if (strict) return { colors: strict.colors, source: selection }
      }
    } else if (selection.kind === 'custom') {
      const found = input.customThemes.find((t) => t.uuid === selection.uuid)
      if (found) return { colors: buildCustomThemeColors(found), source: selection }
    } else {
      const found = input.installedThemes.find((t) => t.id === selection.id)
      if (found) return { colors: buildCustomThemeColors(found), source: selection }
    }
  }
  // A selection that resolves to nothing — a theme since removed, or one whose
  // load has not landed yet — falls back to the server default rather than
  // throwing. The watcher below re-resolves when the list arrives.
  return { colors: serverDefaultColors(input.preset, input.legacyCustom), source: 'server-default' }
}

export function resolveEffectiveTheme(): ResolvedTheme {
  ensureWatch()
  ensureLoaded()
  return resolveTheme({
    selection: selectionState.selection,
    preset: settings.theme.preset,
    legacyCustom: settings.theme.custom,
    customThemes: settings.custom_themes,
    // Reactive, so a device showing an installed theme re-applies it when the
    // list lands after first paint.
    installedThemes: themePacks.installed,
    hiddenBuiltins: settings.hidden_builtins,
  })
}

export const effectiveTheme: ComputedRef<ResolvedTheme> = computed(() => resolveEffectiveTheme())

const listeners = new Set<(t: ResolvedTheme) => void>()
let watchStarted = false
function ensureWatch() {
  if (watchStarted) return
  watchStarted = true
  watch(
    effectiveTheme,
    (t) => {
      listeners.forEach((fn) => fn(t))
    },
    { flush: 'sync' }
  )
}

export function onEffectiveThemeChange(fn: (t: ResolvedTheme) => void) {
  ensureWatch()
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function setThemeSelection(sel: Selection | null) {
  ensureWatch()
  selectionState.selection = sel
  persistSelection()
}
export function getThemeSelection(): Selection | null {
  ensureWatch()
  ensureLoaded()
  return selectionState.selection
}
export function clearThemeSelection() {
  setThemeSelection(null)
}

export function reloadThemeSelection() {
  loaded = true
  loadStored()
}

export function useDeviceThemeSelection() {
  ensureWatch()
  ensureLoaded()
  return {
    selection: readonly(selectionState),
    effectiveTheme,
    resolveEffectiveTheme,
    setThemeSelection,
    getThemeSelection,
    clearThemeSelection,
    onEffectiveThemeChange,
    reloadThemeSelection,
  }
}
