import { ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { settings, type ActionKeyboardConfig } from '../composables/useSettings'
import { useActionKeyboardGesture } from '../composables/useActionKeyboardGesture'

function keyboard(): ActionKeyboardConfig {
  return {
    rows: [
      [
        { label: 'a', send: 'a', grow: 1 },
        { label: 'b', send: 'b', grow: 1 },
        { label: 'c', send: 'c', grow: 1 },
      ],
    ],
    bottom: {
      rows: [
        [
          { label: 'd', send: 'd', grow: 1 },
          { label: 'e', send: 'e', grow: 1 },
          { label: 'f', send: 'f', grow: 1 },
        ],
      ],
      enter: { label: 'Enter', send: '\r' },
    },
  }
}

function slot(zone: 'main' | 'bottom', row: number, index: number) {
  return {
    getAttribute(name: string) {
      if (name === 'data-ak-zone') return zone
      if (name === 'data-ak-row') return String(row)
      if (name === 'data-ak-index') return String(index)
      return null
    },
    getBoundingClientRect: () => ({ left: 100, right: 200, width: 100 }),
  }
}

function captureElement(liveSlot: ReturnType<typeof slot> | null) {
  return {
    closest: vi.fn(() => liveSlot),
    setPointerCapture: vi.fn(),
    releasePointerCapture: vi.fn(),
  } as unknown as HTMLElement
}

function pointerDown(pointerId: number, captureEl: HTMLElement, clientX = 120) {
  return {
    button: 0,
    pointerId,
    clientX,
    currentTarget: captureEl,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
  } as unknown as PointerEvent
}

describe('action keyboard live gesture locations', () => {
  beforeEach(() => {
    settings.action_keyboard = keyboard()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    settings.action_keyboard = null
  })

  it('drags the live main-row key when the captured loop index is stale', () => {
    const draft = ref<ActionKeyboardConfig | null>(null)
    const gesture = useActionKeyboardGesture({ akDraft: draft, settings })
    vi.spyOn(document, 'elementFromPoint').mockReturnValue({
      closest: vi.fn(() => slot('main', 0, 2)),
    } as unknown as Element)

    gesture.akDragPointerDown(
      { zone: 'main', row: 0, index: 0 },
      pointerDown(81, captureElement(slot('main', 0, 1)))
    )
    window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 81, clientX: 150 }))
    window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 81, clientX: 150 }))

    expect(settings.action_keyboard?.rows[0].map((key) => key.label)).toEqual(['a', 'c', 'b'])
  })

  it('resizes the live main-row key when the captured loop index is stale', () => {
    const draft = ref<ActionKeyboardConfig | null>(null)
    const gesture = useActionKeyboardGesture({ akDraft: draft, settings })

    gesture.akResizePointerDown(
      0,
      0,
      pointerDown(82, captureElement(slot('main', 0, 1)), 100)
    )
    window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 82, clientX: 128 }))
    window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 82, clientX: 128 }))

    expect(settings.action_keyboard?.rows[0].map((key) => key.grow)).toEqual([1, 2, 1])
  })

  it('drags the live bottom-row key when the captured loop index is stale', () => {
    const draft = ref<ActionKeyboardConfig | null>(null)
    const gesture = useActionKeyboardGesture({ akDraft: draft, settings })
    vi.spyOn(document, 'elementFromPoint').mockReturnValue({
      closest: vi.fn(() => slot('bottom', 0, 2)),
    } as unknown as Element)

    gesture.akDragPointerDown(
      { zone: 'bottom', row: 0, index: 0 },
      pointerDown(83, captureElement(slot('bottom', 0, 1)))
    )
    window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 83, clientX: 150 }))
    window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 83, clientX: 150 }))

    expect(settings.action_keyboard?.bottom?.rows[0].map((key) => key.label)).toEqual([
      'd',
      'f',
      'e',
    ])
  })

  it('resizes the live bottom-row key when the captured loop index is stale', () => {
    const draft = ref<ActionKeyboardConfig | null>(null)
    const gesture = useActionKeyboardGesture({ akDraft: draft, settings })

    gesture.akBottomResizePointerDown(
      0,
      0,
      pointerDown(84, captureElement(slot('bottom', 0, 1)), 100)
    )
    window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 84, clientX: 128 }))
    window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 84, clientX: 128 }))

    expect(settings.action_keyboard?.bottom?.rows[0].map((key) => key.grow)).toEqual([1, 2, 1])
  })

  it('falls back to the supplied location when live slot metadata is invalid', () => {
    const draft = ref<ActionKeyboardConfig | null>(null)
    const gesture = useActionKeyboardGesture({ akDraft: draft, settings })
    const malformed = {
      getAttribute: vi.fn(() => null),
    } as unknown as ReturnType<typeof slot>

    gesture.akResizePointerDown(0, 0, pointerDown(85, captureElement(malformed), 100))
    window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 85, clientX: 128 }))
    window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 85, clientX: 128 }))

    expect(settings.action_keyboard?.rows[0].map((key) => key.grow)).toEqual([2, 1, 1])
  })
})
