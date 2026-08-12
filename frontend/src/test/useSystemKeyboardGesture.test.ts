import { ref, watch } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { settings, type SystemKeyboardConfig } from '../composables/useSettings'
import {
  moveSystemKeyboardKey,
  resizeSystemKey,
  useSystemKeyboardGesture,
} from '../composables/useSystemKeyboardGesture'
import { systemKeyUnits } from '../utils/systemKeyboardLayout'

function layout(): SystemKeyboardConfig {
  return {
    upper: [
      { label: 'u0', send: '0' },
      { label: 'u1', send: '1' },
    ],
    pages: [
      [
        { label: 'a', send: 'a' },
        { label: 'b', send: 'b' },
        { label: 'c', send: 'c' },
      ],
    ],
    lower_enabled: true,
    upper_pinned: 0,
  }
}

describe('system keyboard gesture transforms', () => {
  it('moves a lower key in the single ordered stream and preserves all other order', () => {
    const config = layout()

    moveSystemKeyboardKey(config, { region: 'lower', index: 1 }, { region: 'lower', index: 3 })

    expect(config.pages[0].map((key) => key.label)).toEqual(['a', 'c', 'b'])
  })

  it('reorders upper keys without moving them into lower pages', () => {
    const config = layout()

    moveSystemKeyboardKey(config, { region: 'upper', index: 0 }, { region: 'upper', index: 2 })

    expect(config.upper.map((key) => key.label)).toEqual(['u1', 'u0'])
    expect(config.pages[0].map((key) => key.label)).toEqual(['a', 'b', 'c'])
  })

  it('rejects cross-region movement', () => {
    const config = layout()

    expect(
      moveSystemKeyboardKey(config, { region: 'upper', index: 0 }, { region: 'lower', index: 0 })
    ).toBe(false)
    expect(config.upper.map((key) => key.label)).toEqual(['u0', 'u1'])
  })

  it('resizes upper and lower keys in whole-unit steps with row bounds', () => {
    const config = layout()

    expect(resizeSystemKey(config, { region: 'upper', index: 0 }, 1, 56)).toBe(true)
    expect(config.upper[0].grow).toBe(3)
    expect(resizeSystemKey(config, { region: 'upper', index: 0 }, 3, -999)).toBe(true)
    expect(config.upper[0].grow).toBe(1)
    expect(resizeSystemKey(config, { region: 'upper', index: 0 }, 1, 999)).toBe(true)
    expect(config.upper[0].grow).toBe(9)
    expect(resizeSystemKey(config, { region: 'lower', index: 0 }, 1, 56)).toBe(true)
    expect(config.pages[0][0].grow).toBe(3)
  })

  it('does not start a resize for an Auto-width key', () => {
    settings.system_keyboard = {
      upper: [{ label: 'long automatic label', send: 'x' }],
      pages: [[]],
      lower_enabled: false,
      upper_pinned: 0,
    }
    expect(systemKeyUnits(settings.system_keyboard.upper[0], 9)).toBeGreaterThan(1)
    const draft = ref<SystemKeyboardConfig | null>(null)
    const gesture = useSystemKeyboardGesture({ draft, settings })
    const captureEl = {
      setPointerCapture: vi.fn(),
      releasePointerCapture: vi.fn(),
    } as unknown as HTMLElement

    gesture.resizePointerDown({ region: 'upper', index: 0 }, {
      button: 0,
      pointerId: 71,
      clientX: 100,
      currentTarget: captureEl,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    } as unknown as PointerEvent)
    window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 71, clientX: 200 }))
    expect(settings.system_keyboard.upper[0].grow).toBeUndefined()
    window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 71, clientX: 101 }))
    expect(settings.system_keyboard.upper[0].grow).toBeUndefined()
    expect(draft.value).toBeNull()
    expect(captureEl.setPointerCapture).not.toHaveBeenCalled()
  })

  it('uses the live DOM slot index when a keyed preview retained an older handler index', () => {
    settings.system_keyboard = layout()
    const draft = ref<SystemKeyboardConfig | null>(null)
    const gesture = useSystemKeyboardGesture({ draft, settings })
    const sourceSlot = {
      getAttribute: (name: string) =>
        name === 'data-system-region' ? 'lower' : name === 'data-system-index' ? '1' : null,
    }
    const targetSlot = {
      getAttribute: (name: string) =>
        name === 'data-system-region' ? 'lower' : name === 'data-system-index' ? '2' : null,
      getBoundingClientRect: () => ({ left: 100, right: 200, width: 100 }),
    }
    const captureEl = {
      closest: vi.fn(() => sourceSlot),
      setPointerCapture: vi.fn(),
      releasePointerCapture: vi.fn(),
    } as unknown as HTMLElement
    const elementFromPoint = vi
      .spyOn(document, 'elementFromPoint')
      .mockReturnValue({ closest: vi.fn(() => targetSlot) } as unknown as Element)

    // The closure says index 0, but the visible keyed slot has already moved to index 1.
    gesture.dragPointerDown({ region: 'lower', index: 0 }, {
      button: 0,
      pointerId: 74,
      clientX: 120,
      currentTarget: captureEl,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    } as unknown as PointerEvent)
    window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 74, clientX: 150 }))
    window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 74, clientX: 150 }))

    expect(settings.system_keyboard.pages[0].map((key) => key.label)).toEqual(['a', 'c', 'b'])
    elementFromPoint.mockRestore()
  })

  it('uses a page-card end as the flattened insertion point and exposes the live dragged key', () => {
    settings.system_keyboard = layout()
    const draft = ref<SystemKeyboardConfig | null>(null)
    const gesture = useSystemKeyboardGesture({ draft, settings })
    const sourceSlot = {
      getAttribute: (name: string) =>
        name === 'data-system-region' ? 'lower' : name === 'data-system-index' ? '0' : null,
    }
    const pageCard = {
      getAttribute: (name: string) =>
        name === 'data-system-region' ? 'lower' : name === 'data-system-page-end' ? '2' : null,
    }
    const captureEl = {
      closest: vi.fn(() => sourceSlot),
      setPointerCapture: vi.fn(),
      releasePointerCapture: vi.fn(),
    } as unknown as HTMLElement
    const elementFromPoint = vi.spyOn(document, 'elementFromPoint').mockReturnValue({
      closest: vi.fn((selector: string) => (selector === '[data-system-index]' ? null : pageCard)),
    } as unknown as Element)

    gesture.dragPointerDown({ region: 'lower', index: 0 }, {
      button: 0,
      pointerId: 75,
      clientX: 120,
      currentTarget: captureEl,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    } as unknown as PointerEvent)
    expect(gesture.draggedKey.value).toBeTruthy()
    window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 75, clientX: 150 }))
    window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 75, clientX: 150 }))

    expect(settings.system_keyboard.pages[0].map((key) => key.label)).toEqual(['b', 'a', 'c'])
    expect(gesture.draggedKey.value).toBeNull()
    elementFromPoint.mockRestore()
  })

  it('notifies Vue during pointermove so the preview reorders before pointerup', () => {
    settings.system_keyboard = layout()
    const draft = ref<SystemKeyboardConfig | null>(null)
    const gesture = useSystemKeyboardGesture({ draft, settings })
    const sourceSlot = {
      getAttribute: (name: string) =>
        name === 'data-system-region' ? 'lower' : name === 'data-system-index' ? '0' : null,
    }
    const targetSlot = {
      getAttribute: (name: string) =>
        name === 'data-system-region' ? 'lower' : name === 'data-system-index' ? '2' : null,
      getBoundingClientRect: () => ({ left: 100, right: 200, width: 100 }),
    }
    const captureEl = {
      closest: vi.fn(() => sourceSlot),
      setPointerCapture: vi.fn(),
      releasePointerCapture: vi.fn(),
    } as unknown as HTMLElement
    const elementFromPoint = vi
      .spyOn(document, 'elementFromPoint')
      .mockReturnValue({ closest: vi.fn(() => targetSlot) } as unknown as Element)
    const previewChanged = vi.fn()
    const stop = watch(
      () => draft.value?.pages[0].map((key) => key.label).join(','),
      previewChanged,
      { flush: 'sync' }
    )

    gesture.dragPointerDown({ region: 'lower', index: 0 }, {
      button: 0,
      pointerId: 76,
      clientX: 120,
      currentTarget: captureEl,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    } as unknown as PointerEvent)
    previewChanged.mockClear()
    window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 76, clientX: 150 }))

    expect(previewChanged).toHaveBeenLastCalledWith('b,c,a', 'b,c', expect.any(Function))
    expect(settings.system_keyboard.pages[0].map((key) => key.label)).toEqual(['a', 'b', 'c'])

    window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 76, clientX: 150 }))
    stop()
    elementFromPoint.mockRestore()
  })

  it('discards cancellation and rolls back a resize that would create page six', () => {
    settings.system_keyboard = {
      upper: [],
      pages: [
        [...Array.from({ length: 49 }, (_, index) => ({ label: `${index}`, send: 'x', grow: 1 }))],
      ],
      lower_enabled: true,
      upper_pinned: 0,
    }
    const draft = ref<SystemKeyboardConfig | null>(null)
    const gesture = useSystemKeyboardGesture({ draft, settings })
    const captureEl = {
      setPointerCapture: vi.fn(),
      releasePointerCapture: vi.fn(),
    } as unknown as HTMLElement
    const down = (pointerId: number) =>
      gesture.resizePointerDown({ region: 'lower', index: 0 }, {
        button: 0,
        pointerId,
        clientX: 100,
        currentTarget: captureEl,
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
      } as unknown as PointerEvent)

    down(72)
    window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 72, clientX: 999 }))
    expect(draft.value?.pages[0][0].grow).toBe(1)
    window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 72, clientX: 999 }))
    expect(settings.system_keyboard.pages[0][0].grow).toBe(1)

    down(73)
    window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 73, clientX: 128 }))
    expect(draft.value?.pages[0][0].grow).toBe(2)
    window.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 73 }))
    expect(settings.system_keyboard.pages[0][0].grow).toBe(1)
    expect(draft.value).toBeNull()
  })
})
