import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, nextTick, ref } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import type { Tab, TerminalTab } from '../types/pane'

const mocks = vi.hoisted(() => ({
  tauri: true,
  invoke: vi.fn(),
  setWorkspace: vi.fn(async (_tabId: string, _workspaceId: string | null) => {}),
}))
vi.mock('../composables/useTransport', () => ({
  isTauri: () => mocks.tauri,
  tauriInvoke: mocks.invoke,
}))
vi.mock('../composables/useTabApi', () => ({
  apiSetTabWorkspace: mocks.setWorkspace,
}))

import { useDetachedWindows } from '../composables/useDetachedWindows'
import { useDetachedWindowsStore } from '../stores/detachedWindowsStore'

function terminalTab(paneId: string): TerminalTab {
  return {
    type: 'terminal',
    paneId,
    layout: {
      type: 'split',
      id: `s-${paneId}`,
      direction: 'horizontal',
      children: [{ type: 'leaf', paneId, title: paneId, ratio: 1, zoomed: false }],
      ratios: [1],
    },
    activePaneId: paneId,
    paneMru: [paneId],
    broadcastMode: false,
    broadcastActivity: 0,
  }
}

function setup(
  initial: string[] = ['a', 'b'],
  options: { activeWorkspaceId?: string | null } = {}
) {
  const store = useDetachedWindowsStore()
  const tabs = ref<Tab[]>(initial.map(terminalTab))
  const activePaneId = ref<string | null>(initial[0] ?? null)
  const activeWorkspaceId = ref<string | null>(options.activeWorkspaceId ?? null)
  const workspaceIdOfTab = (tab: Tab): string | null =>
    tab.workspaceId === '__default__' ? null : (tab.workspaceId ?? null)
  // Mirrors useAppCore's visibleTabList: workspace filter + detached filter,
  // both derived from the live tab list.
  const visibleTabList = computed(() =>
    tabs.value
      .filter(
        (tab) =>
          !store.isDetached(tab.paneId) &&
          workspaceIdOfTab(tab) === activeWorkspaceId.value
      )
      .map((tab) => ({ paneId: tab.paneId }))
  )
  const commitLocalActivePane = vi.fn((id: string) => {
    activePaneId.value = id
  })
  const focusActive = vi.fn()
  const closeTab = vi.fn(async (id: string) => {
    const idx = tabs.value.findIndex((tab) => tab.paneId === id)
    if (idx !== -1) tabs.value.splice(idx, 1)
  })
  const toast = { error: vi.fn() }
  const t = (key: string) => key

  const dw = useDetachedWindows({
    tabs,
    activePaneId,
    activeWorkspaceId,
    workspaceIdOfTab,
    visibleTabList,
    commitLocalActivePane,
    focusActive,
    closeTab,
    toast,
    t,
  })

  return {
    store,
    tabs,
    activePaneId,
    activeWorkspaceId,
    visibleTabList,
    commitLocalActivePane,
    focusActive,
    closeTab,
    toast,
    dw,
  }
}

