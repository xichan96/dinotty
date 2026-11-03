import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

/**
 * Layout updates are how pane focus, resize, and split reach the server. The
 * main window must keep activating its pane, while a detached window must send
 * the same layout without moving the server-global active pane. The wire
 * difference is the optional `activate` flag.
 */

const sockets: MockWebSocket[] = []
class MockWebSocket {
  static OPEN = 1
  static CONNECTING = 0
  readyState = MockWebSocket.OPEN
  onopen: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  onclose: ((event: { code: number; reason: string }) => void) | null = null
  onerror: (() => void) | null = null
  send = vi.fn()
  close = vi.fn()
  constructor(public url: string) {
    sockets.push(this)
  }
}

vi.stubGlobal('WebSocket', MockWebSocket)

vi.mock('../composables/apiBase', () => ({
  getApiBase: async () => '',
  wsUrl: (path: string) => `ws://localhost${path}`,
  hasAuthToken: () => false,
}))
vi.mock('../composables/usePluginLoader', () => ({ handlePluginChanged: vi.fn() }))
vi.mock('../composables/useWorkspaceApi', () => ({
  apiListWorkspaces: vi.fn(async () => []),
  apiCreateWorkspace: vi.fn(),
  apiUpdateWorkspace: vi.fn(),
  apiDeleteWorkspace: vi.fn(),
  apiActivateWorkspace: vi.fn(async () => {}),
  apiDeactivateWorkspace: vi.fn(async () => {}),
  apiReorderWorkspaces: vi.fn(),
}))

import { useSyncWebSocket } from '../composables/useSyncWebSocket'

function makeSubject() {
  return useSyncWebSocket({
    termRefs: {},
    persist: vi.fn(),
    focusActive: vi.fn(),
    newTab: vi.fn(async () => {}),
  })
}

async function connect() {
  const subject = makeSubject()
  await subject.connectSyncWS()
  expect(sockets).toHaveLength(1)
  return subject
}

function lastSent(): Record<string, unknown> {
  const send = sockets[0].send as ReturnType<typeof vi.fn>
  const raw = send.mock.calls[send.mock.calls.length - 1]?.[0]
  return JSON.parse(String(raw)) as Record<string, unknown>
}

describe('useSyncWebSocket layout activation', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    sockets.length = 0
  })

  it('keeps the main-window payload activating by omitting the flag', async () => {
    const subject = await connect()

    subject.sendLayoutSync('tab-1', { type: 'leaf', paneId: 'pane-1' }, 'pane-1')

    expect(lastSent()).toMatchObject({
      type: 'update_layout',
      pane_id: 'tab-1',
      active_pane_id: 'pane-1',
    })
    expect(lastSent()).not.toHaveProperty('activate')
  })

  it('sends activate:false when the caller suppresses global activation', async () => {
    const subject = await connect()

    subject.sendLayoutSync('tab-1', { type: 'leaf', paneId: 'pane-1' }, 'pane-1', {
      activate: false,
    })

    expect(lastSent()).toMatchObject({
      type: 'update_layout',
      pane_id: 'tab-1',
      active_pane_id: 'pane-1',
      activate: false,
    })
  })
})
