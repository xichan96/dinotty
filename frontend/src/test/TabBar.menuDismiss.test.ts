import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'

vi.mock('vue-toastification', () => ({
  useToast: () => ({ info: vi.fn(), error: vi.fn(), warning: vi.fn(), success: vi.fn() }),
  POSITION: { TOP_RIGHT: 'top-right' },
}))

import TabBar from '../components/terminal/TabBar.vue'

function mountBar() {
  return mount(TabBar, {
    attachTo: document.body,
    props: {
      tabs: [{ paneId: 'p-1', title: 'Terminal', index: 0, type: 'terminal' }],
      activePaneId: 'p-1',
      plugins: [{ id: 'pl-1', name: 'Demo', state: 'loaded', showInToolbar: true }],
      toolbarOrder: ['new_tab', 'plugins'],
    },
  })
}

/**
 * The wraps carrying these menus sit inside TabBar's `toolbarOrder` v-for, so a
 * string ref there is compiled with `ref_for` and the runtime collects it into
 * an array. Every consumer then threw on the first DOM call — which left both
 * menus stuck open, since `onDocMenuMouseDown` bails on the plugin wrap before
 * it can close the new-tab one.
 */
describe('TabBar dropdown menus dismiss on outside click', () => {
  let wrapper: ReturnType<typeof mountBar>

  beforeEach(() => {
    setActivePinia(createPinia())
  })

  afterEach(() => {
    wrapper?.unmount()
    document.body.replaceChildren()
  })

  function outsideMouseDown() {
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
  }

  it('closes the new-tab menu when clicking blank space', async () => {
    wrapper = mountBar()
    await wrapper.find('#tab-new-btn').trigger('click')
    expect(wrapper.find('.new-menu-dropdown').exists()).toBe(true)

    outsideMouseDown()
    await nextTick()

    expect(wrapper.find('.new-menu-dropdown').exists()).toBe(false)
  })

  it('closes the plugin menu when clicking blank space', async () => {
    wrapper = mountBar()
    await wrapper.find('.tab-bar-plugin-wrap button').trigger('click')
    expect(wrapper.find('.plugin-dropdown').exists()).toBe(true)

    outsideMouseDown()
    await nextTick()

    expect(wrapper.find('.plugin-dropdown').exists()).toBe(false)
  })

  it('keeps a menu open when the click lands inside its own wrap', async () => {
    wrapper = mountBar()
    const wrap = wrapper.find('.new-tab-split')
    await wrapper.find('#tab-new-btn').trigger('click')

    wrap.element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    await nextTick()

    expect(wrapper.find('.new-menu-dropdown').exists()).toBe(true)
  })

  it('measures the new-tab wrap to flip the menu at the viewport edge', async () => {
    wrapper = mountBar()
    const wrap = wrapper.find('.new-tab-split')
    // happy-dom reports a zero rect, which never trips the edge check.
    wrap.element.getBoundingClientRect = () => ({ right: window.innerWidth }) as DOMRect

    await wrapper.find('#tab-new-btn').trigger('click')
    await nextTick()
    await nextTick()

    expect(wrapper.find('.new-menu-dropdown').classes()).toContain('align-right')
  })
})
