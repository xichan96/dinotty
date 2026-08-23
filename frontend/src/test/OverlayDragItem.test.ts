import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { defineComponent, h } from 'vue'

// useEventBridge -> useSyncWebSocket -> usePluginLoader -> createKeyboardContext
// -> useHistory -> useSyncWebSocket forms a circular import; useHistory calls
// onSuggestions at module scope, so the real useSyncWebSocket is in a temporal
// dead zone by the time it is reached. Stub the module to break the cycle.
vi.mock('../composables/useSyncWebSocket', () => ({
  onEvent: () => () => {},
  getClientId: () => null,
  onSuggestions: () => () => {},
}))

import OverlayDragItem from '../components/plugin/OverlayDragItem.vue'
import { FOCUS_ACTIVE_KEY } from '../composables/useFocusActive'
import { usePluginOverlaysStore } from '../stores/pluginOverlays'
import type { RegisteredOverlay } from '../stores/pluginOverlays'

const raf = () => new Promise((r) => requestAnimationFrame(r))

const Widget = defineComponent({
  props: ['api', 'dragging'],
  render() {
    return h('div', { class: 'widget-content' }, 'widget')
  },
})

const fakeApi = { open: () => {} }

function makeOverlay(partial: Partial<RegisteredOverlay> = {}): RegisteredOverlay {
  return {
    id: 'o1',
    pluginId: 'p1',
    component: Widget,
    defaultHidden: false,
    failureCount: 0,
    autoHidden: false,
    ...partial,
  } as RegisteredOverlay
}

