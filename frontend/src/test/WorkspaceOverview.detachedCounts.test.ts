import { beforeEach, describe, expect, it, vi } from 'vitest'
import { h, nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { mount } from '@vue/test-utils'

// Spread attrs so the card listeners/classes survive the stub.
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
  invoke: vi.fn(),
  sendMcOp: vi.fn(),
}))

vi.mock('../composables/useTransport', () => ({
  isTauri: () => true,
  tauriInvoke: hoisted.invoke,
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
  return {
    serverPickerOpen: ref(false),
    toggleServerPicker: vi.fn(),
    closeServerPicker: vi.fn(),
  }
})

vi.mock('../composables/useConfirm', () => ({ uiConfirm: vi.fn() }))

import WorkspaceOverview from '../components/overview/WorkspaceOverview.vue'
import WorkspaceList from '../components/overview/WorkspaceList.vue'
import { DEFAULT_WORKSPACE_ID } from '../composables/useWorkspaces'
import { useDetachedWindowsStore } from '../stores/detachedWindowsStore'
import { useSessionStore } from '../stores/sessionStore'
import { useUiStore } from '../stores/uiStore'
import type { TerminalTab } from '../types/pane'

function terminalTab(paneId: string, title: string): TerminalTab {
  return {
    type: 'terminal',
    paneId,
    layout: {
      type: 'leaf',
      paneId,
      title,
      ratio: 1,
      zoomed: false,
    },
    activePaneId: paneId,
    paneMru: [paneId],
    broadcastMode: false,
    broadcastActivity: 0,
  }
}

beforeEach(() => {
  setActivePinia(createPinia())
  hoisted.invoke.mockReset()
  hoisted.sendMcOp.mockReset()
})

describe('WorkspaceOverview - detached tabs stay in counts and grouping', () => {
  it('counts a detached tab in the default workspace and still renders its card', async () => {
    const session = useSessionStore()
    session.setTabs([terminalTab('tab-a', 'Alpha'), terminalTab('tab-b', 'Beta')])
    useUiStore().syncConnected = true

    const store = useDetachedWindowsStore()
    hoisted.invoke.mockResolvedValue([
      { tab_id: 'tab-a', label: 'tab-tab-a', title: 'Alpha window' },
    ])
    await store.refreshFromRust()

    const wrapper = mount(WorkspaceOverview, {
      props: {
        visible: true,
        activePaneId: 'tab-b',
        termRefs: {},
        indicators: {},
      } as any,
      attachTo: document.body,
    })

    // The capture is deferred with setTimeout(0); wait for it so the grid and
    // the live detached overlay have both been applied.
    await new Promise((resolve) => setTimeout(resolve, 0))
    await nextTick()

    const list = wrapper.findComponent(WorkspaceList)
    expect(list.props('tabCounts')[DEFAULT_WORKSPACE_ID]).toBe(2)
    expect(list.props('defaultCount')).toBe(2)

    // Default grouping is unchanged: the detached tab's card is still there,
    // now carrying the badge and the native window title.
    const badges = wrapper.findAll('.mc-detached-badge')
    expect(badges).toHaveLength(1)
    expect(badges[0].attributes('title')).toBe('Alpha window')
  })
})
