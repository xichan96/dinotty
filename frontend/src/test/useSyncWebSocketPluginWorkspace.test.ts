import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { PaneLayout, TerminalTab } from '../types/pane'

const mocks = vi.hoisted(() => ({
  apiActivateWorkspace: vi.fn(async () => {}),
  apiDeactivateWorkspace: vi.fn(async () => {}),
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

class MemoryStorage {
  private values = new Map<string, string>()
  getItem(key: string) {
    return this.values.get(key) ?? null
  }
  setItem(key: string, value: string) {
    this.values.set(key, value)
  }
  removeItem(key: string) {
    this.values.delete(key)
  }
  clear() {
    this.values.clear()
  }
}
vi.stubGlobal('localStorage', new MemoryStorage())

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
  apiDeactivateWorkspace: mocks.apiDeactivateWorkspace,
  apiReorderWorkspaces: vi.fn(),
}))

import { useSyncWebSocket } from '../composables/useSyncWebSocket'
import { useWorkspaces } from '../composables/useWorkspaces'
import { useSessionStore } from '../stores/sessionStore'

function leaf(paneId: string): PaneLayout {
  return { type: 'leaf', paneId: `${paneId}-leaf`, title: paneId, ratio: 1, zoomed: false }
}

function terminal(
  paneId: string,
  options: { workspaceId?: string | null; cwd?: string } = {}
): TerminalTab {
  return {
    type: 'terminal',
    paneId,
    layout: leaf(paneId),
    activePaneId: `${paneId}-leaf`,
    paneMru: [`${paneId}-leaf`],
    broadcastMode: false,
    broadcastActivity: 0,
    previewVisible: false,
    previewAddress: '',
    previewUrl: '',
    previewKind: 'web',
    workspaceId: options.workspaceId as string | undefined,
    cwd: options.cwd,
  }
}

async function setup(
  initialTabs: TerminalTab[] = [],
  activePaneId: string | null = initialTabs[0]?.paneId ?? null
) {
  setActivePinia(createPinia())
  const session = useSessionStore()
  session.tabs = initialTabs
  session.activePaneId = activePaneId
  const workspaceState = useWorkspaces()
  workspaceState.workspaces.value = [
    { id: 'workspace-a', name: 'Workspace A', path: '/workspace/a', order: 0 },
    { id: 'workspace-b', name: 'Workspace B', path: '/workspace/b', order: 1 },
  ]
  workspaceState.activeWorkspaceId.value = 'workspace-a'
  const persist = vi.fn()
  const subject = useSyncWebSocket({
    termRefs: {},
    persist,
    focusActive: vi.fn(),
    newTab: vi.fn(async () => {}),
  })
  await subject.connectSyncWS()
  const emit = (message: Record<string, unknown>) => {
    socket.onmessage?.({ data: JSON.stringify(message) })
  }
  return { session, workspaceState, persist, emit }
}

