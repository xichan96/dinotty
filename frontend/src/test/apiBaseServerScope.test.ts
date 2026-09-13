import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const LEGACY_KEY = 'dinotty_auth_token'
const TOKENS_KEY = 'dinotty_server_tokens_v1'
const ACTIVE_KEY = 'dinotty_device_active_server_v1'

/** Pretend we are the desktop app: `getAuthToken()` only uses storage in Tauri. */
function asTauri() {
  ;(window as any).__TAURI_INTERNALS__ = { invoke: async () => '' }
}

async function load() {
  vi.resetModules()
  asTauri()
  return import('../composables/apiBase')
}

function storedTokens(): Record<string, string> {
  return JSON.parse(localStorage.getItem(TOKENS_KEY) || '{}')
}

describe('apiBase per-server tokens', () => {
  beforeEach(() => {
    localStorage.clear()
    location.hostname = '127.0.0.1'
  })

  afterEach(() => {
    delete (window as any).__TAURI_INTERNALS__
    vi.restoreAllMocks()
  })

  it('migrates the legacy token into the local server entry on first read', async () => {
    localStorage.setItem(LEGACY_KEY, 'legacy-token')

    const { getAuthToken } = await load()

    expect(getAuthToken()).toBe('legacy-token')
    expect(storedTokens().__local__).toBe('legacy-token')
  })

  it('removes the legacy key once migrated, so clearing sticks', async () => {
    localStorage.setItem(LEGACY_KEY, 'legacy-token')
    const { clearAuthToken, hasAuthToken } = await load()

    clearAuthToken()

    expect(localStorage.getItem(LEGACY_KEY)).toBeNull()
    expect(storedTokens().__local__).toBeUndefined()
    expect(hasAuthToken()).toBe(false)
  })

  it('does not clobber an existing local entry with the legacy value', async () => {
    localStorage.setItem(LEGACY_KEY, 'stale')
    localStorage.setItem(TOKENS_KEY, JSON.stringify({ __local__: 'current' }))

    const { getAuthToken } = await load()

    expect(getAuthToken()).toBe('current')
  })

  it('keeps tokens separate per server', async () => {
    const api = await load()
    const active = await import('../composables/activeServer')

    active.setActiveServerId('srv-a')
    api.setAuthToken('token-a')
    active.setActiveServerId('srv-b')
    api.setAuthToken('token-b')

    expect(api.getAuthToken()).toBe('token-b')
    expect(storedTokens()).toEqual({ 'srv-a': 'token-a', 'srv-b': 'token-b' })

    active.setActiveServerId('srv-a')
    expect(api.getAuthToken()).toBe('token-a')
  })

  it('does not leak the local session flag to a remote server', async () => {
    const api = await load()
    const active = await import('../composables/activeServer')

    api.markCookieAuthenticated()
    expect(api.hasAuthToken()).toBe(true)

    active.setActiveServerId('srv-a')
    expect(api.hasAuthToken()).toBe(false)
  })
})

describe('apiBase URL prefixing', () => {
  beforeEach(() => {
    localStorage.clear()
    localStorage.setItem(ACTIVE_KEY, '__local__')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('leaves apiUrl bare and hubApiUrl bare on the local server', async () => {
    delete (window as any).__TAURI_INTERNALS__
    const { apiUrl, hubApiUrl } = await load()

    expect(apiUrl('/api/settings')).toBe('/api/settings')
    expect(hubApiUrl('/api/settings')).toBe('/api/settings')
  })

  it('inserts the relay prefix into apiUrl for a remote server', async () => {
    localStorage.setItem(ACTIVE_KEY, 'srv-a')
    delete (window as any).__TAURI_INTERNALS__
    const { apiUrl } = await load()

    expect(apiUrl('/api/settings')).toBe('/__srv/srv-a/api/settings')
  })

  it('never prefixes hubApiUrl, even for a remote server', async () => {
    localStorage.setItem(ACTIVE_KEY, 'srv-a')
    delete (window as any).__TAURI_INTERNALS__
    const { hubApiUrl } = await load()

    expect(hubApiUrl('/api/remote-servers')).toBe('/api/remote-servers')
  })

  it('normalises a path given without a leading slash', async () => {
    localStorage.setItem(ACTIVE_KEY, 'srv-a')
    delete (window as any).__TAURI_INTERNALS__
    const { apiUrl } = await load()

    expect(apiUrl('api/settings')).toBe('/__srv/srv-a/api/settings')
  })

  it('builds a relayed ws URL on the page origin', async () => {
    localStorage.setItem(ACTIVE_KEY, 'srv-a')
    delete (window as any).__TAURI_INTERNALS__
    const { wsUrl } = await load()

    expect(wsUrl('/ws/sync')).toBe(`ws://${location.host}/__srv/srv-a/ws/sync`)
  })

  it('builds a bare ws URL on the local server', async () => {
    delete (window as any).__TAURI_INTERNALS__
    const { wsUrl } = await load()

    expect(wsUrl('/ws/sync')).toBe(`ws://${location.host}/ws/sync`)
  })
})
