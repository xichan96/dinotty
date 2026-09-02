import { computed, reactive, readonly, watch, type WritableComputedRef } from 'vue'

/** Where the tab bar sits relative to the terminal content. */
export type TabPlacementMode = 'top' | 'bottom' | 'left' | 'right'

export interface TabPlacement {
  mode: TabPlacementMode
  sidebarWidth: number
}

export const TAB_PLACEMENT_MODES: readonly TabPlacementMode[] = [
  'top',
  'bottom',
  'left',
  'right',
] as const

export const DEFAULT_MODE: TabPlacementMode = 'top'
export const SIDEBAR_WIDTH_DEFAULT = 180
export const SIDEBAR_WIDTH_MIN = 120
export const SIDEBAR_WIDTH_MAX = 480

const STORAGE_KEY = 'dinotty_device_tab_placement_v1'

/**
 * Device-scoped tab bar placement, mirroring useDeviceThemeSelection and
 * useDeviceTextSettings: the value lives in localStorage only, so the same
 * account can use a different layout on each browser/device. Nothing here
 * touches the server-side settings.json.
 */
const state = reactive<TabPlacement>({
  mode: DEFAULT_MODE,
  sidebarWidth: SIDEBAR_WIDTH_DEFAULT,
})
let loaded = false

export function isVerticalPlacement(mode: TabPlacementMode): boolean {
  return mode === 'left' || mode === 'right'
}

function isValidMode(value: unknown): value is TabPlacementMode {
  return TAB_PLACEMENT_MODES.includes(value as TabPlacementMode)
}

/**
 * Keep the sidebar inside [MIN, MAX] and never wider than half the viewport,
 * so a narrow window cannot leave the terminal with no room. The MIN floor
 * wins over the viewport cap on very small screens.
 */
export function clampSidebarWidth(value: number): number {
  const viewportCap =
    typeof window === 'undefined' || !Number.isFinite(window.innerWidth)
      ? SIDEBAR_WIDTH_MAX
      : window.innerWidth / 2
  const upper = Math.max(SIDEBAR_WIDTH_MIN, Math.min(SIDEBAR_WIDTH_MAX, viewportCap))
  return Math.round(Math.max(SIDEBAR_WIDTH_MIN, Math.min(upper, value)))
}

function isDefaultPlacement(): boolean {
  return state.mode === DEFAULT_MODE && state.sidebarWidth === SIDEBAR_WIDTH_DEFAULT
}

function resetToDefaults() {
  state.mode = DEFAULT_MODE
  state.sidebarWidth = SIDEBAR_WIDTH_DEFAULT
}

function removeStored() {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(STORAGE_KEY)
  } catch {
    // Storage unavailable (private mode, blocked cookies) — memory state stands.
  }
}

function persist() {
  if (typeof window === 'undefined') return
  try {
    if (isDefaultPlacement()) {
      window.localStorage.removeItem(STORAGE_KEY)
      return
    }
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        version: 1,
        placement: { mode: state.mode, sidebarWidth: state.sidebarWidth },
      })
    )
  } catch {
    // Quota exceeded or storage blocked: keep the in-memory choice for this
    // session rather than reverting the layout under the user.
  }
}

function loadStored() {
  resetToDefaults()
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
    Array.isArray(parsed) ||
    (parsed as { version?: unknown }).version !== 1 ||
    typeof (parsed as { placement?: unknown }).placement !== 'object' ||
    (parsed as { placement?: unknown }).placement === null ||
    Array.isArray((parsed as { placement?: unknown }).placement)
  ) {
    removeStored()
    return
  }

  const stored = (parsed as { placement: Record<string, unknown> }).placement
  if (isValidMode(stored.mode)) state.mode = stored.mode
  if (typeof stored.sidebarWidth === 'number' && Number.isFinite(stored.sidebarWidth)) {
    state.sidebarWidth = clampSidebarWidth(stored.sidebarWidth)
  }
  // Rewrite so a clamped or partially-invalid entry settles to its canonical form.
  persist()
}

function ensureLoaded() {
  if (loaded) return
  loaded = true
  loadStored()
}

ensureLoaded()

export const placement = computed<TabPlacement>(() => ({
  mode: state.mode,
  sidebarWidth: state.sidebarWidth,
}))

export const isVertical = computed(() => isVerticalPlacement(state.mode))

const listeners = new Set<(p: TabPlacement) => void>()

watch(
  placement,
  (p) => {
    listeners.forEach((fn) => fn(p))
  },
  { flush: 'sync' }
)

/** Subscribe to layout changes — used to re-fit terminals after a switch. */
export function onPlacementChange(fn: (p: TabPlacement) => void) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function setMode(mode: TabPlacementMode) {
  if (!isValidMode(mode)) return
  state.mode = mode
  persist()
}

export function setSidebarWidth(width: number) {
  if (typeof width !== 'number' || !Number.isFinite(width)) return
  state.sidebarWidth = clampSidebarWidth(width)
  persist()
}

export function hasPlacementOverride(): boolean {
  ensureLoaded()
  return !isDefaultPlacement()
}

export function resetPlacement() {
  resetToDefaults()
  persist()
}

export function reloadPlacement() {
  loaded = true
  loadStored()
}

export function getEffectivePlacement(): TabPlacement {
  ensureLoaded()
  return { mode: state.mode, sidebarWidth: state.sidebarWidth }
}

const mode: WritableComputedRef<TabPlacementMode> = computed({
  get: () => state.mode,
  set: (value) => setMode(value),
})

const sidebarWidth: WritableComputedRef<number> = computed({
  get: () => state.sidebarWidth,
  set: (value) => setSidebarWidth(value),
})

export function useTabPlacement() {
  ensureLoaded()
  return {
    placement: readonly(state),
    mode,
    sidebarWidth,
    isVertical,
    setMode,
    setSidebarWidth,
    hasPlacementOverride,
    resetPlacement,
    reloadPlacement,
    onPlacementChange,
  }
}
