import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { PaneLayout, TerminalTab } from '../types/pane'
import type { SyncTabList } from '../types/protocol'

let socket: MockWebSocket
class MockWebSocket {
  static OPEN = 1
  readyState = MockWebSocket.OPEN
  onopen: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  onclose: ((event: { code: number; reason: string }) => void) | null = null
  onerror: (() => void) | null = null
  send = vi.fn()
  close = vi.fn()
  constructor(public url: string) {
    socket = this
  }
}
vi.stubGlobal('WebSocket', MockWebSocket)

vi.mock('../composables/apiBase', () => ({
  getApiBase: async () => 'http://localhost',
  wsUrlWithToken: (url: string) => url,
  hasAuthToken: () => false,
}))
vi.mock('../composables/useTransport', () => ({ isTauri: () => false }))
vi.mock('../composables/usePluginLoader', () => ({ handlePluginChanged: vi.fn() }))

import { useSyncWebSocket } from '../composables/useSyncWebSocket'
import { useSessionStore } from '../stores/sessionStore'

const localStorageMock = (() => {
  const store = new Map<string, string>()
  return {
    clear: () => store.clear(),
    getItem: (key: string) => store.get(key) ?? null,
    removeItem: (key: string) => store.delete(key),
    setItem: (key: string, value: string) => store.set(key, value),
  }
})()
vi.stubGlobal('localStorage', localStorageMock)

function leaf(paneId: string): PaneLayout {
  return { type: 'leaf', paneId, title: paneId, ratio: 1, zoomed: false }
}

function layout(...ids: string[]): PaneLayout {
  return {
    type: 'split',
    id: 'root',
    direction: 'horizontal',
    children: ids.map(leaf),
    ratios: ids.map(() => 1 / ids.length),
  }
}

function makeTab(): TerminalTab {
  return {
    type: 'terminal',
    paneId: 'tab-1',
    layout: layout('a', 'b', 'c'),
    activePaneId: 'b',
    paneMru: ['b', 'a', 'c'],
    broadcastMode: false,
    broadcastActivity: 0,
    previewVisible: false,
    previewAddress: '',
    previewUrl: '',
    previewKind: 'web',
  }
}

async function setup(pluginOpts?: {
  loadedPlugins?: Map<string, any>
  initialPluginLoad?: () => Promise<void>
}) {
  setActivePinia(createPinia())
  const session = useSessionStore()
  const tab = makeTab()
  session.tabs = [tab]
  session.activePaneId = tab.paneId
  const focusActive = vi.fn()
  const newTab = vi.fn().mockResolvedValue(undefined)
  const subject = useSyncWebSocket({
    termRefs: {},
    persist: vi.fn(),
    focusActive,
    newTab,
    loadedPlugins: pluginOpts?.loadedPlugins ?? new Map(),
    initialPluginLoad: pluginOpts?.initialPluginLoad ?? (() => Promise.resolve()),
  })
  await subject.connectSyncWS()
  const emitLayout = (nextLayout: PaneLayout, serverActivePaneId: string) => {
    socket.onmessage?.({
      data: JSON.stringify({
        type: 'layout_updated',
        pane_id: tab.paneId,
        layout: nextLayout,
        active_pane_id: serverActivePaneId,
      }),
    })
  }
  const emitTabList = (tabs: SyncTabList['tabs'] = []) => {
    socket.onmessage?.({
      data: JSON.stringify({ type: 'tab_list', tabs, active_pane_id: null }),
    })
  }
  return { tab, session, subject, emitLayout, emitTabList, focusActive, newTab }
}

