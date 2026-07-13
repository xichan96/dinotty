import { computed, reactive, readonly, watch, type ComputedRef } from 'vue'
import { fillDefaults, getThemeByName, getThemeByNameStrict } from '../themes'
import { settings, type SettingsData } from './useSettings'

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
export type Selection =
  | { kind: 'builtin'; name: string }
  | { kind: 'custom'; uuid: string }
export interface ResolvedTheme {
  colors: Record<string, string>
  source: Selection | 'server-default'
}

const STORAGE_KEY = 'dinotty_device_theme_v1'
const ANSI_KEYS = [
  '--color-black','--color-red','--color-green','--color-yellow','--color-blue',
  '--color-magenta','--color-cyan','--color-white','--color-bright-black','--color-bright-red',
  '--color-bright-green','--color-bright-yellow','--color-bright-blue','--color-bright-magenta',
  '--color-bright-cyan','--color-bright-white',
] as const

const selectionState = reactive<{ selection: Selection | null }>({ selection: null })
let loaded = false

function removeStored() {
  if (typeof window === 'undefined') return
  try { window.localStorage.removeItem(STORAGE_KEY) } catch {}
}
function persistSelection() {
  if (typeof window === 'undefined') return
  try {
    if (selectionState.selection === null) window.localStorage.removeItem(STORAGE_KEY)
    else window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, selection: selectionState.selection }))
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
  return false
}
function loadStored() {
  selectionState.selection = null
  if (typeof window === 'undefined') return
  let raw: string | null
  try { raw = window.localStorage.getItem(STORAGE_KEY) } catch { return }
  if (raw === null) return
  let parsed: unknown
  try { parsed = JSON.parse(raw) } catch { removeStored(); return }
  if (typeof parsed !== 'object' || parsed === null || (parsed as { version?: unknown }).version !== 1) { removeStored(); return }
  const sel = (parsed as { selection?: unknown }).selection
  if (sel === null) { selectionState.selection = null; return }
  if (isValidSelection(sel)) selectionState.selection = sel
  else removeStored()
}
function ensureLoaded() { if (loaded) return; loaded = true; loadStored() }
ensureLoaded()

export function buildCustomThemeColors(saved: SavedTheme): Record<string, string> {
  const base: Record<string, string> = {
    '--bg': saved.colors.background,
    '--fg': saved.colors.foreground,
    '--cursor': saved.colors.cursor,
  }
  saved.colors.ansi.forEach((c, i) => { if (ANSI_KEYS[i] && c) base[ANSI_KEYS[i]] = c })
  return fillDefaults({ name: 'custom', label: saved.name, colors: base }).colors
}

function serverDefaultColors(preset: string, legacyCustom: SettingsData['theme']['custom']): Record<string, string> {
  const colors: Record<string, string> = { ...getThemeByName(preset).colors }
  if (legacyCustom) {
    if (legacyCustom.foreground) colors['--fg'] = legacyCustom.foreground
    if (legacyCustom.background) colors['--bg'] = legacyCustom.background
    if (legacyCustom.cursor) { colors['--fg-muted'] = legacyCustom.cursor; colors['--cursor'] = legacyCustom.cursor }
    if (legacyCustom.ansi) legacyCustom.ansi.forEach((c, i) => { if (c && ANSI_KEYS[i]) colors[ANSI_KEYS[i]] = c })
  }
  return colors
}

export function resolveTheme(input: {
  selection: Selection | null
  preset: string
  legacyCustom: SettingsData['theme']['custom']
  customThemes: SavedTheme[]
  hiddenBuiltins: string[]
}): ResolvedTheme {
  const { selection } = input
  if (selection) {
    if (selection.kind === 'builtin') {
      if (!input.hiddenBuiltins.includes(selection.name)) {
        const strict = getThemeByNameStrict(selection.name)
        if (strict) return { colors: strict.colors, source: selection }
      }
    } else {
      const found = input.customThemes.find((t) => t.uuid === selection.uuid)
      if (found) return { colors: buildCustomThemeColors(found), source: selection }
    }
  }
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
    hiddenBuiltins: settings.hidden_builtins,
  })
}

export const effectiveTheme: ComputedRef<ResolvedTheme> = computed(() => resolveEffectiveTheme())

const listeners = new Set<(t: ResolvedTheme) => void>()
let watchStarted = false
function ensureWatch() {
  if (watchStarted) return
  watchStarted = true
  watch(effectiveTheme, (t) => { listeners.forEach((fn) => fn(t)) }, { flush: 'sync' })
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
export function clearThemeSelection() { setThemeSelection(null) }

export function reloadThemeSelection() { loaded = true; loadStored() }

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
