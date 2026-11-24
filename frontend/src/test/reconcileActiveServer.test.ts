import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const ACTIVE_KEY = 'dinotty_device_active_server_v1'

async function load() {
  vi.resetModules()
  const servers = await import('../composables/useRemoteServers')
  const active = await import('../composables/activeServer')
  return { servers, active }
}

function stubRoster(body: unknown, status = 200) {
  const mock = vi.fn(
    async (_url: string, _init?: RequestInit) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
      })
  )
  vi.stubGlobal('fetch', mock)
  return mock
}

/**
 * The active-server id is device-level localStorage. It survives a roster
 * deletion, and while it points at a missing entry every `apiUrl()` call keeps
 * its `/__srv/<id>` prefix, which the hub's relay answers with 404/403.
 */
describe('reconcileActiveServer', () => {
  beforeEach(() => {
    localStorage.clear()
    location.hostname = '127.0.0.1'
    delete (window as any).__TAURI_INTERNALS__
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    delete (window as any).__TAURI_INTERNALS__
  })

  it('falls back to local when the active id is no longer in the roster', async () => {
    const { servers, active } = await load()
    stubRoster([{ id: 'alive', name: 'Alive', url: 'http://alive', has_token: true }])
    active.setActiveServerId('gone')

    await expect(servers.reconcileActiveServer()).resolves.toBe(true)
    expect(active.activeServerId()).toBe('__local__')
    expect(localStorage.getItem(ACTIVE_KEY)).toBe('__local__')
  })

  it('keeps an id the roster still lists', async () => {
    const { servers, active } = await load()
    stubRoster([{ id: 'alive', name: 'Alive', url: 'http://alive', has_token: true }])
    active.setActiveServerId('alive')

    await expect(servers.reconcileActiveServer()).resolves.toBe(false)
    expect(active.activeServerId()).toBe('alive')
  })

  it('does not reset when the roster could not be read', async () => {
    const { servers, active } = await load()
    stubRoster({ error: 'unauthorized' }, 401)
    active.setActiveServerId('gone')

    await expect(servers.reconcileActiveServer()).resolves.toBe(false)
    expect(active.activeServerId()).toBe('gone')
  })

  it('does nothing when the local server is already active', async () => {
    const { servers, active } = await load()
    const fetchMock = stubRoster([])
    active.setActiveServerId('')

    await expect(servers.reconcileActiveServer()).resolves.toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
