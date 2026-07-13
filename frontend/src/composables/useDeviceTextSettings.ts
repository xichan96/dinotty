import { computed, reactive, readonly, watch, type WritableComputedRef } from 'vue'
import { settings, type TextConfig } from './useSettings'

export const FONT_SIZE_MIN = 8
export const FONT_SIZE_MAX = 72

const LINE_HEIGHT_MIN = 0.8
const LINE_HEIGHT_MAX = 2
const LETTER_SPACING_MIN = 0
const LETTER_SPACING_MAX = 4
const STORAGE_KEY = 'dinotty_device_text_overrides_v1'

type DeviceTextField = 'font_size' | 'font_family' | 'line_height' | 'letter_spacing'
type DeviceTextOverrides = Partial<Pick<TextConfig, DeviceTextField>>

const overrides = reactive<DeviceTextOverrides>({})
let loaded = false

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

function normalizeOverride(field: DeviceTextField, value: unknown): number | string | undefined {
  if (field === 'font_family') return typeof value === 'string' ? value : undefined
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  if (field === 'font_size') return clamp(value, FONT_SIZE_MIN, FONT_SIZE_MAX)
  if (field === 'line_height') return clamp(value, LINE_HEIGHT_MIN, LINE_HEIGHT_MAX)
  return clamp(value, LETTER_SPACING_MIN, LETTER_SPACING_MAX)
}

function clearOverrides() {
  for (const field of Object.keys(overrides) as DeviceTextField[]) delete overrides[field]
}

function removeStoredOverrides() {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(STORAGE_KEY)
  } catch {}
}

function persistOverrides() {
  if (typeof window === 'undefined') return
  try {
    if (Object.keys(overrides).length === 0) {
      window.localStorage.removeItem(STORAGE_KEY)
    } else {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, overrides: { ...overrides } }))
    }
  } catch {}
}

function loadStoredOverrides() {
  clearOverrides()
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
    removeStoredOverrides()
    return
  }

  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    Array.isArray(parsed) ||
    (parsed as { version?: unknown }).version !== 1 ||
    typeof (parsed as { overrides?: unknown }).overrides !== 'object' ||
    (parsed as { overrides?: unknown }).overrides === null ||
    Array.isArray((parsed as { overrides?: unknown }).overrides)
  ) {
    removeStoredOverrides()
    return
  }

  const stored = (parsed as { overrides: Record<string, unknown> }).overrides
  for (const field of ['font_size', 'font_family', 'line_height', 'letter_spacing'] as const) {
    const value = normalizeOverride(field, stored[field])
    if (value !== undefined) (overrides as Record<DeviceTextField, number | string>)[field] = value
  }
  persistOverrides()
}

function ensureLoaded() {
  if (loaded) return
  loaded = true
  loadStoredOverrides()
}

ensureLoaded()

const effectiveText = computed<TextConfig>(() => ({
  ...settings.text,
  font_size: overrides.font_size ?? settings.text.font_size,
  font_family: overrides.font_family ?? settings.text.font_family,
  line_height: overrides.line_height ?? settings.text.line_height,
  letter_spacing: overrides.letter_spacing ?? settings.text.letter_spacing,
}))

const listeners = new Set<(text: TextConfig) => void>()

watch(
  effectiveText,
  (text) => {
    listeners.forEach((fn) => fn(text))
  },
  { flush: 'sync' },
)

export function setOverride(field: 'font_family', value: string): void
export function setOverride(
  field: Exclude<DeviceTextField, 'font_family'>,
  value: number,
): void
export function setOverride(field: DeviceTextField, value: unknown) {
  const normalized = normalizeOverride(field, value)
  if (normalized === undefined) return
  ;(overrides as Record<DeviceTextField, number | string>)[field] = normalized
  persistOverrides()
}

export function hasOverride(field: DeviceTextField) {
  return Object.prototype.hasOwnProperty.call(overrides, field)
}

export function resetOverride(field: DeviceTextField) {
  delete overrides[field]
  persistOverrides()
}

export function resetAllOverrides() {
  clearOverrides()
  persistOverrides()
}

export function reloadOverrides() {
  loaded = true
  loadStoredOverrides()
}

export function onEffectiveTextChange(fn: (text: TextConfig) => void) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function getEffectiveText() {
  ensureLoaded()
  return effectiveText.value
}

function writableField<K extends DeviceTextField>(field: K): WritableComputedRef<TextConfig[K]> {
  return computed({
    get: () => effectiveText.value[field],
    set: (value) => setOverride(field as never, value as never),
  })
}

const fontSize = writableField('font_size')
const fontFamily = writableField('font_family')
const lineHeight = writableField('line_height')
const letterSpacing = writableField('letter_spacing')

export function useDeviceTextSettings() {
  ensureLoaded()
  return {
    overrides: readonly(overrides),
    effectiveText,
    fontSize,
    fontFamily,
    lineHeight,
    letterSpacing,
    hasOverride,
    setOverride,
    resetOverride,
    resetAllOverrides,
    reloadOverrides,
  }
}
