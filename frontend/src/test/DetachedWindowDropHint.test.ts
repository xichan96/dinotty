import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { afterEach, describe, expect, it } from 'vitest'
import DetachedWindowDropHint from '../components/terminal/DetachedWindowDropHint.vue'
import { usePaneDrag } from '../composables/paneDragContext'
import { useDetachedWindowFeedback } from '../composables/detachedWindowFeedback'

function mountTabBar(): void {
  const element = document.createElement('div')
  element.id = 'tab-bar'
  element.getBoundingClientRect = () =>
    ({
      left: 10,
      top: 20,
      width: 300,
      height: 40,
      x: 10,
      y: 20,
      right: 310,
      bottom: 60,
      toJSON: () => ({}),
    }) as DOMRect
  document.body.appendChild(element)
}

describe('DetachedWindowDropHint', () => {
  const drag = usePaneDrag()
  const feedback = useDetachedWindowFeedback()

  afterEach(() => {
    drag.endDrag()
    feedback.setDockHint(null)
    document.body.replaceChildren()
  })

  it('shows the detach hint only after a whole-tab drag leaves the window', async () => {
    drag.startDrag({ sourcePaneId: 'a', sourceTabId: 'a', wholeTab: true })
    const wrapper = mount(DetachedWindowDropHint)
    expect(wrapper.find('.dw-hint').exists()).toBe(false)

    // Still inside the window: existing tab/pane drop previews own the feedback.
    drag.setOutsideWindow(false)
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.dw-hint').exists()).toBe(false)

    drag.setOutsideWindow(true)
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.dw-hint--detach').exists()).toBe(true)
  })

  it('ignores pane drags, which never detach', async () => {
    drag.startDrag({ sourcePaneId: 'a', sourceTabId: 'a' })
    drag.setOutsideWindow(true)
    const wrapper = mount(DetachedWindowDropHint)

    expect(wrapper.find('.dw-hint').exists()).toBe(false)
  })

  it('highlights the actual tab bar when a detached window is about to dock', async () => {
    mountTabBar()
    const wrapper = mount(DetachedWindowDropHint)
    expect(wrapper.find('.dw-hint').exists()).toBe(false)

    feedback.setDockHint('a')
    await nextTick()

    expect(wrapper.find('.dw-hint--dock').exists()).toBe(true)
    const style = wrapper.find('.dw-hint__frame').attributes('style') ?? ''
    expect(style).toContain('left: 10px')
    expect(style).toContain('top: 20px')
    expect(style).toContain('width: 300px')
    expect(style).toContain('height: 40px')

    feedback.setDockHint(null)
    await nextTick()
    expect(wrapper.find('.dw-hint').exists()).toBe(false)
  })

  it('does not show the dock hint when the tab bar is not rendered', async () => {
    const wrapper = mount(DetachedWindowDropHint)

    feedback.setDockHint('a')
    await nextTick()

    expect(wrapper.find('.dw-hint').exists()).toBe(false)
  })
})
