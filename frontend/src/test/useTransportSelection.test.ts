import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * `createTransport` picks the IPC transport only when the *local* server is
 * active. On a remote server `pty_spawn` would open a shell on this machine
 * instead of the remote one — the "crossed wires" failure. These tests pin that
 * dispatch down.
 */

class StubWebSocket {
  static OPEN = 1
  readyState = StubWebSocket.OPEN
  onopen: (() => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  send = vi.fn()
  close = vi.fn()
  constructor(public url: string) {}
}

const unlistenFns: Array<ReturnType<typeof vi.fn>> = []

function installTauriStub() {
  unlistenFns.length = 0
  ;(window as any).__TAURI__ = {
    core: { invoke: vi.fn(async () => 'bash') },
    event: {
      listen: vi.fn(async () => {
        const unlisten = vi.fn()
        unlistenFns.push(unlisten)
        return unlisten
      }),
    },
  }
}

/**
 * Fresh module graph: `activeServer` memoises the id and `apiBase` caches the
 * Tauri origin, so both must be re-imported per case.
 */
async function loadTransport(serverId?: string) {
  vi.resetModules()
  const activeServer = await import('../composables/activeServer')
  if (serverId) activeServer.setActiveServerId(serverId)
  const useTransport = await import('../composables/useTransport')
  return useTransport
}

describe('createTransport transport selection', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.stubGlobal('WebSocket', StubWebSocket)
  })

  afterEach(() => {
    delete (window as any).__TAURI__
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    localStorage.clear()
  })

  it('uses TauriIpcTransport when Tauri hosts the local server', async () => {
    installTauriStub()
    const { createTransport, TauriIpcTransport } = await loadTransport()

    const transport = createTransport('pane-1')
    expect(transport).toBeInstanceOf(TauriIpcTransport)
    transport.disconnect()
  })

  it('falls back to WebSocketTransport when a remote server is active in Tauri', async () => {
    installTauriStub()
    const { createTransport, WebSocketTransport, TauriIpcTransport } = await loadTransport('srv-a')

    const transport = createTransport('pane-1')

    // The regression guard: an IPC transport here would spawn a shell locally.
    expect(transport).not.toBeInstanceOf(TauriIpcTransport)
    expect(transport).toBeInstanceOf(WebSocketTransport)
    transport.disconnect()
  })

  it('routes the remote pane socket through the relay prefix', async () => {
    installTauriStub()
    const urls: string[] = []
    class CapturingWebSocket extends StubWebSocket {
      constructor(url: string) {
        super(url)
        urls.push(url)
      }
    }
    vi.stubGlobal('WebSocket', CapturingWebSocket)

    const { createTransport } = await loadTransport('srv-a')
    const transport = createTransport('pane-1')

    expect(urls[0]).toContain('/__srv/srv-a/ws?paneId=pane-1')
    transport.disconnect()
  })

  it('uses WebSocketTransport in the browser even on the local server', async () => {
    // No __TAURI__ at all: browser mode never has IPC available.
    const { createTransport, WebSocketTransport } = await loadTransport()

    const transport = createTransport('pane-1')
    expect(transport).toBeInstanceOf(WebSocketTransport)
    transport.disconnect()
  })
})