describe('useSyncWebSocket plugin workspace attribution', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    mocks.apiActivateWorkspace.mockResolvedValue(undefined)
    mocks.apiDeactivateWorkspace.mockResolvedValue(undefined)
  })

  it('scenario 10: repairs workspaceId when tab_created pushes a plugin tab', async () => {
    const { session, emit } = await setup()
    emit({
      type: 'tab_created',
      tab_id: 'plugin:session-browser:workspace-a',
      pane_id: 'plugin-pane',
    })

    expect((session.tabs[0] as TerminalTab).workspaceId).toBe('workspace-a')
  })

  it('scenario 11: backfills an existing tab and persists the repair', async () => {
    const existing = terminal('plugin:session-browser:workspace-a', { workspaceId: null })
    const { persist, emit } = await setup([existing])
    emit({
      type: 'tab_created',
      tab_id: existing.paneId,
      pane_id: existing.activePaneId,
    })

    expect(existing.workspaceId).toBe('workspace-a')
    expect(persist).toHaveBeenCalledOnce()
  })

  it('scenario 12: rebuilds corrupt saved plugin attribution from tab_id', async () => {
    const paneId = 'plugin:session-browser:workspace-b'
    localStorage.setItem(
      'dinotty_tabs',
      JSON.stringify({ tabs: [terminal(paneId, { workspaceId: null })] })
    )
    const { session, emit } = await setup()
    emit({
      type: 'tab_list',
      tabs: [{ tab_id: paneId, pane_id: `${paneId}-leaf` }],
      active_pane_id: null,
    })

    expect((session.tabs[0] as TerminalTab).workspaceId).toBe('workspace-b')
  })

  it('scenario 6: close-time read fallback attributes a missing field to a live workspace', async () => {
    const pluginTab = terminal('plugin:session-browser:workspace-b')
    const successor = terminal('workspace-b-successor', { workspaceId: 'workspace-b' })
    const other = terminal('workspace-a-other', { workspaceId: 'workspace-a' })
    const { session, workspaceState, emit } = await setup(
      [pluginTab, other, successor],
      pluginTab.paneId
    )
    workspaceState.activeWorkspaceId.value = 'workspace-b'
    emit({ type: 'tab_closed', pane_id: pluginTab.paneId })

    await vi.waitFor(() => expect(session.activePaneId).toBe(successor.paneId))
    expect(mocks.apiActivateWorkspace).not.toHaveBeenCalled()
  })

  it('scenario 7: a decoded stale workspace falls through to default without crashing', async () => {
    const pluginTab = terminal('plugin:session-browser:deleted-workspace')
    const defaultTab = terminal('default-successor')
    const { session, workspaceState, emit } = await setup([pluginTab, defaultTab], pluginTab.paneId)
    workspaceState.activeWorkspaceId.value = null
    emit({ type: 'tab_closed', pane_id: pluginTab.paneId })

    await vi.waitFor(() => expect(session.activePaneId).toBe(defaultTab.paneId))
    expect(mocks.apiActivateWorkspace).not.toHaveBeenCalled()
  })

  it('scenario 8: closing a corrupt-field plugin tab selects its origin-workspace successor', async () => {
    const pluginTab = terminal('plugin:session-browser:workspace-a', { workspaceId: null })
    const workspaceB = terminal('workspace-b-other', { workspaceId: 'workspace-b' })
    const workspaceA = terminal('workspace-a-successor', { workspaceId: 'workspace-a' })
    const { session, emit } = await setup([pluginTab, workspaceB, workspaceA], pluginTab.paneId)
    emit({ type: 'tab_closed', pane_id: pluginTab.paneId })

    await vi.waitFor(() => expect(session.activePaneId).toBe(workspaceA.paneId))
    expect(mocks.apiActivateWorkspace).not.toHaveBeenCalled()
  })

  it('scenario 9: after a failed hop, re-picks from the active workspace before position', async () => {
    const pluginTab = terminal('plugin:session-browser:workspace-b')
    const workspaceB = terminal('workspace-b-successor', { workspaceId: 'workspace-b' })
    const workspaceA = terminal('workspace-a-fallback', { workspaceId: 'workspace-a' })
    mocks.apiActivateWorkspace.mockRejectedValueOnce(new Error('hop failed'))
    const { session, emit } = await setup([pluginTab, workspaceB, workspaceA], pluginTab.paneId)
    emit({ type: 'tab_closed', pane_id: pluginTab.paneId })

    await vi.waitFor(() => expect(session.activePaneId).toBe(workspaceA.paneId))
    expect(mocks.apiActivateWorkspace).toHaveBeenCalledTimes(1)
    expect(mocks.apiActivateWorkspace).toHaveBeenCalledWith('workspace-b')
  })

  it('scenario 9: uses positional fallback last and attempts its workspace hop again', async () => {
    const pluginTab = terminal('plugin:session-browser:workspace-a')
    const workspaceB = terminal('workspace-b-positional', { workspaceId: 'workspace-b' })
    mocks.apiActivateWorkspace.mockRejectedValueOnce(new Error('first hop failed'))
    const { session, emit } = await setup([pluginTab, workspaceB], pluginTab.paneId)
    emit({ type: 'tab_closed', pane_id: pluginTab.paneId })

    await vi.waitFor(() => expect(mocks.apiActivateWorkspace).toHaveBeenCalledTimes(2))
    expect(mocks.apiActivateWorkspace).toHaveBeenNthCalledWith(1, 'workspace-b')
    expect(mocks.apiActivateWorkspace).toHaveBeenNthCalledWith(2, 'workspace-b')
    expect(session.activePaneId).toBe(workspaceB.paneId)
  })

  it('scenario 13: preserves the successful-hop behavior for a non-plugin tab', async () => {
    const workspaceA = terminal('normal-a', { workspaceId: 'workspace-a' })
    const workspaceB = terminal('normal-b', { workspaceId: 'workspace-b' })
    const { session, workspaceState, emit } = await setup(
      [workspaceA, workspaceB],
      workspaceA.paneId
    )
    emit({ type: 'tab_closed', pane_id: workspaceA.paneId })

    await vi.waitFor(() => expect(workspaceState.activeWorkspaceId.value).toBe('workspace-b'))
    expect(mocks.apiActivateWorkspace).toHaveBeenCalledOnce()
    expect(session.activePaneId).toBe(workspaceB.paneId)
  })

  it('scenario 14: gives a non-plugin failed hop positional fallback and a second attempt', async () => {
    const workspaceA = terminal('normal-a', { workspaceId: 'workspace-a' })
    const workspaceB = terminal('normal-b', { workspaceId: 'workspace-b' })
    mocks.apiActivateWorkspace.mockRejectedValueOnce(new Error('first hop failed'))
    const { session, emit } = await setup([workspaceA, workspaceB], workspaceA.paneId)
    emit({ type: 'tab_closed', pane_id: workspaceA.paneId })

    await vi.waitFor(() => expect(mocks.apiActivateWorkspace).toHaveBeenCalledTimes(2))
    expect(session.activePaneId).toBe(workspaceB.paneId)
  })

  it('scenario 15: a live stored field wins over a different decoded workspace', async () => {
    const pluginTab = terminal('plugin:session-browser:workspace-a', {
      workspaceId: 'workspace-b',
    })
    const workspaceA = terminal('workspace-a-first', { workspaceId: 'workspace-a' })
    const workspaceB = terminal('workspace-b-successor', { workspaceId: 'workspace-b' })
    const { session, workspaceState, emit } = await setup(
      [pluginTab, workspaceA, workspaceB],
      pluginTab.paneId
    )
    workspaceState.activeWorkspaceId.value = 'workspace-b'
    emit({ type: 'tab_closed', pane_id: pluginTab.paneId })

    await vi.waitFor(() => expect(session.activePaneId).toBe(workspaceB.paneId))
    expect(mocks.apiActivateWorkspace).not.toHaveBeenCalled()
  })

  it('scenario 16: a passive close decodes consistently without hopping workspaces', async () => {
    const active = terminal('workspace-a-active', { workspaceId: 'workspace-a' })
    const passivePlugin = terminal('plugin:session-browser:workspace-a', { workspaceId: null })
    const { session, workspaceState, emit } = await setup([active, passivePlugin], active.paneId)
    emit({ type: 'tab_closed', pane_id: passivePlugin.paneId })

    expect(session.tabs.map((tab) => tab.paneId)).toEqual([active.paneId])
    expect(session.activePaneId).toBe(active.paneId)
    expect(workspaceState.activeWorkspaceId.value).toBe('workspace-a')
    expect(mocks.apiActivateWorkspace).not.toHaveBeenCalled()
  })
})
