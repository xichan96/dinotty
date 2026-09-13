import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

/**
 * `closeWs()` is called on server switch and logout. Its `onclose` handler
 * auto-reconnects, and without an intentional-close flag that timer would race
 * the switch and dial the server we just left.
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
  // uiStore seeds its `authenticated` ref from this at store creation.
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

describe('useSyncWebSocket intentional close', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    setActivePinia(createPinia())
    sockets.length = 0
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('does not reconnect after closeWs()', async () => {
    const subject = makeSubject()
    await subject.connectSyncWS()
    expect(sockets).toHaveLength(1)
    expect(subject.isConnected()).toBe(true)

    subject.closeWs()
    // The server confirms the close; this is where the reconnect used to fire.
    sockets[0].onclose?.({ code: 1000, reason: '' })

    await vi.advanceTimersByTimeAsync(60_000)

    expect(sockets).toHaveLength(1)
    expect(subject.isConnected()).toBe(false)
  })

  it('still reconnects after an unintentional drop', async () => {
    const subject = makeSubject()
    await subject.connectSyncWS()
    expect(sockets).toHaveLength(1)

    // No closeWs() — a dropped connection must still recover.
    sockets[0].onclose?.({ code: 1006, reason: '' })

    await vi.advanceTimersByTimeAsync(1500)

    expect(sockets).toHaveLength(2)
  })

  it('reconnects again after an explicit reconnect following closeWs()', async () => {
    const subject = makeSubject()
    await subject.connectSyncWS()

    subject.closeWs()
    sockets[0].onclose?.({ code: 1000, reason: '' })
    await vi.advanceTimersByTimeAsync(60_000)
    expect(sockets).toHaveLength(1)

    // Switching to the next server re-arms the auto-reconnect.
    await subject.connectSyncWS()
    expect(sockets).toHaveLength(2)

    sockets[1].onclose?.({ code: 1006, reason: '' })
    await vi.advanceTimersByTimeAsync(1500)
    expect(sockets).toHaveLength(3)
  })
})
