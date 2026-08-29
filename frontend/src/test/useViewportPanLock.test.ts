import { defineComponent, h, ref } from 'vue'
import { mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { useViewportPanLock } from '../composables/useViewportPanLock'

type Fixture = VueWrapper & { vm: { dispose: () => void } }

function mountFixture(isActive = true): Fixture {
  const component = defineComponent({
    setup(_, { expose }) {
      const root = ref<HTMLElement | null>(null)
      const { dispose } = useViewportPanLock(root, { isActive: () => isActive })
      expose({ dispose })
      return () =>
        h('div', { ref: root }, [h('div', { class: 'chrome' }), h('div', { class: 'terminal' })])
    },
  })
  return mount(component, { attachTo: document.body }) as Fixture
}

function dispatchTouch(
  target: Element,
  type: string,
  touches: Array<{ clientX: number; clientY: number }>,
  cancelable = true
) {
  const event = new Event(type, { bubbles: true, cancelable }) as TouchEvent
  Object.defineProperty(event, 'touches', { value: touches })
  const preventDefault = vi.spyOn(event, 'preventDefault')
  target.dispatchEvent(event)
  return preventDefault
}

function start(target: Element, touches = [{ clientX: 10, clientY: 10 }]) {
  dispatchTouch(target, 'touchstart', touches)
}

function makeScrollable(element: HTMLElement, scrollTop: number) {
  Object.defineProperties(element, {
    scrollHeight: { configurable: true, value: 300 },
    clientHeight: { configurable: true, value: 100 },
    scrollTop: { configurable: true, value: scrollTop },
  })
  vi.spyOn(window, 'getComputedStyle').mockImplementation(
    (candidate) =>
      ({ overflowY: candidate === element ? 'auto' : 'visible' }) as CSSStyleDeclaration
  )
}

afterEach(() => {
  vi.restoreAllMocks()
  document.body.replaceChildren()
})

describe('useViewportPanLock', () => {
  it('prevents a vertical drag on non-scrollable chrome while the keyboard is open', () => {
    const wrapper = mountFixture()
    const chrome = wrapper.get('.chrome').element
    start(chrome)
    expect(
      dispatchTouch(chrome, 'touchmove', [{ clientX: 10, clientY: 30 }])
    ).toHaveBeenCalledOnce()
    wrapper.unmount()
  })

  it('does not prevent the same drag when inactive', () => {
    const wrapper = mountFixture(false)
    const chrome = wrapper.get('.chrome').element
    start(chrome)
    expect(
      dispatchTouch(chrome, 'touchmove', [{ clientX: 10, clientY: 30 }])
    ).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('does not prevent terminal scrollback that can still scroll in the gesture direction', () => {
    const wrapper = mountFixture()
    const terminal = wrapper.get('.terminal').element as HTMLElement
    makeScrollable(terminal, 50)
    start(terminal)
    expect(
      dispatchTouch(terminal, 'touchmove', [{ clientX: 10, clientY: 30 }])
    ).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('prevents terminal scrollback at the boundary in the gesture direction', () => {
    const wrapper = mountFixture()
    const terminal = wrapper.get('.terminal').element as HTMLElement
    makeScrollable(terminal, 0)
    start(terminal)
    expect(
      dispatchTouch(terminal, 'touchmove', [{ clientX: 10, clientY: 30 }])
    ).toHaveBeenCalledOnce()
    wrapper.unmount()
  })

  it('leaves predominantly horizontal drags alone', () => {
    const wrapper = mountFixture()
    const chrome = wrapper.get('.chrome').element
    start(chrome)
    expect(
      dispatchTouch(chrome, 'touchmove', [{ clientX: 40, clientY: 20 }])
    ).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('leaves two-finger gestures alone', () => {
    const wrapper = mountFixture()
    const chrome = wrapper.get('.chrome').element
    start(chrome, [
      { clientX: 10, clientY: 10 },
      { clientX: 20, clientY: 20 },
    ])
    expect(
      dispatchTouch(chrome, 'touchmove', [
        { clientX: 10, clientY: 30 },
        { clientX: 20, clientY: 40 },
      ])
    ).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('does not prevent a non-cancelable event', () => {
    const wrapper = mountFixture()
    const chrome = wrapper.get('.chrome').element
    start(chrome)
    expect(
      dispatchTouch(chrome, 'touchmove', [{ clientX: 10, clientY: 30 }], false)
    ).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('does not prevent touchmove after disposal', () => {
    const wrapper = mountFixture()
    const chrome = wrapper.get('.chrome').element
    start(chrome)
    wrapper.vm.dispose()
    expect(
      dispatchTouch(chrome, 'touchmove', [{ clientX: 10, clientY: 30 }])
    ).not.toHaveBeenCalled()
    wrapper.unmount()
  })
})
