import { ref, type Ref } from 'vue'
import {
  cloneSystemKeyboardWithoutIcons,
  currentLoadGeneration,
  effectiveSystemKeyboard,
  isLoadInFlight,
  type ActionKey,
  type SettingsData,
  type SystemKeyboardConfig,
} from './useSettings'
import { akResolveDropIndex } from './useActionKeyboardGesture'
import {
  createOrderedKeyRegistry,
  quantizedGestureValue,
  resolveLiveGestureLocation,
} from './orderedKeyGesture'
import {
  SYSTEM_ROW_UNITS,
  UPPER_USER_UNITS,
  canonicalLowerKeys,
  systemKeyboardCandidateAllowed,
  systemKeyUnits,
} from '../utils/systemKeyboardLayout'

export type SystemKeyboardLoc = {
  region: 'upper' | 'lower'
  index: number
}

function rowAt(config: SystemKeyboardConfig, loc: SystemKeyboardLoc): ActionKey[] | undefined {
  return loc.region === 'upper' ? config.upper : config.pages[0]
}

export function moveSystemKeyboardKey(
  config: SystemKeyboardConfig,
  source: SystemKeyboardLoc,
  target: SystemKeyboardLoc
): boolean {
  if (source.region !== target.region) return false
  const row = rowAt(config, source)
  const targetRow = rowAt(config, target)
  if (!row || row !== targetRow || !row[source.index]) return false

  const [key] = row.splice(source.index, 1)
  let insertIndex = target.index
  if (insertIndex > source.index) insertIndex--
  insertIndex = Math.max(0, Math.min(insertIndex, row.length))
  row.splice(insertIndex, 0, key)
  target.index = insertIndex
  return true
}

export function resizeSystemKey(
  config: SystemKeyboardConfig,
  loc: SystemKeyboardLoc,
  startGrow: number,
  deltaX: number
): boolean {
  const key = rowAt(config, loc)?.[loc.index]
  if (!key) return false
  const next = quantizedGestureValue(startGrow, deltaX, {
    min: 1,
    max: loc.region === 'upper' ? UPPER_USER_UNITS : SYSTEM_ROW_UNITS,
    step: 1,
    pixelsPerStep: 28,
  })
  if (key.grow === next) return false
  key.grow = next
  return true
}

type SystemGestureBase = {
  pointerId: number
  captureEl: HTMLElement
  generation: number
  source: SystemKeyboardConfig
  draft: SystemKeyboardConfig
}

type SystemGesture = SystemGestureBase &
  (
    | { kind: 'drag'; current: SystemKeyboardLoc; changed: boolean }
    | {
        kind: 'resize'
        loc: SystemKeyboardLoc
        startX: number
        startGrow: number
        changed: boolean
      }
  )