describe('OverlayDragItem', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
  })

  it('renders the plugin component in whole mode with api and dragging props', () => {
    const wrapper = mount(OverlayDragItem, {
      props: { overlay: makeOverlay(), api: fakeApi as never },
    })
    expect(wrapper.find('.overlay-widget.is-draggable').exists()).toBe(true)
    expect(wrapper.find('.overlay-bar').exists()).toBe(false)
    const child = wrapper.findComponent(Widget)
    expect(child.props('api')).toEqual(fakeApi)
    expect(child.props('dragging')).toBe(false)
  })

  it('makes the whole widget a hold-to-drag surface in grip mode without a handle', () => {
    const wrapper = mount(OverlayDragItem, {
      props: { overlay: makeOverlay({ dragHandle: 'grip' }), api: fakeApi as never },
    })
    expect(wrapper.find('.overlay-bar').exists()).toBe(false)
    expect(wrapper.find('.overlay-widget.is-draggable').exists()).toBe(false)
    expect(wrapper.find('.overlay-widget.is-hold').exists()).toBe(true)
  })

  it('renders a passive widget with no bar for interactive:false', () => {
    const wrapper = mount(OverlayDragItem, {
      props: { overlay: makeOverlay({ interactive: false }), api: fakeApi as never },
    })
    expect(wrapper.find('.overlay-widget.is-passive').exists()).toBe(true)
    expect(wrapper.find('.overlay-bar').exists()).toBe(false)
  })

  it('lets the widget own data-drag-handle header be the drag surface in grip mode', async () => {
    const HeaderWidget = defineComponent({
      props: ['api', 'dragging'],
      render() {
        return h('div', { class: 'hw' }, [
          h('div', { class: 'hw__head', 'data-drag-handle': '' }, 'header'),
          h('div', { class: 'hw__body' }, 'body'),
        ])
      },
    })
    const wrapper = mount(OverlayDragItem, {
      props: {
        overlay: makeOverlay({
          dragHandle: 'grip',
          component: HeaderWidget,
          defaultPosition: { x: 0, y: 0 },
        }),
        api: fakeApi as never,
      },
    })
    await raf() // let the onMounted scanHandle run
    expect(wrapper.find('.overlay-bar').exists()).toBe(false)
    const handle = wrapper.find('.hw__head').element
    handle.dispatchEvent(
      new PointerEvent('pointerdown', {
        button: 0,
        pointerId: 1,
        bubbles: true,
        clientX: 0,
        clientY: 0,
      })
    )
    window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: 60, clientY: 0 }))
    await raf()
    window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1 }))
    const saved = JSON.parse(localStorage.getItem('dinotty:overlay-pos:p1:o1')!)
    expect(saved).toEqual({ x: 60, y: 0 })
  })

  it('does not drag a passive overlay outside reposition mode', async () => {
    const wrapper = mount(OverlayDragItem, {
      props: {
        overlay: makeOverlay({ interactive: false, defaultPosition: { x: 0, y: 0 } }),
        api: fakeApi as never,
      },
    })
    const surface = wrapper.find('.overlay-widget').element
    surface.dispatchEvent(
      new PointerEvent('pointerdown', {
        button: 0,
        pointerId: 1,
        bubbles: true,
        clientX: 0,
        clientY: 0,
      })
    )
    window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: 40, clientY: 0 }))
    await raf()
    window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1 }))
    expect(localStorage.getItem('dinotty:overlay-pos:p1:o1')).toBeNull()
  })

  it('makes a passive overlay draggable during reposition mode and auto-exits on drag end', async () => {
    const store = usePluginOverlaysStore()
    store.setReposition('o1')
    const wrapper = mount(OverlayDragItem, {
      props: {
        overlay: makeOverlay({ interactive: false, defaultPosition: { x: 0, y: 0 } }),
        api: fakeApi as never,
      },
    })
    expect(wrapper.find('.overlay-widget.is-repositioning').exists()).toBe(true)
    const surface = wrapper.find('.overlay-widget').element
    surface.dispatchEvent(
      new PointerEvent('pointerdown', {
        button: 0,
        pointerId: 1,
        bubbles: true,
        clientX: 0,
        clientY: 0,
      })
    )
    window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: 40, clientY: 0 }))
    await raf()
    window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1 }))
    const saved = JSON.parse(localStorage.getItem('dinotty:overlay-pos:p1:o1')!)
    expect(saved).toEqual({ x: 40, y: 0 })
    expect(store.repositionId).toBeNull()
    wrapper.unmount()
  })

  it('drags a grip-mode widget without a handle via a long press (hold-to-drag)', async () => {
    const wrapper = mount(OverlayDragItem, {
      props: {
        overlay: makeOverlay({ dragHandle: 'grip', defaultPosition: { x: 0, y: 0 } }),
        api: fakeApi as never,
      },
    })
    const surface = wrapper.find('.overlay-widget').element
    surface.dispatchEvent(
      new PointerEvent('pointerdown', {
        button: 0,
        pointerId: 1,
        bubbles: true,
        clientX: 0,
        clientY: 0,
      })
    )
    expect(wrapper.find('.overlay-widget.is-dragging').exists()).toBe(false)
    await new Promise((r) => setTimeout(r, 350)) // past HOLD_DELAY_MS
    expect(wrapper.find('.overlay-widget.is-dragging').exists()).toBe(true)
    window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: 40, clientY: 0 }))
    await raf()
    window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1 }))
    const saved = JSON.parse(localStorage.getItem('dinotty:overlay-pos:p1:o1')!)
    expect(saved).toEqual({ x: 40, y: 0 })
    wrapper.unmount()
  })

  it('does not drag a grip-mode widget when movement happens before the long press completes', async () => {
    const wrapper = mount(OverlayDragItem, {
      props: {
        overlay: makeOverlay({ dragHandle: 'grip', defaultPosition: { x: 0, y: 0 } }),
        api: fakeApi as never,
      },
    })
    const surface = wrapper.find('.overlay-widget').element
    surface.dispatchEvent(
      new PointerEvent('pointerdown', {
        button: 0,
        pointerId: 1,
        bubbles: true,
        clientX: 0,
        clientY: 0,
      })
    )
    window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: 10, clientY: 0 }))
    await new Promise((r) => setTimeout(r, 350)) // hold was cancelled by the move
    window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1 }))
    expect(localStorage.getItem('dinotty:overlay-pos:p1:o1')).toBeNull()
    wrapper.unmount()
  })

  it('does not drag from non-handle widget content in grip mode', async () => {
    const HeaderWidget = defineComponent({
      props: ['api', 'dragging'],
      render() {
        return h('div', { class: 'hw' }, [
          h('div', { class: 'hw__head', 'data-drag-handle': '' }, 'header'),
          h('div', { class: 'hw__body' }, 'body'),
        ])
      },
    })
    const wrapper = mount(OverlayDragItem, {
      props: {
        overlay: makeOverlay({
          dragHandle: 'grip',
          component: HeaderWidget,
          defaultPosition: { x: 0, y: 0 },
        }),
        api: fakeApi as never,
      },
    })
    await raf()
    const body = wrapper.find('.hw__body').element
    body.dispatchEvent(
      new PointerEvent('pointerdown', {
        button: 0,
        pointerId: 1,
        bubbles: true,
        clientX: 0,
        clientY: 0,
      })
    )
    window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: 60, clientY: 0 }))
    await raf()
    window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1 }))
    expect(localStorage.getItem('dinotty:overlay-pos:p1:o1')).toBeNull()
  })

  it('restores position from localStorage on mount', async () => {
    localStorage.setItem('dinotty:overlay-pos:p1:o1', JSON.stringify({ x: 50, y: 60 }))
    const wrapper = mount(OverlayDragItem, {
      props: { overlay: makeOverlay(), api: fakeApi as never },
    })
    await raf()
    expect(wrapper.find('.overlay-item').attributes('style')).toContain('translate3d(50px, 60px, 0')
  })

  it('persists the clamped position to localStorage after a real drag', async () => {
    const wrapper = mount(OverlayDragItem, {
      props: { overlay: makeOverlay({ defaultPosition: { x: 0, y: 0 } }), api: fakeApi as never },
    })
    const surface = wrapper.find('.overlay-widget').element
    surface.dispatchEvent(
      new PointerEvent('pointerdown', {
        button: 0,
        pointerId: 1,
        bubbles: true,
        clientX: 0,
        clientY: 0,
      })
    )
    window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: 60, clientY: 0 }))
    await raf()
    window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1 }))
    const saved = JSON.parse(localStorage.getItem('dinotty:overlay-pos:p1:o1')!)
    expect(saved).toEqual({ x: 60, y: 0 })
  })

  it('emits reportError and hides the widget when the component throws', () => {
    const Thrower = defineComponent({
      // render() intentionally throws: exercising OverlayDragItem's error capture.
      // eslint-disable-next-line vue/require-render-return
      render() {
        throw new Error('boom')
      },
    })
    const wrapper = mount(OverlayDragItem, {
      props: { overlay: makeOverlay({ component: Thrower }), api: fakeApi as never },
    })
    expect(wrapper.emitted('reportError')).toBeTruthy()
    expect(wrapper.emitted('reportError')![0][0]).toBe('o1')
    expect(wrapper.find('.widget-content').exists()).toBe(false)
  })

  it('returns focus to the active terminal after interacting with a non-editable element', async () => {
    const focusActive = vi.fn()
    const ButtonWidget = defineComponent({ render: () => h('button', { class: 'fb' }, 'cmd') })
    const wrapper = mount(OverlayDragItem, {
      props: { overlay: makeOverlay({ component: ButtonWidget }), api: fakeApi as never },
      attachTo: document.body,
      global: { provide: { [FOCUS_ACTIVE_KEY]: focusActive } },
    })
    const btn = wrapper.find('button.fb').element as HTMLButtonElement
    btn.focus()
    expect(document.activeElement).toBe(btn)
    await wrapper.find('.overlay-item').trigger('click')
    expect(focusActive).toHaveBeenCalled()
    wrapper.unmount()
  })

  it('does not steal focus from a text-editable element inside the widget', async () => {
    const focusActive = vi.fn()
    const InputWidget = defineComponent({ render: () => h('input', { class: 'inp' }) })
    const wrapper = mount(OverlayDragItem, {
      props: { overlay: makeOverlay({ component: InputWidget }), api: fakeApi as never },
      attachTo: document.body,
      global: { provide: { [FOCUS_ACTIVE_KEY]: focusActive } },
    })
    const input = wrapper.find('input.inp').element as HTMLInputElement
    input.focus()
    expect(document.activeElement).toBe(input)
    await wrapper.find('.overlay-item').trigger('click')
    expect(focusActive).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('opens a context menu on right-click and the close item hides the overlay', async () => {
    const wrapper = mount(OverlayDragItem, {
      props: { overlay: makeOverlay(), api: fakeApi as never },
    })
    await wrapper.find('.overlay-item').trigger('contextmenu')
    const menu = document.querySelector('.ctx-menu')
    expect(menu).toBeTruthy()
    const store = usePluginOverlaysStore()
    expect(store.isVisible(makeOverlay())).toBe(true)
    const closeBtn = Array.from(document.querySelectorAll('.ctx-item')).find((b) =>
      b.textContent?.includes('Close overlay')
    ) as HTMLButtonElement | undefined
    expect(closeBtn).toBeTruthy()
    closeBtn!.click()
    await Promise.resolve()
    expect(store.isVisible(makeOverlay())).toBe(false)
    wrapper.unmount()
  })
})
