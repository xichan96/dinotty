import type { Ref } from 'vue'
import {
  cloneWithoutIcons,
  currentLoadGeneration,
  effectiveActionKeyboard,
  isLoadInFlight,
  type ActionKey,
  type ActionKeyboardConfig,
  type SettingsData,
} from './useSettings'
import {
  createOrderedKeyRegistry,
  quantizedGestureValue,
  resolveLiveGestureLocation,
} from './orderedKeyGesture'

export function akDropGripThreshold(width: number): number {
  const GRIP = 16
  return Math.min(GRIP, width / 2)
}

export function akResolveDropIndex(
  pointerX: number,
  rect: { left: number; right: number; width: number },
  targetIndex: number,
  direction: 'before' | 'after' | 'unknown'
): number {
  const threshold = akDropGripThreshold(rect.width)
  if (direction === 'after') {
    return pointerX >= rect.left + threshold ? targetIndex + 1 : targetIndex
  }
  if (direction === 'before') {
    return pointerX <= rect.right - threshold ? targetIndex : targetIndex + 1
  }
  return pointerX >= rect.left + rect.width / 2 ? targetIndex + 1 : targetIndex
}

type AkZone = 'main' | 'bottom'
type AkLoc = { zone: AkZone; row: number; index: number }

interface AkGestureBase {
  pointerId: number
  captureEl: HTMLElement
  generation: number
  draft: ActionKeyboardConfig
  preserveBottomAbsence: boolean
  footerTouched: boolean
}

type AkGesture = AkGestureBase &
  (
    | {
        kind: 'drag'
        currentLoc: AkLoc
        validTargetPreviewed: boolean
      }
    | {
        kind: 'grow'
        loc: AkLoc
        startX: number
        startGrow: number
        changed: boolean
      }
    | {
        kind: 'enter-width'
        startX: number
        startWidth: number
        footerWidth: number
        changed: boolean
      }
  )

export interface ActionKeyboardGestureOptions {
  akDraft: Ref<ActionKeyboardConfig | null>
  settings: SettingsData
}

export interface ActionKeyboardGesture {
  akItemKey: (key: ActionKey) => string
  akDragPointerDown: (loc: AkLoc, e: PointerEvent) => void
  akResizePointerDown: (ri: number, ki: number, e: PointerEvent) => void
  akBottomResizePointerDown: (ri: number, ki: number, e: PointerEvent) => void
  akEnterResizePointerDown: (e: PointerEvent) => void
  akAbortGesture: () => void
}