describe('useDetachedWindows', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    mocks.tauri = true
    mocks.invoke.mockReset()
    mocks.setWorkspace.mockClear()
  })

  afterEach(() => {
    delete (window as any).__TAURI__
  })

  it('marks the tab detached and unmounts its pane before opening the window', async () => {
    const { store, activePaneId, commitLocalActivePane, visibleTabList, dw } = setup()
    const atOpen: Array<{ detached: boolean; mounted: boolean }> = []
    mocks.invoke.mockImplementation(async (command: string) => {
      if (command !== 'open_tab_window') return
      // Snapshot the render-relevant state at the moment the window is
      // created: the store must already report the id, and the filtered list
      // the main window renders must already have dropped the tab.
      atOpen.push({
        detached: store.isDetached('a'),
        mounted: visibleTabList.value.some((tab) => tab.paneId === 'a'),
      })
    })

    expect(await dw.detachTab('a')).toBe(true)

    expect(atOpen).toEqual([{ detached: true, mounted: false }])
    expect(commitLocalActivePane).toHaveBeenCalledWith('b')
    expect(activePaneId.value).toBe('b')
    expect(mocks.invoke).toHaveBeenCalledWith('open_tab_window', { tabId: 'a', title: 'a' })
  })

  it('leaves the active tab alone when detaching a background tab', async () => {
    const { activePaneId, commitLocalActivePane, dw } = setup()
    mocks.invoke.mockResolvedValue(undefined)

    await dw.detachTab('b')

    expect(activePaneId.value).toBe('a')
    expect(commitLocalActivePane).not.toHaveBeenCalled()
  })

  it('rolls the mark back, keeps the tab, and restores activation on failure', async () => {
    const { store, tabs, activePaneId, visibleTabList, toast, dw } = setup()
    mocks.invoke.mockRejectedValue(new Error('boom'))

    expect(await dw.detachTab('a')).toBe(false)

    expect(store.isDetached('a')).toBe(false)
    // The tab never left the store, and it is renderable again.
    expect(tabs.value.some((tab) => tab.paneId === 'a')).toBe(true)
    expect(visibleTabList.value.some((tab) => tab.paneId === 'a')).toBe(true)
    expect(activePaneId.value).toBe('a')
    expect(toast.error).toHaveBeenCalledWith('tab.detachFailed')
  })

  it('closes the terminal when its window closes without a reattach intent', async () => {
    const { store, tabs, visibleTabList, closeTab, dw } = setup()
    mocks.invoke.mockResolvedValue(undefined)
    await dw.detachTab('a')

    await dw.onTabWindowClosed('a')

    expect(closeTab).toHaveBeenCalledWith('a')
    expect(store.isDetached('a')).toBe(false)
    expect(tabs.value.some((tab) => tab.paneId === 'a')).toBe(false)
    expect(visibleTabList.value.some((tab) => tab.paneId === 'a')).toBe(false)
  })

  it('remounts and activates the tab locally on a recall', async () => {
    const { store, activePaneId, commitLocalActivePane, focusActive, visibleTabList, closeTab, dw } =
      setup()
    mocks.invoke.mockResolvedValue(undefined)
    await dw.detachTab('a')
    expect(activePaneId.value).toBe('b')
    expect(visibleTabList.value.some((tab) => tab.paneId === 'a')).toBe(false)

    commitLocalActivePane.mockClear()
    mocks.invoke.mockClear()
    await dw.onTabWindowClosed('a', true)

    expect(closeTab).not.toHaveBeenCalled()
    expect(store.isDetached('a')).toBe(false)
    expect(commitLocalActivePane).toHaveBeenCalledWith('a')
    expect(activePaneId.value).toBe('a')
    expect(visibleTabList.value.some((tab) => tab.paneId === 'a')).toBe(true)
    expect(focusActive).toHaveBeenCalled()
    // Recalling is purely local: the server's active pane is not touched.
    expect(mocks.invoke).not.toHaveBeenCalled()
  })

  it('rehomes a recalled tab into the workspace the main window is showing', async () => {
    const { store, tabs, activePaneId, commitLocalActivePane, visibleTabList, dw } = setup(
      ['a', 'b'],
      { activeWorkspaceId: 'ws-b' }
    )
    const tabA = tabs.value.find((tab) => tab.paneId === 'a')!
    const tabB = tabs.value.find((tab) => tab.paneId === 'b')!
    tabA.workspaceId = 'ws-a'
    tabB.workspaceId = 'ws-b'
    activePaneId.value = 'b'

    mocks.invoke.mockResolvedValue([{ tab_id: 'a', label: 'tab-a', title: null }])
    await store.refreshFromRust()
    await nextTick()
    expect(visibleTabList.value.some((tab) => tab.paneId === 'a')).toBe(false)

    commitLocalActivePane.mockClear()
    await dw.onTabWindowClosed('a', true)

    expect(mocks.setWorkspace).toHaveBeenCalledWith('a', 'ws-b')
    expect(tabA.workspaceId).toBe('ws-b')
    expect(store.isDetached('a')).toBe(false)
    expect(visibleTabList.value.some((tab) => tab.paneId === 'a')).toBe(true)
    expect(commitLocalActivePane).toHaveBeenCalledWith('a')
    expect(activePaneId.value).toBe('a')
  })

  it('pins a recalled tab to the default workspace explicitly', async () => {
    const { store, tabs, commitLocalActivePane, activeWorkspaceId, dw } = setup()
    const tabA = tabs.value.find((tab) => tab.paneId === 'a')!
    tabA.workspaceId = 'ws-a'
    expect(activeWorkspaceId.value).toBeNull()

    mocks.invoke.mockResolvedValue([{ tab_id: 'a', label: 'tab-a', title: null }])
    await store.refreshFromRust()
    await nextTick()

    commitLocalActivePane.mockClear()
    await dw.onTabWindowClosed('a', true)

    // Clearing the assignment would let cwd attribution pick ws-a again.
    expect(mocks.setWorkspace).toHaveBeenCalledWith('a', '__default__')
    expect(tabA.workspaceId).toBe('__default__')
    expect(commitLocalActivePane).toHaveBeenCalledWith('a')
  })

  it('rolls the workspace move back when the server rejects it', async () => {
    const { store, tabs, toast, dw } = setup(['a', 'b'], { activeWorkspaceId: 'ws-b' })
    const tabA = tabs.value.find((tab) => tab.paneId === 'a')!
    const tabB = tabs.value.find((tab) => tab.paneId === 'b')!
    tabA.workspaceId = 'ws-a'
    tabB.workspaceId = 'ws-b'
    mocks.invoke.mockResolvedValue([{ tab_id: 'a', label: 'tab-a', title: null }])
    await store.refreshFromRust()
    await nextTick()
    mocks.setWorkspace.mockRejectedValueOnce(new Error('boom'))

    await dw.onTabWindowClosed('a', true)
    await nextTick()

    expect(tabA.workspaceId).toBe('ws-a')
    expect(toast.error).toHaveBeenCalledWith('tab.recallWorkspaceFailed')
  })

  it('bridges the tab-window-closed event into the store and unlistens', async () => {
    const { store, commitLocalActivePane, dw } = setup()
    const handlers = new Map<string, (event: any) => void>()
    const unlisten = vi.fn()
    const listen = vi.fn(async (name: string, cb: (event: any) => void) => {
      handlers.set(name, cb)
      return unlisten
    })
    ;(window as any).__TAURI__ = { event: { listen } }

    mocks.invoke.mockResolvedValue([{ tab_id: 'a', label: 'tab-a', title: null }])
    await store.refreshFromRust()
    await nextTick()
    commitLocalActivePane.mockClear()

    const dispose = dw.setupListener()
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(listen).toHaveBeenCalledWith('tab-window-closed', expect.any(Function))
    expect(listen).toHaveBeenCalledWith('detached-dock-hint', expect.any(Function))
    handlers.get('tab-window-closed')?.({ payload: { tab_id: 'a', reattach: true } })
    await nextTick()
    await nextTick()

    expect(store.isDetached('a')).toBe(false)
    expect(commitLocalActivePane).toHaveBeenCalledWith('a')

    dispose()
    expect(unlisten).toHaveBeenCalledTimes(2)
  })
})
