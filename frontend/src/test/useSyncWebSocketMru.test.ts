import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { PaneLayout, TerminalTab } from '../types/pane'

const mocks = vi.hoisted(() => ({
  apiActivateWorkspace: vi.fn(async () => {}),
}))

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
vi.mock('../composables/useWorkspaceApi', () => ({
  apiListWorkspaces: vi.fn(async () => []),
  apiCreateWorkspace: vi.fn(),
  apiUpdateWorkspace: vi.fn(),
  apiDeleteWorkspace: vi.fn(),
  apiActivateWorkspace: mocks.apiActivateWorkspace,
  apiDeactivateWorkspace: vi.fn(async () => {}),
  apiReorderWorkspaces: vi.fn(),
}))

import { useSyncWebSocket } from '../composables/useSyncWebSocket'
import { useWorkspaces } from '../composables/useWorkspaces'
import { useSessionStore } from '../stores/sessionStore'

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

async function setup() {
  setActivePinia(createPinia())
  const session = useSessionStore()
  const tab = makeTab()
  session.tabs = [tab]
  session.activePaneId = tab.paneId
  const focusActive = vi.fn()
  const subject = useSyncWebSocket({
    termRefs: {},
    persist: vi.fn(),
    focusActive,
    newTab: vi.fn(),
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
  return { tab, emitLayout, focusActive }
}

describe('useSyncWebSocket pane MRU', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    const workspaceState = useWorkspaces()
    workspaceState.workspaces.value = []
    workspaceState.activeWorkspaceId.value = null
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

  it('moves to the successor workspace when sync closes its last active tab', async () => {
    setActivePinia(createPinia())
    const session = useSessionStore()
    const workspaceState = useWorkspaces()
    workspaceState.workspaces.value = [
      { id: 'workspace-a', name: 'Workspace A', path: '/workspace/a', order: 0 },
      { id: 'workspace-b', name: 'Workspace B', path: '/workspace/b', order: 1 },
    ]
    workspaceState.activeWorkspaceId.value = 'workspace-a'
    const workspaceTab = (paneId: string, cwd: string): TerminalTab => ({
      type: 'terminal',
      paneId,
      layout: leaf(`${paneId}-leaf`),
      activePaneId: `${paneId}-leaf`,
      paneMru: [`${paneId}-leaf`],
      broadcastMode: false,
      broadcastActivity: 0,
      previewVisible: false,
      previewAddress: '',
      previewUrl: '',
      previewKind: 'web',
      cwd,
    })
    session.tabs = [
      workspaceTab('workspace-a-only-tab', '/workspace/a'),
      workspaceTab('workspace-b-successor', '/workspace/b'),
    ]
    session.activePaneId = 'workspace-a-only-tab'
    const subject = useSyncWebSocket({
      termRefs: {},
      persist: vi.fn(),
      focusActive: vi.fn(),
      newTab: vi.fn(),
    })
    await subject.connectSyncWS()

    socket.onmessage?.({
      data: JSON.stringify({ type: 'tab_closed', pane_id: 'workspace-a-only-tab' }),
    })
    await vi.waitFor(() => {
      expect(workspaceState.activeWorkspaceId.value).toBe('workspace-b')
    })

    expect(mocks.apiActivateWorkspace).toHaveBeenCalledWith('workspace-b')
    expect(session.activePaneId).toBe('workspace-b-successor')
  })
})
