import { defineComponent, h, ref } from 'vue'
import { mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useViewportResize, type ViewportResizeState } from '../composables/useViewportResize'
import type { Tab } from '../types/pane'

class FakeVisualViewport extends EventTarget {
  height = 800
  offsetTop = 0
}

describe('useViewportResize system keyboard lifecycle', () => {
  let viewport: FakeVisualViewport
  let wrapper: VueWrapper | null
  let state: ViewportResizeState
  let originalVisualViewport: PropertyDescriptor | undefined
  let originalInnerHeight: PropertyDescriptor | undefined
  let originalInnerWidth: PropertyDescriptor | undefined
  let originalVisibilityState: PropertyDescriptor | undefined

  beforeEach(() => {
    vi.useFakeTimers()
    viewport = new FakeVisualViewport()
    wrapper = null
    originalVisualViewport = Object.getOwnPropertyDescriptor(window, 'visualViewport')
    originalInnerHeight = Object.getOwnPropertyDescriptor(window, 'innerHeight')
    originalInnerWidth = Object.getOwnPropertyDescriptor(window, 'innerWidth')
    originalVisibilityState = Object.getOwnPropertyDescriptor(document, 'visibilityState')
    Object.defineProperty(window, 'visualViewport', {
      configurable: true,
      value: viewport,
    })
    setWindowSize(400, 800)
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    })
  })

  afterEach(() => {
    wrapper?.unmount()
    restoreProperty(window, 'visualViewport', originalVisualViewport)
    restoreProperty(window, 'innerHeight', originalInnerHeight)
    restoreProperty(window, 'innerWidth', originalInnerWidth)
    restoreProperty(document, 'visibilityState', originalVisibilityState)
    vi.useRealTimers()
  })

  function setWindowSize(width: number, height: number) {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: width })
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: height })
  }

  function restoreProperty(
    target: Window | Document,
    key: string,
    descriptor: PropertyDescriptor | undefined
  ) {
    if (descriptor) Object.defineProperty(target, key, descriptor)
    else Reflect.deleteProperty(target, key)
  }

  function mountViewport(onSystemKeyboardClose = vi.fn()) {
    const Host = defineComponent({
      setup() {
        state = useViewportResize({
          kbVisible: ref(true),
          activePaneId: ref(null),
          tabs: ref<Tab[]>([]),
          termRefs: {},
          terminalImeFocused: ref(true),
          onSystemKeyboardClose,
        })
        return () => h('div')
      },
    })
    wrapper = mount(Host)
    return onSystemKeyboardClose
  }

  function openKeyboard(height = 500) {
    viewport.height = height
    state.onViewportResize()
    expect(state.systemKeyboardOpen.value).toBe(true)
  }

  it.each([
    ['blur', 'focus'],
    ['pagehide', 'pageshow'],
  ])('preserves an open-keyboard baseline across %s/%s', (hideEvent, showEvent) => {
    mountViewport()
    openKeyboard()

    window.dispatchEvent(new Event(hideEvent))
    expect(state.systemKeyboardOpen.value).toBe(false)
    expect(state.toolbarBottom.value).toBe(0)

    window.dispatchEvent(new Event(showEvent))
    expect(state.systemKeyboardOpen.value).toBe(true)
    expect(state.systemKeyboardHeight.value).toBe(300)
    expect(state.toolbarBottom.value).toBe(300)
  })

  it('preserves detection when the browser resizes the layout viewport for the keyboard', () => {
    mountViewport()
    setWindowSize(400, 500)
    openKeyboard()
    expect(state.systemKeyboardHeight.value).toBe(0)

    window.dispatchEvent(new Event('pagehide'))
    window.dispatchEvent(new Event('pageshow'))

    expect(state.systemKeyboardOpen.value).toBe(true)
    expect(state.systemKeyboardHeight.value).toBe(0)

    setWindowSize(400, 800)
    viewport.height = 800
    state.onViewportResize()
    expect(state.systemKeyboardOpen.value).toBe(false)
  })

  it('rebuilds the baseline from the rotated layout viewport while the keyboard stays open', async () => {
    mountViewport()
    openKeyboard()

    setWindowSize(900, 500)
    viewport.height = 250
    window.dispatchEvent(new Event('orientationchange'))
    expect(state.systemKeyboardOpen.value).toBe(false)

    await vi.runAllTimersAsync()
    expect(state.isLandscape.value).toBe(true)
    expect(state.systemKeyboardOpen.value).toBe(true)
    expect(state.systemKeyboardHeight.value).toBe(250)
    expect(state.toolbarBottom.value).toBe(250)
  })

  it('retains the known-open state across rotation when the layout viewport is resized', async () => {
    const onSystemKeyboardClose = mountViewport()
    setWindowSize(400, 500)
    openKeyboard()

    setWindowSize(900, 300)
    viewport.height = 300
    window.dispatchEvent(new Event('orientationchange'))
    await vi.runAllTimersAsync()

    expect(state.systemKeyboardOpen.value).toBe(true)
    expect(state.systemKeyboardHeight.value).toBe(0)
    expect(onSystemKeyboardClose).not.toHaveBeenCalled()

    setWindowSize(900, 500)
    viewport.height = 500
    state.onViewportResize()
    expect(state.systemKeyboardOpen.value).toBe(false)
    expect(onSystemKeyboardClose).toHaveBeenCalledOnce()
  })

  it('reports exactly one open-to-closed edge when the native keyboard is dismissed', () => {
    const onSystemKeyboardClose = mountViewport()
    openKeyboard()

    viewport.height = 800
    state.onViewportResize()
    state.onViewportResize()

    expect(onSystemKeyboardClose).toHaveBeenCalledOnce()
    expect(state.systemKeyboardOpen.value).toBe(false)
    expect(state.toolbarBottom.value).toBe(0)
  })

  it('retains the close edge across a transient reset', () => {
    const onSystemKeyboardClose = mountViewport()
    openKeyboard()

    window.dispatchEvent(new Event('blur'))
    viewport.height = 800
    window.dispatchEvent(new Event('focus'))

    expect(onSystemKeyboardClose).toHaveBeenCalledOnce()
  })
})
