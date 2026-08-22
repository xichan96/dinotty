import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { defineComponent, h, nextTick, ref } from 'vue'
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
  let originalUserAgent: PropertyDescriptor | undefined

  beforeEach(() => {
    vi.useFakeTimers()
    viewport = new FakeVisualViewport()
    wrapper = null
    originalVisualViewport = Object.getOwnPropertyDescriptor(window, 'visualViewport')
    originalInnerHeight = Object.getOwnPropertyDescriptor(window, 'innerHeight')
    originalInnerWidth = Object.getOwnPropertyDescriptor(window, 'innerWidth')
    originalVisibilityState = Object.getOwnPropertyDescriptor(document, 'visibilityState')
    originalUserAgent = Object.getOwnPropertyDescriptor(navigator, 'userAgent')
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

  function mountViewport(onSystemKeyboardClose = vi.fn(), terminalImeFocused = ref(false)) {
    const Host = defineComponent({
      setup() {
        state = useViewportResize({
          kbVisible: ref(true),
          activePaneId: ref(null),
          tabs: ref<Tab[]>([]),
          termRefs: {},
          terminalImeFocused,
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

    window.dispatchEvent(new Event(showEvent))
    expect(state.systemKeyboardOpen.value).toBe(true)
    expect(state.systemKeyboardHeight.value).toBe(300)
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
  })

  it('retains the close edge across a transient reset', () => {
    const onSystemKeyboardClose = mountViewport()
    openKeyboard()

    window.dispatchEvent(new Event('blur'))
    viewport.height = 800
    window.dispatchEvent(new Event('focus'))

    expect(onSystemKeyboardClose).toHaveBeenCalledOnce()
  })

  it('tracks the keyboard inset with the caret pan while the IME is open', () => {
    // v0.22.0 contract: --sys-kb-height is pan-compensated. #258 made it
    // pan-invariant; combined with the removed inline bottom it left the
    // builtin bar stranded. The inset follows the visual viewport's live
    // bottom edge again.
    mountViewport()
    viewport.height = 500
    viewport.offsetTop = 0
    state.onViewportResize()
    expect(state.systemKeyboardHeight.value).toBe(300)

    viewport.offsetTop = 35
    state.onViewportResize()

    expect(state.systemKeyboardHeight.value).toBe(265)
    expect(document.documentElement.style.getPropertyValue('--sys-kb-height')).toBe('265px')
  })

  it('lifts the fixed toolbar to the keyboard edge only while the terminal IME is focused', async () => {
    const imeFocused = ref(true)
    mountViewport(vi.fn(), imeFocused)
    openKeyboard()
    await nextTick()

    expect(state.toolbarBottom.value).toBe(300)
    expect(document.documentElement.style.getPropertyValue('--system-toolbar-bottom')).toBe('300px')

    imeFocused.value = false
    await nextTick()
    expect(document.documentElement.style.getPropertyValue('--system-toolbar-bottom')).toBe('0px')
  })

  it('keeps the fixed toolbar at the layout viewport bottom in layout-resize browsers', () => {
    // When innerHeight shrinks with the keyboard, off = 0 and the toolbar
    // bottom stays 0: the fixed bar already rides the shrunken layout
    // viewport, and the in-flow chain (100dvh + --sys-kb-height) is the one
    // that breaks on devices where dvh does not track the keyboard.
    const imeFocused = ref(true)
    mountViewport(vi.fn(), imeFocused)
    setWindowSize(400, 500)
    openKeyboard()

    expect(state.systemKeyboardHeight.value).toBe(0)
    expect(state.toolbarBottom.value).toBe(0)
    expect(document.documentElement.style.getPropertyValue('--system-toolbar-bottom')).toBe('0px')
  })

  it('releases the toolbar bottom on keyboard close and reset', () => {
    const imeFocused = ref(true)
    mountViewport(vi.fn(), imeFocused)
    openKeyboard()
    expect(state.toolbarBottom.value).toBe(300)

    viewport.height = 800
    state.onViewportResize()
    expect(document.documentElement.style.getPropertyValue('--system-toolbar-bottom')).toBe('0px')

    openKeyboard()
    window.dispatchEvent(new Event('blur'))
    expect(state.systemKeyboardOpen.value).toBe(false)
    expect(document.documentElement.style.getPropertyValue('--system-toolbar-bottom')).toBe('0px')
  })

  it('retains the delayed viewport refit of terminal tabs', async () => {
    const fit = mountViewportWithTerminal()
    viewport.height = 500

    state.onViewportResize()
    await vi.advanceTimersByTimeAsync(100)

    expect(fit).toHaveBeenCalledOnce()
  })

  it('anchors the focused builtin keyboard with a pan-compensated inline bottom', () => {
    const css = readFileSync(join(process.cwd(), 'src/styles/mobile-keyboard.css'), 'utf8')
    const component = readFileSync(
      join(process.cwd(), 'src/components/keyboard/MobileKeyboard.vue'),
      'utf8'
    )

    // The static rule only provides the pre-event default; the live position must
    // come from the viewport handler so WebKit's caret pan cannot strand the
    // input behind the system keyboard on iPhone (#258 regression).
    expect(css).toMatch(/#mobile-kb\s*\{[^}]*bottom:\s*0\s*;/s)
    expect(css).not.toMatch(/#mobile-kb\s*\{[^}]*bottom:\s*var\(--sys-kb-height/s)
    expect(component).toContain('barRef.value.style.bottom =')
    expect(component).toContain('info.baseline - (info.offsetTop + vh)')
  })
})