export function useActionKeyboardGesture(
  opts: ActionKeyboardGestureOptions
): ActionKeyboardGesture {
  const { akDraft, settings } = opts

  const registry = createOrderedKeyRegistry('ak')
  const akItemKey = registry.itemKey

  function akRowsFor(cfg: ActionKeyboardConfig, zone: AkZone): ActionKey[][] {
    return zone === 'main' ? cfg.rows : (cfg.bottom?.rows ?? [])
  }

  function akKeyAt(cfg: ActionKeyboardConfig, loc: AkLoc): ActionKey | undefined {
    return akRowsFor(cfg, loc.zone)[loc.row]?.[loc.index]
  }

  function akLiveLocFromTarget(fallback: AkLoc, e: PointerEvent): AkLoc {
    return resolveLiveGestureLocation(fallback, e, '[data-ak-index]', (slot) => {
      const zone = slot.getAttribute('data-ak-zone')
      const row = Number(slot.getAttribute('data-ak-row'))
      const index = Number(slot.getAttribute('data-ak-index'))
      if (
        (zone !== 'main' && zone !== 'bottom') ||
        !Number.isInteger(row) ||
        row < 0 ||
        !Number.isInteger(index) ||
        index < 0
      ) {
        return null
      }
      const loc: AkLoc = { zone, row, index }
      return akKeyAt(effectiveActionKeyboard(), loc) ? loc : null
    })
  }

  function akTransferItemKeys(source: ActionKeyboardConfig, draft: ActionKeyboardConfig) {
    registry.transferRows(source.rows, draft.rows)
    if (source.bottom && draft.bottom) registry.transferRows(source.bottom.rows, draft.bottom.rows)
  }

  let akGesture: AkGesture | null = null

  function akStartGestureDraft(e: PointerEvent): {
    draft: ActionKeyboardConfig
    captureEl: HTMLElement
    preserveBottomAbsence: boolean
  } | null {
    if (e.button !== 0 || akGesture || isLoadInFlight()) return null

    e.preventDefault()
    e.stopPropagation()
    const source = effectiveActionKeyboard()
    const rawDraft = cloneWithoutIcons(source)
    akTransferItemKeys(source, rawDraft)

    const captureEl = e.currentTarget as HTMLElement
    captureEl.setPointerCapture(e.pointerId)
    akDraft.value = rawDraft
    return {
      draft: akDraft.value,
      captureEl,
      preserveBottomAbsence:
        settings.action_keyboard !== null && settings.action_keyboard.bottom === undefined,
    }
  }

  function akActivateGesture(gesture: AkGesture) {
    akGesture = gesture
    window.addEventListener('pointermove', akGesturePointerMove)
    window.addEventListener('pointerup', akGesturePointerUp)
    window.addEventListener('pointercancel', akGesturePointerCancel)
  }

  function akResolveElementLoc(element: Element, needsIndex: boolean): AkLoc | null {
    const zone = element.getAttribute('data-ak-zone')
    if (zone !== 'main' && zone !== 'bottom') return null

    const rowValue = element.getAttribute('data-ak-row')
    if (rowValue === null) return null
    const row = Number(rowValue)
    if (!Number.isInteger(row) || row < 0) return null
    const rows = akDraft.value ? akRowsFor(akDraft.value, zone) : []
    if (!rows[row]) return null

    if (!needsIndex) return { zone, row, index: rows[row].length }
    const indexValue = element.getAttribute('data-ak-index')
    if (indexValue === null) return null
    const index = Number(indexValue)
    if (!Number.isInteger(index) || index < 0 || index >= rows[row].length) return null
    return { zone, row, index }
  }

  function akResolveDropTarget(e: PointerEvent, currentLoc: AkLoc): AkLoc | null {
    const hit = document.elementFromPoint(e.clientX, e.clientY)
    if (!hit) return null

    const keyElement = hit.closest('[data-ak-index]')
    if (keyElement) {
      const loc = akResolveElementLoc(keyElement, true)
      if (!loc) return null
      const rect = keyElement.getBoundingClientRect()
      const direction =
        loc.zone === currentLoc.zone && loc.row === currentLoc.row
          ? loc.index < currentLoc.index
            ? 'before'
            : loc.index > currentLoc.index
              ? 'after'
              : 'unknown'
          : 'unknown'
      loc.index = akResolveDropIndex(e.clientX, rect, loc.index, direction)
      return loc
    }

    const rowElement = hit.closest('[data-ak-row]')
    return rowElement ? akResolveElementLoc(rowElement, false) : null
  }

  function akMoveDraggedKey(gesture: Extract<AkGesture, { kind: 'drag' }>, target: AkLoc) {
    const source = gesture.currentLoc
    const sourceRow = akRowsFor(gesture.draft, source.zone)[source.row]
    const targetRow = akRowsFor(gesture.draft, target.zone)[target.row]
    if (!sourceRow || !targetRow || !sourceRow[source.index]) return

    const [key] = sourceRow.splice(source.index, 1)
    let insertIndex = target.index
    if (source.zone === target.zone && source.row === target.row && insertIndex > source.index) {
      insertIndex--
    }
    insertIndex = Math.max(0, Math.min(insertIndex, targetRow.length))
    targetRow.splice(insertIndex, 0, key)
    gesture.currentLoc = { zone: target.zone, row: target.row, index: insertIndex }
    gesture.validTargetPreviewed = true
    if (source.zone === 'bottom' || target.zone === 'bottom') gesture.footerTouched = true
  }

  function akGesturePointerMove(e: PointerEvent) {
    const gesture = akGesture
    if (!gesture || e.pointerId !== gesture.pointerId) return
    e.preventDefault()

    if (gesture.kind === 'drag') {
      const target = akResolveDropTarget(e, gesture.currentLoc)
      if (target) akMoveDraggedKey(gesture, target)
      return
    }

    if (gesture.kind === 'grow') {
      const key = akKeyAt(gesture.draft, gesture.loc)
      if (!key) return
      const nextGrow = quantizedGestureValue(gesture.startGrow, e.clientX - gesture.startX, {
        min: 0.5,
        max: 12,
        step: 0.25,
        pixelsPerStep: 7,
      })
      if (key.grow !== nextGrow) {
        key.grow = nextGrow
        gesture.changed = true
        if (gesture.loc.zone === 'bottom') gesture.footerTouched = true
      }
      return
    }

    const bottom = gesture.draft.bottom
    if (!bottom) return
    const nextWidth = Math.min(
      0.5,
      Math.max(0.15, gesture.startWidth - (e.clientX - gesture.startX) / gesture.footerWidth)
    )
    if (bottom.enter_width !== nextWidth) {
      bottom.enter_width = nextWidth
      gesture.changed = true
      gesture.footerTouched = true
    }
  }

  function akCleanupGesture(gesture: AkGesture) {
    try {
      gesture.captureEl.releasePointerCapture(gesture.pointerId)
    } catch {}
    window.removeEventListener('pointermove', akGesturePointerMove)
    window.removeEventListener('pointerup', akGesturePointerUp)
    window.removeEventListener('pointercancel', akGesturePointerCancel)
    akGesture = null
    akDraft.value = null
  }

  function akCommitGestureDraft(gesture: AkGesture) {
    if (gesture.preserveBottomAbsence && !gesture.footerTouched) delete gesture.draft.bottom
    settings.action_keyboard = gesture.draft
  }

  function akFinishGesture(e: PointerEvent, cancelled: boolean) {
    const gesture = akGesture
    if (!gesture || e.pointerId !== gesture.pointerId) return
    const generationMatches = currentLoadGeneration() === gesture.generation
    const hasCommit = gesture.kind === 'drag' ? gesture.validTargetPreviewed : gesture.changed
    akCleanupGesture(gesture)
    if (!cancelled && generationMatches && hasCommit) akCommitGestureDraft(gesture)
  }

  function akGesturePointerUp(e: PointerEvent) {
    akFinishGesture(e, false)
  }

  function akGesturePointerCancel(e: PointerEvent) {
    akFinishGesture(e, true)
  }

  function akAbortGesture() {
    if (akGesture) akCleanupGesture(akGesture)
  }

  function akDragPointerDown(loc: AkLoc, e: PointerEvent) {
    loc = akLiveLocFromTarget(loc, e)
    if (!akKeyAt(effectiveActionKeyboard(), loc)) return
    const started = akStartGestureDraft(e)
    if (!started) return
    akActivateGesture({
      ...started,
      kind: 'drag',
      pointerId: e.pointerId,
      generation: currentLoadGeneration(),
      footerTouched: false,
      currentLoc: { ...loc },
      validTargetPreviewed: false,
    })
  }

  function akResizePointerDown(ri: number, ki: number, e: PointerEvent) {
    const loc = akLiveLocFromTarget({ zone: 'main', row: ri, index: ki }, e)
    const sourceKey = akKeyAt(effectiveActionKeyboard(), loc)
    if (!sourceKey) return
    const started = akStartGestureDraft(e)
    if (!started) return
    const key = akKeyAt(started.draft, loc)!
    akActivateGesture({
      ...started,
      kind: 'grow',
      pointerId: e.pointerId,
      generation: currentLoadGeneration(),
      footerTouched: false,
      loc,
      startX: e.clientX,
      startGrow: key.grow != null && key.grow > 0 ? key.grow : 1,
      changed: false,
    })
  }

  function akBottomResizePointerDown(ri: number, ki: number, e: PointerEvent) {
    const loc = akLiveLocFromTarget({ zone: 'bottom', row: ri, index: ki }, e)
    const sourceKey = akKeyAt(effectiveActionKeyboard(), loc)
    if (!sourceKey) return
    const started = akStartGestureDraft(e)
    if (!started) return
    const key = akKeyAt(started.draft, loc)!
    akActivateGesture({
      ...started,
      kind: 'grow',
      pointerId: e.pointerId,
      generation: currentLoadGeneration(),
      footerTouched: false,
      loc,
      startX: e.clientX,
      startGrow: key.grow != null && key.grow > 0 ? key.grow : 1,
      changed: false,
    })
  }

  function akEnterResizePointerDown(e: PointerEvent) {
    const footer = (e.currentTarget as HTMLElement).closest<HTMLElement>('.mkb-action-bottom')
    const footerWidth = footer?.getBoundingClientRect().width ?? 0
    if (footerWidth <= 0) return
    const started = akStartGestureDraft(e)
    if (!started) return
    akActivateGesture({
      ...started,
      kind: 'enter-width',
      pointerId: e.pointerId,
      generation: currentLoadGeneration(),
      footerTouched: false,
      startX: e.clientX,
      startWidth: started.draft.bottom?.enter_width ?? 0.28,
      footerWidth,
      changed: false,
    })
  }

  return {
    akItemKey,
    akDragPointerDown,
    akResizePointerDown,
    akBottomResizePointerDown,
    akEnterResizePointerDown,
    akAbortGesture,
  }
}
