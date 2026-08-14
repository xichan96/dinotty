import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { defineComponent, h, ref } from 'vue'
import { mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useViewportResize, type ViewportResizeState } from '../composables/useViewportResize'
import type { Tab } from '../types/pane'
import { isIPhoneClient } from '../utils/clientPlatform'

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
  let originalUserAgent: PropertyDescriptor | undefined
  let builtinTextareaFocused = ref(false)

  beforeEach(() => {
    vi.useFakeTimers()
    viewport = new FakeVisualViewport()
    wrapper = null
    originalVisualViewport = Object.getOwnPropertyDescriptor(window, 'visualViewport')
    originalInnerHeight = Object.getOwnPropertyDescriptor(window, 'innerHeight')
    originalInnerWidth = Object.getOwnPropertyDescriptor(window, 'innerWidth')
    originalVisibilityState = Object.getOwnPropertyDescriptor(document, 'visibilityState')
    originalUserAgent = Object.getOwnPropertyDescriptor(navigator, 'userAgent')
    builtinTextareaFocused = ref(false)
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
    restoreProperty(navigator, 'userAgent', originalUserAgent)
    vi.useRealTimers()
  })

  function setWindowSize(width: number, height: number) {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: width })
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: height })
  }

  function restoreProperty(
    target: Window | Document | Navigator,
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
          builtinTextareaFocused,
          onSystemKeyboardClose,
        })
        return () => h('div')
      },
    })
    wrapper = mount(Host)
    return onSystemKeyboardClose
  }

  function mountViewportWithTerminal() {
    const fit = vi.fn()
    const terminalTab = {
      type: 'terminal',
      paneId: 'tab-1',
      activePaneId: 'pane-1',
      layout: {
        type: 'leaf',
        kind: 'terminal',
        paneId: 'pane-1',
        title: 'Terminal',
      },
    } as Tab
    const Host = defineComponent({
      setup() {
        state = useViewportResize({
          kbVisible: ref(true),
          activePaneId: ref('tab-1'),
          tabs: ref<Tab[]>([terminalTab]),
          termRefs: { 'pane-1': { fit } },
          terminalImeFocused: ref(false),
          builtinTextareaFocused,
        })
        return () => h('div')
      },
    })
    wrapper = mount(Host)
    return fit
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

  it('keeps the published keyboard inset stable across a transient visual-viewport pan', () => {
    mountViewport()
    viewport.height = 500
    viewport.offsetTop = 0
    state.onViewportResize()
    expect(state.systemKeyboardHeight.value).toBe(300)

    viewport.offsetTop = 35
    state.onViewportResize()

    expect(state.systemKeyboardHeight.value).toBe(300)
    expect(document.documentElement.style.getPropertyValue('--sys-kb-height')).toBe('300px')
  })

  it('releases an iPhone builtin-input pan on the first safe paint', async () => {
    Object.defineProperty(navigator, 'userAgent', {
      configurable: true,
      value: 'Mozilla/5.0 (iPhone) CriOS/140.0 Mobile',
    })
    builtinTextareaFocused.value = true
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
    let nextPaint: FrameRequestCallback | undefined
    const requestFrame = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((callback) => {
        nextPaint = callback
        return 1
      })
    mountViewport()
    openKeyboard()
    viewport.offsetTop = 35
    expect(isIPhoneClient()).toBe(true)
    expect(builtinTextareaFocused.value).toBe(true)
    expect(state.systemKeyboardOpen.value).toBe(true)

    state.onViewportResize()
    expect(nextPaint).toBeTypeOf('function')
    nextPaint?.(16)

    expect(scrollTo).toHaveBeenCalledOnce()
    expect(scrollTo).toHaveBeenCalledWith(0, 0)
    requestFrame.mockRestore()
    scrollTo.mockRestore()
  })

  it('does not release a pan owned by an unrelated native input', async () => {
    Object.defineProperty(navigator, 'userAgent', {
      configurable: true,
      value: 'Mozilla/5.0 (iPhone) CriOS/140.0 Mobile',
    })
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
    mountViewport()
    openKeyboard()
    viewport.offsetTop = 35

    state.onViewportResize()
    await vi.runOnlyPendingTimersAsync()

    expect(scrollTo).not.toHaveBeenCalled()
    scrollTo.mockRestore()
  })

  it('caps pan releases per open episode and rearms after keyboard close', () => {
    Object.defineProperty(navigator, 'userAgent', {
      configurable: true,
      value: 'Mozilla/5.0 (iPhone) CriOS/140.0 Mobile',
    })
    builtinTextareaFocused.value = true
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
    const paints: FrameRequestCallback[] = []
    const requestFrame = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((callback) => {
        paints.push(callback)
        return paints.length
      })
    mountViewport()
    openKeyboard()

    for (let attempt = 0; attempt < 4; attempt += 1) {
      viewport.offsetTop = 35
      state.onViewportResize()
      paints.shift()?.(attempt * 16)
    }
    expect(scrollTo).toHaveBeenCalledTimes(3)

    viewport.offsetTop = 0
    viewport.height = 800
    state.onViewportResize()
    viewport.height = 500
    state.onViewportResize()
    viewport.offsetTop = 35
    state.onViewportResize()
    paints.shift()?.(80)

    expect(scrollTo).toHaveBeenCalledTimes(4)
    requestFrame.mockRestore()
    scrollTo.mockRestore()
  })

  it('leaves iPhone terminal refits to the ResizeObserver during IME opening', async () => {
    Object.defineProperty(navigator, 'userAgent', {
      configurable: true,
      value: 'Mozilla/5.0 (iPhone) CriOS/140.0 Mobile',
    })
    const fit = mountViewportWithTerminal()
    viewport.height = 500

    state.onViewportResize()
    await vi.advanceTimersByTimeAsync(200)

    expect(fit).not.toHaveBeenCalled()
  })

  it('retains the existing viewport refit on non-iPhone clients', async () => {
    const fit = mountViewportWithTerminal()
    viewport.height = 500

    state.onViewportResize()
    await vi.advanceTimersByTimeAsync(100)

    expect(fit).toHaveBeenCalledOnce()
  })

  it('gives the shared inset sole ownership of focused builtin-keyboard positioning', () => {
    const css = readFileSync(join(process.cwd(), 'src/styles/mobile-keyboard.css'), 'utf8')
    const component = readFileSync(
      join(process.cwd(), 'src/components/keyboard/MobileKeyboard.vue'),
      'utf8'
    )

    expect(css).toMatch(/#mobile-kb\s*\{[^}]*bottom:\s*var\(--sys-kb-height,\s*0px\)/s)
    expect(component).not.toContain('barRef.value.style.bottom =')
  })
})
