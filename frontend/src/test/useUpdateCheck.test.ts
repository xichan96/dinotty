import { beforeEach, describe, expect, it, vi } from 'vitest'

const apiMocks = vi.hoisted(() => ({
  authFetch: vi.fn(),
  getApiBase: vi.fn(async () => ''),
}))

vi.mock('../composables/apiBase', () => ({
  apiUrl: (path: string) => path,
  authFetch: apiMocks.authFetch,
  getApiBase: apiMocks.getApiBase,
}))

vi.mock('../composables/useTransport', () => ({
  isTauri: () => false,
}))

const availableResponse = {
  status: 'update_available',
  current_version: '0.20.0',
  latest_version: '0.21.0',
  published_at: '2026-08-01T08:00:00Z',
  release_url: 'https://github.com/xichan96/dinotty/releases/tag/v0.21.0',
}

async function freshUpdateCheck() {
  vi.resetModules()
  return import('../composables/useUpdateCheck')
}

describe('useUpdateCheck', () => {
  beforeEach(() => {
    apiMocks.authFetch.mockReset()
    apiMocks.getApiBase.mockClear()
  })

  it('starts only one request for the whole page lifecycle', async () => {
    apiMocks.authFetch.mockResolvedValue(
      new Response(JSON.stringify(availableResponse), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    )
    const { useUpdateCheck } = await freshUpdateCheck()
    const update = useUpdateCheck()

    await Promise.all([update.start(), update.start()])
    await update.start()

    expect(apiMocks.authFetch).toHaveBeenCalledOnce()
    expect(apiMocks.authFetch).toHaveBeenCalledWith('/api/update-check', {
      signal: expect.any(AbortSignal),
    })
    expect(update.status.value).toBe('update_available')
    expect(update.latestVersion.value).toBe('0.21.0')
    expect(update.releaseUrl.value).toBe(availableResponse.release_url)
  })

  it('allows one explicit recheck without changing normal start deduplication', async () => {
    apiMocks.authFetch.mockImplementation(
      async () =>
        new Response(JSON.stringify(availableResponse), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
    )
    const { useUpdateCheck } = await freshUpdateCheck()
    const update = useUpdateCheck()

    await update.start()
    await update.recheck()
    await update.start()

    expect(apiMocks.authFetch).toHaveBeenCalledTimes(2)
    expect(update.status.value).toBe('update_available')
  })

  it('exposes an available update prompt only once', async () => {
    apiMocks.authFetch.mockResolvedValue(
      new Response(JSON.stringify(availableResponse), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    )
    const { useUpdateCheck } = await freshUpdateCheck()
    const update = useUpdateCheck()

    expect(update.takeAvailablePrompt()).toBeNull()
    await update.start()

    expect(update.takeAvailablePrompt()).toEqual({
      currentVersion: '0.20.0',
      latestVersion: '0.21.0',
    })
    expect(update.takeAvailablePrompt()).toBeNull()
  })

  it('keeps non-update and failed checks silent without scheduling timers', async () => {
    const intervalSpy = vi.spyOn(window, 'setInterval')
    apiMocks.authFetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          status: 'grace_period',
          current_version: '0.20.0',
          latest_version: '0.21.0',
          published_at: '2026-08-06T08:00:00Z',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    )
    const { useUpdateCheck } = await freshUpdateCheck()
    const update = useUpdateCheck()

    await update.start()

    expect(update.status.value).toBe('grace_period')
    expect(update.takeAvailablePrompt()).toBeNull()
    expect(intervalSpy).not.toHaveBeenCalled()
    intervalSpy.mockRestore()
  })

  it('rejects untrusted response URLs', async () => {
    apiMocks.authFetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          ...availableResponse,
          release_url: 'https://example.com/xichan96/dinotty/releases/tag/v0.21.0',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    )
    const { useUpdateCheck } = await freshUpdateCheck()
    const update = useUpdateCheck()

    await update.start()

    expect(update.status.value).toBe('unavailable')
    expect(update.releaseUrl.value).toBe('')
  })

  it.each([
    [
      'up_to_date',
      new Response(
        JSON.stringify({
          status: 'up_to_date',
          current_version: '0.20.0',
          latest_version: '0.20.0',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      ),
    ],
    [
      'unavailable',
      new Response(JSON.stringify({ error: 'update_check_unavailable' }), { status: 503 }),
    ],
  ] as const)('maps a non-visible result to %s', async (expectedStatus, response) => {
    apiMocks.authFetch.mockResolvedValue(response)
    const { useUpdateCheck } = await freshUpdateCheck()
    const update = useUpdateCheck()

    await update.start()

    expect(update.status.value).toBe(expectedStatus)
    expect(update.releaseUrl.value).toBe('')
  })

  it('ignores a response that arrives after disposal, including Tauri-style unabortable calls', async () => {
    let resolveResponse!: (response: Response) => void
    apiMocks.authFetch.mockReturnValue(
      new Promise<Response>((resolve) => {
        resolveResponse = resolve
      })
    )
    const { useUpdateCheck } = await freshUpdateCheck()
    const update = useUpdateCheck()
    const pending = update.start()
    await vi.waitFor(() => expect(apiMocks.authFetch).toHaveBeenCalledOnce())

    update.dispose()
    resolveResponse(
      new Response(JSON.stringify(availableResponse), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    )
    await pending
    await update.start()

    expect(update.status.value).toBe('unavailable')
    expect(update.releaseUrl.value).toBe('')
    expect(apiMocks.authFetch).toHaveBeenCalledOnce()
  })
})
