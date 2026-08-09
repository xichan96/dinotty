import { computed, reactive, readonly, type WritableComputedRef } from 'vue'

export const IME_KEYBOARD_OVERLAP_MIN = 0
export const IME_KEYBOARD_OVERLAP_MAX = 300

const STORAGE_KEY = 'dinotty.device-keyboard.v2'
const LEGACY_STORAGE_KEY = 'dinotty.device-keyboard.v1'
const STORAGE_VERSION = 2

interface DeviceKeyboardSettings {
  ime_keyboard_overlap_px: number
}

const defaults: DeviceKeyboardSettings = {
  ime_keyboard_overlap_px: 0,
}

const settings = reactive<DeviceKeyboardSettings>({ ...defaults })
let loaded = false

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

function normalizeOverlapPx(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  return Math.round(clamp(value, IME_KEYBOARD_OVERLAP_MIN, IME_KEYBOARD_OVERLAP_MAX))
}

function resetToDefaults() {
  settings.ime_keyboard_overlap_px = defaults.ime_keyboard_overlap_px
}

function removeStoredSettings(key = STORAGE_KEY) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(key)
  } catch {}
}

function persistSettings() {
  if (typeof window === 'undefined') return
  try {
    if (settings.ime_keyboard_overlap_px === defaults.ime_keyboard_overlap_px) {
      window.localStorage.removeItem(STORAGE_KEY)
    } else {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ version: STORAGE_VERSION, settings: { ...settings } })
      )
    }
    window.localStorage.removeItem(LEGACY_STORAGE_KEY)
  } catch {}
}

function parseSettings(raw: string, expectedVersion: 1 | 2): DeviceKeyboardSettings | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }

  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    Array.isArray(parsed) ||
    (parsed as { version?: unknown }).version !== expectedVersion ||
    typeof (parsed as { settings?: unknown }).settings !== 'object' ||
    (parsed as { settings?: unknown }).settings === null ||
    Array.isArray((parsed as { settings?: unknown }).settings)
  ) {
    return null
  }

  const stored = (parsed as { settings: Record<string, unknown> }).settings
  const overlapPx = normalizeOverlapPx(stored.ime_keyboard_overlap_px)
  if (overlapPx === undefined) return null

  return { ime_keyboard_overlap_px: overlapPx }
}

function loadStoredSettings() {
  resetToDefaults()
  if (typeof window === 'undefined') return

  let raw: string | null
  try {
    raw = window.localStorage.getItem(STORAGE_KEY)
  } catch {
    return
  }

  if (raw !== null) {
    const stored = parseSettings(raw, STORAGE_VERSION)
    if (!stored) {
      removeStoredSettings()
      return
    }
    Object.assign(settings, stored)
    persistSettings()
    return
  }

  let legacyRaw: string | null
  try {
    legacyRaw = window.localStorage.getItem(LEGACY_STORAGE_KEY)
  } catch {
    return
  }
  if (legacyRaw === null) return

  const migrated = parseSettings(legacyRaw, 1)
  if (!migrated) {
    removeStoredSettings(LEGACY_STORAGE_KEY)
    return
  }
  Object.assign(settings, migrated)
  persistSettings()
}

function ensureLoaded() {
  if (loaded) return
  loaded = true
  loadStoredSettings()
}

ensureLoaded()

export function setImeKeyboardOverlapPx(value: unknown) {
  const normalized = normalizeOverlapPx(value)
  if (normalized === undefined) return
  settings.ime_keyboard_overlap_px = normalized
  persistSettings()
}

export function reloadDeviceKeyboardSettings() {
  loaded = true
  loadStoredSettings()
}

export const imeKeyboardOverlapPx: WritableComputedRef<number> = computed({
  get: () => settings.ime_keyboard_overlap_px,
  set: setImeKeyboardOverlapPx,
})

export function useDeviceKeyboardSettings() {
  ensureLoaded()
  return {
    settings: readonly(settings),
    imeKeyboardOverlapPx,
    setImeKeyboardOverlapPx,
    reloadDeviceKeyboardSettings,
  }
}
