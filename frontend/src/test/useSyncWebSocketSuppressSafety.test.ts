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
    layout: layout('a', 'b'),
    activePaneId: 'a',
    paneMru: ['a', 'b'],
    broadcastMode: false,
    broadcastActivity: 0,
  }
}

// Deterministic injection point: writing tab.activePaneId throws, standing in
// for any unexpected exception inside a suppressed region (prod-mode watcher
// errors, invariant violations, corrupted payloads, ...).
function sabotageActivePaneWrite(tab: TerminalTab): void {
  const current = tab.activePaneId
  Object.defineProperty(tab, 'activePaneId', {
    configurable: true,
    get: () => current,
    set() {
      throw new Error('region exploded')
    },
  })
}

async function setup() {
  setActivePinia(createPinia())
  const session = useSessionStore()
  const tab = makeTab()
  session.tabs = [tab]
  session.activePaneId = tab.paneId
  const subject = useSyncWebSocket({
    termRefs: {},
    persist: vi.fn(),
    focusActive: vi.fn(),
    newTab: vi.fn(async () => {}),
  })
  await subject.connectSyncWS()
  const emit = (message: Record<string, unknown>) => {
    socket.onmessage?.({ data: JSON.stringify(message) })
  }
  return { session, tab, emit, subject }
}

async function flushAsync(): Promise<void> {
  for (let i = 0; i < 10; i++) {
    await Promise.resolve()
  }
}

async function expectSendsUnblocked(subject: ReturnType<typeof useSyncWebSocket>) {
  expect(subject.suppressSync).toBe(false)
  socket.send.mockClear()
  subject.sendSync({ type: 'activate_tab', pane_id: 'a' })
  expect(socket.send).toHaveBeenCalledTimes(1)
  expect(socket.send).toHaveBeenCalledWith(JSON.stringify({ type: 'activate_tab', pane_id: 'a' }))
}

describe('useSyncWebSocket suppressSync exception safety', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const workspaceState = useWorkspaces()
    workspaceState.workspaces.value = []
    workspaceState.activeWorkspaceId.value = null
  })

  it('unblocks sync sends after a tab_list region exception', async () => {
    const { tab, emit, subject } = await setup()
    sabotageActivePaneWrite(tab)
    emit({
      type: 'tab_list',
      tabs: [{ tab_id: tab.paneId, pane_id: 'a', layout: layout('a', 'b') }],
      active_pane_id: 'b',
    })
    await flushAsync()
    await expectSendsUnblocked(subject)
  })

  it('unblocks sync sends after a tab_activated region exception', async () => {
    const { tab, emit, subject } = await setup()
    sabotageActivePaneWrite(tab)
    emit({ type: 'tab_activated', pane_id: 'b' })
    await flushAsync()
    await expectSendsUnblocked(subject)
  })

  it('unblocks sync sends after a layout_updated region exception', async () => {
    const { tab, emit, subject } = await setup()
    sabotageActivePaneWrite(tab)
    emit({
      type: 'layout_updated',
      pane_id: tab.paneId,
      layout: layout('a', 'b'),
      active_pane_id: 'b',
    })
    await flushAsync()
    await expectSendsUnblocked(subject)
  })

  it('releases the suppression window when the region fails asynchronously', async () => {
    const { tab, emit, subject } = await setup()
    sabotageActivePaneWrite(tab)
    emit({ type: 'tab_activated', pane_id: 'b' })
    // The failure is delivered as a promise rejection at the helper's await
    // point, so the suppression window must still be open synchronously.
    expect(subject.suppressSync).toBe(true)
    await flushAsync()
    await expectSendsUnblocked(subject)
  })

  it('suppresses sends while a region is applying remote state', async () => {
    const { emit, subject } = await setup()
    emit({ type: 'tab_activated', pane_id: 'b' })
    // Region body applied synchronously; the window stays open until the
    // handler's async bookkeeping settles.
    expect(subject.suppressSync).toBe(true)
    subject.sendSync({ type: 'activate_tab', pane_id: 'a' })
    expect(socket.send).not.toHaveBeenCalled()
    await flushAsync()
    await expectSendsUnblocked(subject)
  })
})
