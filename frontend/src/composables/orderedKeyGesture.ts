import { toRaw } from 'vue'
import type { ActionKey } from './useSettings'

export function createOrderedKeyRegistry(prefix: string) {
  const ids = new WeakMap<ActionKey, string>()

  function itemKey(key: ActionKey): string {
    const raw = toRaw(key)
    let id = ids.get(raw)
    if (!id) {
      id = `${prefix}-${Math.random().toString(36).slice(2)}`
      ids.set(raw, id)
    }
    return id
  }

  function transferRows(sourceRows: ActionKey[][], draftRows: ActionKey[][]) {
    for (let row = 0; row < sourceRows.length; row++) {
      for (let index = 0; index < sourceRows[row].length; index++) {
        const draft = draftRows[row]?.[index]
        if (draft) ids.set(toRaw(draft), itemKey(sourceRows[row][index]))
      }
    }
  }

  return { itemKey, transferRows }
}

export function quantizedGestureValue(
  start: number,
  deltaX: number,
  options: { min: number; max: number; step: number; pixelsPerStep?: number }
): number {
  const pixels = options.pixelsPerStep ?? 28
  const steps = Math.round(deltaX / pixels)
  const raw = start + steps * options.step
  const snapped = Math.round(raw / options.step) * options.step
  return Math.min(options.max, Math.max(options.min, snapped))
}

export function resolveLiveGestureLocation<T>(
  fallback: T,
  event: PointerEvent,
  selector: string,
  resolveSlot: (slot: Element) => T | null
): T {
  const slot = (event.currentTarget as Element | null)?.closest?.(selector)
  return slot ? (resolveSlot(slot) ?? fallback) : fallback
}