export function useSystemKeyboardGesture(opts: {
  draft: Ref<SystemKeyboardConfig | null>
  settings: SettingsData
}) {
  const registry = createOrderedKeyRegistry('system-key')
  const draggedKey = ref<string | null>(null)
  let gesture: SystemGesture | null = null

  function itemKey(key: ActionKey): string {
    return registry.itemKey(key)
  }

  function liveLocFromTarget(fallback: SystemKeyboardLoc, e: PointerEvent): SystemKeyboardLoc {
    return resolveLiveGestureLocation(fallback, e, '[data-system-index]', (slot) => {
      const region = slot.getAttribute('data-system-region')
      const index = Number(slot.getAttribute('data-system-index'))
      if ((region !== 'upper' && region !== 'lower') || !Number.isInteger(index) || index < 0) {
        return null
      }
      const loc: SystemKeyboardLoc = { region, index }
      return rowAt(effectiveSystemKeyboard(), loc)?.[index] ? loc : null
    })
  }

  function start(
    e: PointerEvent
  ): { source: SystemKeyboardConfig; draft: SystemKeyboardConfig; captureEl: HTMLElement } | null {
    if (e.button !== 0 || gesture || isLoadInFlight()) return null
    e.preventDefault()
    e.stopPropagation()
    const source = effectiveSystemKeyboard()
    const draft = cloneSystemKeyboardWithoutIcons(source)
    registry.transferRows([source.upper, canonicalLowerKeys(source)], [draft.upper, draft.pages[0]])
    const captureEl = e.currentTarget as HTMLElement
    captureEl.setPointerCapture(e.pointerId)
    opts.draft.value = draft
    return { source, draft: opts.draft.value, captureEl }
  }

  function activate(next: SystemGesture) {
    gesture = next
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onCancel)
  }

  function locFromElement(element: Element, needsIndex: boolean): SystemKeyboardLoc | null {
    const region = element.getAttribute('data-system-region')
    if (region !== 'upper' && region !== 'lower') return null
    const draft = opts.draft.value
    if (!draft) return null
    const row = region === 'upper' ? draft.upper : draft.pages[0]
    const indexValue = element.getAttribute(
      needsIndex ? 'data-system-index' : 'data-system-page-end'
    )
    if (!needsIndex && indexValue === null) return { region, index: row.length }
    if (indexValue === null) return null
    const index = Number(indexValue)
    if (!Number.isInteger(index) || index < 0 || index > row.length) return null
    if (needsIndex && index === row.length) return null
    return { region, index }
  }

  function dropTarget(e: PointerEvent, current: SystemKeyboardLoc): SystemKeyboardLoc | null {
    const hit = document.elementFromPoint(e.clientX, e.clientY)
    if (!hit) return null
    const slot = hit.closest('[data-system-index]')
    if (slot) {
      const loc = locFromElement(slot, true)
      if (!loc || loc.region !== current.region) return null
      const rect = slot.getBoundingClientRect()
      const direction =
        loc.index < current.index ? 'before' : loc.index > current.index ? 'after' : 'unknown'
      loc.index = akResolveDropIndex(e.clientX, rect, loc.index, direction)
      return loc
    }
    const row = hit.closest('[data-system-region]')
    const loc = row ? locFromElement(row, false) : null
    return loc?.region === current.region ? loc : null
  }

  function onMove(e: PointerEvent) {
    const active = gesture
    if (!active || active.pointerId !== e.pointerId) return
    e.preventDefault()
    if (active.kind === 'resize') {
      const row = rowAt(active.draft, active.loc)
      const key = row?.[active.loc.index]
      if (!key) return
      const previousGrow = key.grow
      const changed = resizeSystemKey(
        active.draft,
        active.loc,
        active.startGrow,
        e.clientX - active.startX
      )
      if (changed && !systemKeyboardCandidateAllowed(active.source, active.draft)) {
        key.grow = previousGrow
        return
      }
      active.changed = changed || active.changed
      return
    }
    const target = dropTarget(e, active.current)
    if (target && moveSystemKeyboardKey(active.draft, active.current, target)) {
      active.current = { ...target }
      active.changed = true
    }
  }

  function cleanup(active: SystemGesture) {
    try {
      active.captureEl.releasePointerCapture(active.pointerId)
    } catch {}
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
    window.removeEventListener('pointercancel', onCancel)
    gesture = null
    draggedKey.value = null
    opts.draft.value = null
  }

  function finish(e: PointerEvent, cancelled: boolean) {
    const active = gesture
    if (!active || active.pointerId !== e.pointerId) return
    const canCommit =
      !cancelled &&
      active.changed &&
      currentLoadGeneration() === active.generation &&
      systemKeyboardCandidateAllowed(active.source, active.draft)
    cleanup(active)
    if (canCommit) opts.settings.system_keyboard = active.draft
  }

  function onUp(e: PointerEvent) {
    finish(e, false)
  }

  function onCancel(e: PointerEvent) {
    finish(e, true)
  }

  function dragPointerDown(loc: SystemKeyboardLoc, e: PointerEvent) {
    loc = liveLocFromTarget(loc, e)
    const started = start(e)
    if (!started) return
    const key = rowAt(started.draft, loc)?.[loc.index]
    if (!key) {
      started.captureEl.releasePointerCapture(e.pointerId)
      opts.draft.value = null
      return
    }
    draggedKey.value = registry.itemKey(key)
    activate({
      ...started,
      kind: 'drag',
      pointerId: e.pointerId,
      generation: currentLoadGeneration(),
      current: { ...loc },
      changed: false,
    })
  }

  function resizePointerDown(locOrIndex: SystemKeyboardLoc | number, e: PointerEvent) {
    let loc =
      typeof locOrIndex === 'number' ? { region: 'upper' as const, index: locOrIndex } : locOrIndex
    loc = liveLocFromTarget(loc, e)
    const key = rowAt(effectiveSystemKeyboard(), loc)?.[loc.index]
    if (!key || key.grow == null) return
    const started = start(e)
    if (!started) return
    const draftKey = rowAt(started.draft, loc)![loc.index]
    activate({
      ...started,
      kind: 'resize',
      pointerId: e.pointerId,
      generation: currentLoadGeneration(),
      loc,
      startX: e.clientX,
      startGrow: systemKeyUnits(
        draftKey,
        loc.region === 'upper' ? UPPER_USER_UNITS : SYSTEM_ROW_UNITS
      ),
      changed: false,
    })
  }

  function abort() {
    if (gesture) cleanup(gesture)
  }

  return { itemKey, draggedKey, dragPointerDown, resizePointerDown, abort }
}
