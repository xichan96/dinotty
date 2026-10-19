import { beforeEach, describe, expect, it, vi } from 'vitest'
import { h } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { mount } from '@vue/test-utils'

// `inheritAttrs: false` would drop `.mc-ws-dual` / the inline style onto the
// stub as attrs instead of rendered ones; both are what these tests read.
vi.mock('motion-v', () => {
  const container = (name: string) => ({
    name,
    inheritAttrs: true,
    setup(_props: any, { slots, attrs }: any) {
      return () => h('div', { ...attrs, class: [name, attrs.class] }, slots.default?.())
    },
  })
  return {
    Motion: container('Motion'),
    AnimatePresence: {
      name: 'AnimatePresence',
      props: ['mode'],
      setup(_props: any, { slots }: any) {
        return () => slots.default?.()
      },
    },
  }
})

const hoisted = vi.hoisted(() => ({
  sendMcOp: vi.fn(),
  toggleServerPicker: vi.fn(),
  closeServerPicker: vi.fn(),
}))

vi.mock('../composables/useMissionControlState', () => ({
  useMissionControlState: () => ({
    open: true,
    selectedWorkspaceId: null,
    selectedTabId: null,
    selectedTabTitle: null,
  }),
  sendMcOp: hoisted.sendMcOp,
}))

vi.mock('../composables/useAppCore', async () => {
  const { ref } = await import('vue')
  const serverPickerOpen = ref(false)
  return {
    serverPickerOpen,
    toggleServerPicker: hoisted.toggleServerPicker,
    closeServerPicker: hoisted.closeServerPicker,
  }
})

import WorkspaceOverview from '../components/overview/WorkspaceOverview.vue'
import { useUiStore } from '../stores/uiStore'

const STORAGE_KEY = 'dinotty_mc_ws_width_v1'

function mountOverview(connected = true) {
  useUiStore().syncConnected = connected
  return mount(WorkspaceOverview, {
    props: {
      visible: true,
      activePaneId: null,
      termRefs: {},
      indicators: {},
    } as any,
    attachTo: document.body,
  })
}

function widthStyle(wrapper: any): string {
  return wrapper.find('.mc-ws-dual').attributes('style') ?? ''
}

function paneWidth(wrapper: any): number {
  const match = widthStyle(wrapper).match(/--mc-ws-list-width:\s*(\d+)px/)
  return match ? Number(match[1]) : NaN
}

async function drag(wrapper: any, from: number, to: number) {
  await wrapper.find('.mc-ws-resizer').trigger('pointerdown', { clientX: from, button: 0 })
  window.dispatchEvent(new MouseEvent('pointermove', { clientX: to }))
  await wrapper.vm.$nextTick()
  window.dispatchEvent(new MouseEvent('pointerup'))
  await wrapper.vm.$nextTick()
}

beforeEach(() => {
  vi.clearAllMocks()
  setActivePinia(createPinia())
  window.localStorage.clear()
})

describe('WorkspaceOverview pane resizer', () => {
  it('renders the separator between the panes only while connected', async () => {
    const connected = mountOverview(true)
    await connected.vm.$nextTick()
    expect(connected.find('.mc-ws-resizer').exists()).toBe(true)

    const offline = mountOverview(false)
    await offline.vm.$nextTick()
    expect(offline.find('.mc-ws-resizer').exists()).toBe(false)
  })

  it('resizes the workspace list while dragging', async () => {
    const wrapper = mountOverview()
    expect(paneWidth(wrapper)).toBe(200)

    await drag(wrapper, 200, 260)

    expect(paneWidth(wrapper)).toBe(260)
  })

  it('clamps to the minimum width and the space left for the tab panel', async () => {
    const wrapper = mountOverview()

    await drag(wrapper, 200, 0)
    expect(paneWidth(wrapper)).toBe(140)

    // happy-dom has no layout, so the container measures 0 and the fallback
    // maximum applies. Still proves the clamp goes through.
    await drag(wrapper, 200, 5000)
    expect(paneWidth(wrapper)).toBeLessThanOrEqual(1200)
    expect(paneWidth(wrapper)).toBeGreaterThan(140)
  })

  it('persists the width for the next open', async () => {
    const first = mountOverview()
    await drag(first, 200, 280)
    first.unmount()

    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('280')

    const second = mountOverview()
    expect(paneWidth(second)).toBe(280)
  })

  it('resets to the default width on double click', async () => {
    const wrapper = mountOverview()
    await drag(wrapper, 200, 300)
    expect(paneWidth(wrapper)).toBe(300)

    await wrapper.find('.mc-ws-resizer').trigger('dblclick')

    expect(paneWidth(wrapper)).toBe(200)
  })

  it('resizes with the keyboard without also navigating tabs', async () => {
    const wrapper = mountOverview()
    const handle = wrapper.find('.mc-ws-resizer')

    await handle.trigger('keydown', { key: 'ArrowRight' })
    expect(paneWidth(wrapper)).toBe(208)
    expect(hoisted.sendMcOp).not.toHaveBeenCalled()

    await handle.trigger('keydown', { key: 'ArrowLeft', shiftKey: true })
    expect(paneWidth(wrapper)).toBe(176)
    expect(hoisted.sendMcOp).not.toHaveBeenCalled()
  })
})
