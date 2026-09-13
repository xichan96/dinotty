import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const ACTIVE_KEY = 'dinotty_device_active_server_v1'
const CSRF_HEADER = 'X-Dinotty-Relay'

/** Pretend we are the desktop app: `authFetch` then takes the IPC branch. */
function asTauri(invoke: (cmd: string, args?: any) => any) {
  ;(window as any).__TAURI_INTERNALS__ = { invoke }
}

/** Resolve `embedded_http_origin` and record `tauri_fetch` calls. */
function tauriInvoker() {
  const calls: { cmd: string; args: any }[] = []
  const invoke = async (cmd: string, args?: any) => {
    calls.push({ cmd, args })
    if (cmd === 'embedded_http_origin') return 'http://127.0.0.1:8999'
    return { status: 200, headers: [], body: '{}' }
  }
  return { invoke, calls, fetchCall: () => calls.find((c) => c.cmd === 'tauri_fetch') }
}

async function load() {
  vi.resetModules()
  return import('../composables/apiBase')
}

/** Did the recorded `tauri_fetch` call carry the CSRF header? */
function hasHeader(call: { args: any } | undefined): boolean {
  return ((call?.args.headers ?? []) as [string, string][]).some(
    ([k]) => k.toLowerCase() === CSRF_HEADER.toLowerCase()
  )
}

/** A `fetch` stub with the real signature, so the recorded args type-check. */
function fetchStub() {
  const mock = vi.fn(async (_url: string, _init?: RequestInit): Promise<Response> => {
    return new Response('{}')
  })
  vi.stubGlobal('fetch', mock)
  return mock
}

describe('authFetch relay CSRF header', () => {
  beforeEach(() => {
    localStorage.clear()
    location.hostname = '127.0.0.1'
    delete (window as any).__TAURI_INTERNALS__
  })

  afterEach(() => {
    delete (window as any).__TAURI_INTERNALS__
    vi.restoreAllMocks()
  })

  describe('browser branch', () => {
    it('adds the header to a POST while a remote server is active', async () => {
      localStorage.setItem(ACTIVE_KEY, 'srv-a')
      const fetchMock = fetchStub()

      const { authFetch } = await load()
      await authFetch('/__srv/srv-a/api/tabs', { method: 'POST' })

      const [, init] = fetchMock.mock.calls[0]
      expect(new Headers(init?.headers).get(CSRF_HEADER)).toBe('1')
    })

    it('does not add the header to a GET while a remote server is active', async () => {
      localStorage.setItem(ACTIVE_KEY, 'srv-a')
      const fetchMock = fetchStub()

      const { authFetch } = await load()
      await authFetch('/__srv/srv-a/api/settings', { method: 'GET' })

      const [, init] = fetchMock.mock.calls[0]
      expect(new Headers(init?.headers).has(CSRF_HEADER)).toBe(false)
    })

    it('does not add the header to a POST on the local server', async () => {
      localStorage.setItem(ACTIVE_KEY, '__local__')
      const fetchMock = fetchStub()

      const { authFetch } = await load()
      await authFetch('/api/tabs', { method: 'POST' })

      const [url, init] = fetchMock.mock.calls[0]
      expect(url).toBe('/api/tabs')
      expect(new Headers(init?.headers).has(CSRF_HEADER)).toBe(false)
    })

    it('keeps the caller’s own value instead of overwriting it', async () => {
      localStorage.setItem(ACTIVE_KEY, 'srv-a')
      const fetchMock = fetchStub()

      const { authFetch } = await load()
      await authFetch('/__srv/srv-a/api/tabs', {
        method: 'POST',
        headers: { 'x-dinotty-relay': 'caller' },
      })

      const [, init] = fetchMock.mock.calls[0]
      expect(new Headers(init?.headers).get(CSRF_HEADER)).toBe('caller')
    })
  })

  describe('Tauri branch', () => {
    it('passes the header through tauri_fetch for a mutating remote request', async () => {
      localStorage.setItem(ACTIVE_KEY, 'srv-a')
      const { invoke, fetchCall } = tauriInvoker()
      asTauri(invoke)

      const { authFetch, getApiBase } = await load()
      await getApiBase()
      await authFetch('/api/tabs', { method: 'DELETE' })

      const call = fetchCall()
      expect(call?.args.method).toBe('DELETE')
      expect(call?.args.headers).toContainEqual([CSRF_HEADER, '1'])
    })

    it('omits the header for a mutating request on the local server', async () => {
      localStorage.setItem(ACTIVE_KEY, '__local__')
      const { invoke, fetchCall } = tauriInvoker()
      asTauri(invoke)

      const { authFetch, getApiBase } = await load()
      await getApiBase()
      await authFetch('/api/tabs', { method: 'POST' })

      const call = fetchCall()
      expect(hasHeader(call)).toBe(false)
    })

    it('relays the url the caller built and adds the header only for a mutation', async () => {
      // `authFetch` does not build the url — the ~120 call sites pass one made
      // by `apiUrl()`. Both properties are asserted together here because they
      // are only useful together: the header without the relay prefix would be
      // an unread header on a local request, and the prefix without the header
      // would be a 403.
      localStorage.setItem(ACTIVE_KEY, 'srv-a')
      const { invoke, calls, fetchCall } = tauriInvoker()
      asTauri(invoke)

      const { apiUrl, authFetch, getApiBase } = await load()
      await getApiBase()
      await authFetch(apiUrl('/api/settings'))
      calls.length = 0
      await authFetch(apiUrl('/api/settings'), { method: 'PUT', body: '{}' })

      const call = fetchCall()
      expect(call?.args.url).toBe('http://127.0.0.1:8999/__srv/srv-a/api/settings')
      expect(call?.args.method).toBe('PUT')
      expect(hasHeader(call)).toBe(true)
    })

    it('sends no header at all for a GET on a remote server', async () => {
      localStorage.setItem(ACTIVE_KEY, 'srv-a')
      const { invoke, fetchCall } = tauriInvoker()
      asTauri(invoke)

      const { authFetch, getApiBase } = await load()
      await getApiBase()
      await authFetch('/api/settings')

      const call = fetchCall()
      expect(call?.args.method).toBe('GET')
      expect(hasHeader(call)).toBe(false)
    })
  })
})
