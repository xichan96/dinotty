import { computed, reactive, readonly, type WritableComputedRef } from 'vue'
import { settings, type SettingsData } from './useSettings'

const STORAGE_KEY = 'dinotty_device_supervise_reload_v1'

type DeviceSuperviseReloadOverrides = Partial<
  Pick<SettingsData, 'reload_after_supervise_tabs'>
>

const overrides = reactive<DeviceSuperviseReloadOverrides>({})
let loaded = false

function clearOverrides() {
  delete overrides.reload_after_supervise_tabs
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
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ version: 1, overrides: { ...overrides } }),
      )
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
  if (typeof stored.reload_after_supervise_tabs === 'boolean') {
    overrides.reload_after_supervise_tabs = stored.reload_after_supervise_tabs
    persistOverrides()
  } else {
    removeStoredOverrides()
  }
}

function ensureLoaded() {
  if (loaded) return
  loaded = true
  loadStoredOverrides()
}

ensureLoaded()

const effectiveSuperviseReload = computed(
  () => overrides.reload_after_supervise_tabs ?? settings.reload_after_supervise_tabs,
)

export function setOverride(value: boolean) {
  if (typeof value !== 'boolean') return
  overrides.reload_after_supervise_tabs = value
  persistOverrides()
}

export function hasOverride() {
  return Object.prototype.hasOwnProperty.call(overrides, 'reload_after_supervise_tabs')
}

export function resetOverride() {
  clearOverrides()
  persistOverrides()
}

export function reloadOverrides() {
  loaded = true
  loadStoredOverrides()
}

export function getEffectiveSuperviseReload() {
  ensureLoaded()
  return effectiveSuperviseReload.value
}

const reloadAfterSuperviseTabs: WritableComputedRef<boolean> = computed({
  get: () => effectiveSuperviseReload.value,
  set: (value) => setOverride(value),
})

export function useDeviceSuperviseReload() {
  ensureLoaded()
  return {
    overrides: readonly(overrides),
    effectiveSuperviseReload,
    reloadAfterSuperviseTabs,
    hasOverride,
    setOverride,
    resetOverride,
    reloadOverrides,
  }
}
