import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const ACTIVE_KEY = 'dinotty_device_active_server_v1'

/** Browser mode: no Tauri internals, so `getApiBase()` resolves to ''. */
function browserMode() {
  delete (window as any).__TAURI_INTERNALS__
}

async function load() {
  vi.resetModules()
  return import('../composables/apiBase')
}

function stubFetch(body: unknown = {}, status = 200) {
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

function calledUrl(mock: ReturnType<typeof stubFetch>, index = 0): string {
  return String(mock.mock.calls[index]?.[0])
}

/**
 * `/api/auth`, `/api/auth/request-code`, `/api/token-configured`,
 * `/api/auto-token` and `/api/token` are hub-only in the hub's relay. Using
 * `apiUrl()` while a remote server is active prepends `/__srv/<id>`, which the
 * relay rejects with 403 — that is what made verification-code login silently
 * fall back to token login.
 */
describe('auth helpers always target the hub', () => {
  beforeEach(() => {
    localStorage.clear()
    location.hostname = '127.0.0.1'
    browserMode()
    // Pretend this device is scoped to a remote server: `apiUrl()` would add
    // `/__srv/srv-a`, `hubApiUrl()` must not.
    localStorage.setItem(ACTIVE_KEY, 'srv-a')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    delete (window as any).__TAURI_INTERNALS__
  })

  it('reads the login method from the hub, not the relay', async () => {
    const fetchMock = stubFetch({ configured: true, login_method: 'verification_code' })
    const { checkTokenConfigured } = await load()

    await expect(checkTokenConfigured()).resolves.toMatchObject({
      loginMethod: 'verification_code',
    })
    expect(calledUrl(fetchMock)).toBe('/api/token-configured')
  })

  it('posts a token login to the hub', async () => {
    const fetchMock = stubFetch({ ok: true })
    const { validateToken } = await load()

    await validateToken('secret')
    expect(calledUrl(fetchMock)).toBe('/api/auth')
  })

  it('requests a verification code from the hub', async () => {
    const fetchMock = stubFetch({ request_id: 'req-1' })
    const { requestCode } = await load()

    await expect(requestCode()).resolves.toEqual({ ok: true, requestId: 'req-1' })
    expect(calledUrl(fetchMock)).toBe('/api/auth/request-code')
  })

  it('verifies a code against the hub', async () => {
    const fetchMock = stubFetch({ ok: true })
    const { validateCode } = await load()

    await expect(validateCode('req-1', '123456')).resolves.toEqual({ ok: true })
    expect(calledUrl(fetchMock)).toBe('/api/auth')
  })

  it('reads the loopback auto-token from the hub', async () => {
    const fetchMock = stubFetch({ token: 'auto' })
    const { fetchAutoToken } = await load()

    await expect(fetchAutoToken()).resolves.toBe('auto')
    expect(calledUrl(fetchMock)).toBe('/api/auto-token')
  })

  it('reads the server token from the hub', async () => {
    const fetchMock = stubFetch({ token: 'srv' })
    const { fetchServerToken } = await load()

    await expect(fetchServerToken()).resolves.toBe('srv')
    expect(calledUrl(fetchMock)).toBe('/api/token')
  })
})