describe('useSyncWebSocket pane MRU', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorageMock.clear()
  })

  it('drops a cached plugin tab after initial loading confirms it is no longer installed', async () => {
    let finishLoad!: () => void
    const initialPluginLoad = () => new Promise<void>((resolve) => { finishLoad = resolve })
    localStorage.setItem(
      'dinotty_tabs',
      JSON.stringify({
        tabs: [{ type: 'plugin', paneId: 'plugin:legacy', title: 'Legacy', pluginId: 'legacy' }],
        activeIdx: 0,
      }),
    )
    const { session, emitTabList, newTab } = await setup({ initialPluginLoad })

    emitTabList()

    expect(session.tabs).toContainEqual({
      type: 'plugin',
      paneId: 'plugin:legacy',
      title: 'Legacy',
      pluginId: 'legacy',
    })
    expect(newTab).not.toHaveBeenCalled()

    finishLoad()
    await Promise.resolve()

    expect(session.tabs.some((tab) => tab.type === 'plugin')).toBe(false)
    expect(newTab).toHaveBeenCalledOnce()
  })

  it('does not restore a known-invalid cached plugin on a later tab_list from the same connection', async () => {
    localStorage.setItem(
      'dinotty_tabs',
      JSON.stringify({
        tabs: [{ type: 'plugin', paneId: 'plugin:legacy', title: 'Legacy', pluginId: 'legacy' }],
        activeIdx: 0,
      }),
    )
    const { tab, session, emitTabList } = await setup()
    const serverTabs = [
      { tab_id: tab.paneId, pane_id: 'a', active_pane_id: tab.activePaneId, layout: tab.layout },
    ]

    emitTabList(serverTabs)
    await Promise.resolve()

    expect(session.tabs.some((candidate) => candidate.paneId === 'plugin:legacy')).toBe(false)

    emitTabList(serverTabs)

    expect(session.tabs.some((candidate) => candidate.paneId === 'plugin:legacy')).toBe(false)
  })

  it('does not restore a known-invalid cached plugin after reconnect', async () => {
    localStorage.setItem(
      'dinotty_tabs',
      JSON.stringify({
        tabs: [{ type: 'plugin', paneId: 'plugin:legacy', title: 'Legacy', pluginId: 'legacy' }],
        activeIdx: 0,
      }),
    )
    const { tab, session, subject, emitTabList } = await setup()
    const serverTabs = [
      { tab_id: tab.paneId, pane_id: 'a', active_pane_id: tab.activePaneId, layout: tab.layout },
    ]

    emitTabList(serverTabs)
    await Promise.resolve()

    expect(session.tabs.some((candidate) => candidate.paneId === 'plugin:legacy')).toBe(false)

    await subject.connectSyncWS()
    emitTabList(serverTabs)

    expect(session.tabs.some((candidate) => candidate.paneId === 'plugin:legacy')).toBe(false)
  })

  it('restores an installed plugin tab with its current manifest title', async () => {
    const loadedPlugins = new Map([
      ['memory', { manifest: { id: 'memory', name: 'Current Memory' } }],
    ])
    localStorage.setItem(
      'dinotty_tabs',
      JSON.stringify({
        tabs: [
          {
            type: 'plugin',
            paneId: 'plugin:memory',
            title: 'Stale Memory',
            pluginId: 'memory',
            workspaceId: 'workspace-1',
          },
        ],
        activeIdx: 0,
      }),
    )
    const { session, emitTabList, newTab } = await setup({ loadedPlugins })

    emitTabList()
    await Promise.resolve()

    expect(session.tabs).toContainEqual({
      type: 'plugin',
      paneId: 'plugin:memory',
      title: 'Current Memory',
      pluginId: 'memory',
      workspaceId: 'workspace-1',
    })
    expect(newTab).not.toHaveBeenCalled()
  })

  it('keeps a cached plugin tab until the initial plugin load completes', async () => {
    let finishLoad!: () => void
    const loadedPlugins = new Map<string, any>()
    const initialPluginLoad = vi.fn(
      () => new Promise<void>((resolve) => { finishLoad = resolve }),
    )
    localStorage.setItem(
      'dinotty_tabs',
      JSON.stringify({
        tabs: [
          {
            type: 'plugin',
            paneId: 'plugin:memory',
            title: 'Cached Memory',
            pluginId: 'memory',
          },
        ],
        activeIdx: 0,
      }),
    )
    const { session, emitTabList, newTab } = await setup({ loadedPlugins, initialPluginLoad })

    emitTabList()

    expect(session.tabs).toContainEqual({
      type: 'plugin',
      paneId: 'plugin:memory',
      title: 'Cached Memory',
      pluginId: 'memory',
    })
    expect(newTab).not.toHaveBeenCalled()

    loadedPlugins.set('memory', { manifest: { id: 'memory', name: 'Current Memory' } })
    finishLoad()
    await Promise.resolve()

    expect(session.tabs).toContainEqual({
      type: 'plugin',
      paneId: 'plugin:memory',
      title: 'Current Memory',
      pluginId: 'memory',
    })
    expect(newTab).not.toHaveBeenCalled()
  })

  it('keeps an existing in-memory plugin tab when the server omits it', async () => {
    const { session, emitTabList, newTab } = await setup()
    session.tabs = [
      { type: 'plugin', paneId: 'plugin:memory', title: 'Memory', pluginId: 'memory' },
    ]

    emitTabList()

    expect(session.tabs).toEqual([
      { type: 'plugin', paneId: 'plugin:memory', title: 'Memory', pluginId: 'memory' },
    ])
    expect(newTab).not.toHaveBeenCalled()
  })

  it('does not use a legacy plugin record as saved terminal state', async () => {
    localStorage.setItem(
      'dinotty_tabs',
      JSON.stringify({
        tabs: [
          {
            type: 'plugin',
            paneId: 'server-pane',
            title: 'Legacy plugin',
            pluginId: 'legacy',
            previewVisible: true,
          },
        ],
        activeIdx: 0,
      }),
    )
    const { session, emitTabList } = await setup()

    emitTabList([{ tab_id: 'server-tab', pane_id: 'server-pane' }])

    const restored = session.tabs.find((tab) => tab.paneId === 'server-tab')
    expect(restored?.type).toBe('terminal')
    expect(restored?.type === 'terminal' && restored.previewVisible).toBe(false)
  })

  it('uses and focuses the MRU fallback when a focused pane exits', async () => {
    const { tab, emitLayout, focusActive } = await setup()
    emitLayout(layout('a', 'c'), 'c')
    await Promise.resolve()
    expect(tab.paneMru).toEqual(['a', 'c'])
    expect(tab.activePaneId).toBe('a')
    expect(focusActive).toHaveBeenCalledOnce()
  })

  it('preserves focus when a non-focused pane exits', async () => {
    const { tab, emitLayout } = await setup()
    emitLayout(layout('a', 'b'), 'b')
    expect(tab.paneMru).toEqual(['b', 'a'])
    expect(tab.activePaneId).toBe('b')
  })

  it('applies a pane focus change received from another client', async () => {
    const { tab, emitLayout, focusActive } = await setup()
    emitLayout(layout('a', 'b', 'c'), 'c')
    await Promise.resolve()
    expect(tab.paneMru).toEqual(['c', 'b', 'a'])
    expect(tab.activePaneId).toBe('c')
    expect(focusActive).toHaveBeenCalledOnce()
  })

  it('keeps the synchronized focus when another client closes a non-focused pane', async () => {
    const { tab, emitLayout } = await setup()
    emitLayout(layout('a', 'b', 'c'), 'c')
    emitLayout(layout('a', 'c'), 'c')
    expect(tab.paneMru).toEqual(['c', 'a'])
    expect(tab.activePaneId).toBe('c')
  })

  it('keeps MRU unique after a duplicate layout message', async () => {
    const { tab, emitLayout } = await setup()
    tab.paneMru = ['b', 'b', 'a', 'c']
    emitLayout(layout('a', 'b', 'c'), 'b')
    expect(tab.paneMru).toEqual(['b', 'a', 'c'])
  })
})
