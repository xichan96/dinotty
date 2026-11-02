import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, nextTick, ref } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import type { Tab, TerminalTab } from '../types/pane'

const mocks = vi.hoisted(() => ({
  tauri: true,
  invoke: vi.fn(),
}))
vi.mock('../composables/useTransport', () => ({
  isTauri: () => mocks.tauri,
  tauriInvoke: mocks.invoke,
}))

const tabApi = vi.hoisted(() => ({ apiActivatePane: vi.fn() }))
vi.mock('../composables/useTabApi', () => tabApi)

import { useDetachedWindows } from '../composables/useDetachedWindows'
import { useDetachedWindowsStore } from '../stores/detachedWindowsStore'
import { apiActivatePane } from '../composables/useTabApi'

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

function setup(initial: string[] = ['a', 'b'], visibleIds?: string[]) {
  const store = useDetachedWindowsStore()
  const tabs = ref<Tab[]>(initial.map(terminalTab))
  const activePaneId = ref<string | null>(initial[0] ?? null)
  // Mirrors useAppCore's visibleTabList: workspace filter + detached filter.
  const visibleTabList = computed(() =>
    (visibleIds ?? initial).filter((id) => !store.isDetached(id)).map((id) => ({ paneId: id }))
  )
  const commitLocalActivePane = vi.fn((id: string) => {
    activePaneId.value = id
  })
  const focusActive = vi.fn()
  const toast = { error: vi.fn() }
  const t = (key: string) => key

  const dw = useDetachedWindows({
    tabs,
    activePaneId,
    visibleTabList,
    commitLocalActivePane,
    focusActive,
    toast,
    t,
  })

  return {
    store,
    tabs,
    activePaneId,
    visibleTabList,
    commitLocalActivePane,
    focusActive,
    toast,
    dw,
  }
}

describe('useDetachedWindows', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    mocks.tauri = true
    mocks.invoke.mockReset()
  })

  afterEach(() => {
    delete (window as any).__TAURI__
  })

  it('moves the active tab to a neighbor and opens the window without apiActivatePane', async () => {
    const { store, activePaneId, commitLocalActivePane, dw } = setup()
    mocks.invoke.mockResolvedValue(undefined)

    expect(await dw.detachTab('a')).toBe(true)

    expect(store.isDetached('a')).toBe(true)
    expect(commitLocalActivePane).toHaveBeenCalledWith('b')
    expect(activePaneId.value).toBe('b')
    expect(apiActivatePane).not.toHaveBeenCalled()
    expect(mocks.invoke).toHaveBeenCalledWith('open_tab_window', { tabId: 'a', title: 'a' })
  })

  it('leaves the active tab alone when detaching a background tab', async () => {
    const { activePaneId, commitLocalActivePane, dw } = setup()
    mocks.invoke.mockResolvedValue(undefined)

    await dw.detachTab('b')

    expect(activePaneId.value).toBe('a')
    expect(commitLocalActivePane).not.toHaveBeenCalled()
  })

  it('restores the active tab and toasts when the window cannot be created', async () => {
    const { store, activePaneId, toast, dw } = setup()
    mocks.invoke.mockRejectedValue(new Error('boom'))

    expect(await dw.detachTab('a')).toBe(false)

    expect(store.isDetached('a')).toBe(false)
    expect(activePaneId.value).toBe('a')
    expect(toast.error).toHaveBeenCalledWith('tab.detachFailed')
  })

  it('remounts and focuses the tab when its window closes', async () => {
    const { store, activePaneId, commitLocalActivePane, focusActive, dw } = setup()
    mocks.invoke.mockResolvedValue(undefined)
    await dw.detachTab('a')
    expect(activePaneId.value).toBe('b')

    commitLocalActivePane.mockClear()
    await dw.onTabWindowClosed('a')

    expect(store.isDetached('a')).toBe(false)
    expect(commitLocalActivePane).toHaveBeenCalledWith('a')
    expect(activePaneId.value).toBe('a')
    expect(focusActive).toHaveBeenCalled()
  })

  it('does not steal focus when the returned tab is outside the current workspace', async () => {
    const { store, activePaneId, commitLocalActivePane, dw } = setup(['a', 'b'], ['b'])
    activePaneId.value = 'b'
    mocks.invoke.mockResolvedValue([{ tab_id: 'a', label: 'tab-a', title: null }])
    await store.refreshFromRust()
    await nextTick()

    commitLocalActivePane.mockClear()
    await dw.onTabWindowClosed('a')

    expect(store.isDetached('a')).toBe(false)
    expect(commitLocalActivePane).not.toHaveBeenCalled()
    expect(activePaneId.value).toBe('b')
  })

  it('bridges the tab-window-closed event into the store and unlistens', async () => {
    const { store, commitLocalActivePane, dw } = setup()
    let handler: ((event: { payload?: { tab_id?: string } }) => void) | undefined
    const unlisten = vi.fn()
    const listen = vi.fn(async (_name: string, cb: typeof handler) => {
      handler = cb
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
    handler?.({ payload: { tab_id: 'a' } })
    await nextTick()
    await nextTick()

    expect(store.isDetached('a')).toBe(false)
    expect(commitLocalActivePane).toHaveBeenCalledWith('a')

    dispose()
    expect(unlisten).toHaveBeenCalled()
  })
})
