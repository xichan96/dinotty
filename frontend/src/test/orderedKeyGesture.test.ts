import { reactive, toRaw } from 'vue'
import { describe, expect, it } from 'vitest'
import type { ActionKey } from '../composables/useSettings'
import { createOrderedKeyRegistry, quantizedGestureValue } from '../composables/orderedKeyGesture'

describe('ordered key gesture mechanics', () => {
  it('keeps stable identities when source rows are cloned into a reactive draft', () => {
    const source = reactive<ActionKey[][]>([
      [
        { label: 'one', kind: 'send', send: '1' },
        { label: 'two', kind: 'send', send: '2' },
      ],
    ])
    const draft = reactive<ActionKey[][]>([source[0].map((key) => ({ ...toRaw(key) }))])
    const registry = createOrderedKeyRegistry('test')
    const sourceIds = source[0].map(registry.itemKey)

    registry.transferRows(source, draft)

    expect(draft[0].map(registry.itemKey)).toEqual(sourceIds)
  })

  it('snaps resize motion to bounded discrete steps', () => {
    expect(quantizedGestureValue(1, 13, { min: 1, max: 10, step: 1, pixelsPerStep: 28 })).toBe(1)
    expect(quantizedGestureValue(1, 15, { min: 1, max: 10, step: 1, pixelsPerStep: 28 })).toBe(2)
    expect(quantizedGestureValue(9, 999, { min: 1, max: 10, step: 1, pixelsPerStep: 28 })).toBe(10)
  })
})
