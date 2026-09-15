import { beforeEach, describe, expect, it, vi } from 'vitest'

const apiMocks = vi.hoisted(() => ({
  authFetch: vi.fn(),
  getApiBase: vi.fn(async () => ''),
}))

const transportMocks = vi.hoisted(() => ({
  isTauri: false,
  // Explicitly typed so tests can vary both the command name and the result.
  tauriInvoke: vi.fn(
    async (_command: string, _args?: unknown): Promise<unknown> => ({
      path: '/tmp/Dinotty_0.21.0_aarch64.dmg',
    })
  ),
}))

const eventMocks = vi.hoisted(() => ({
  listeners: [] as ((event: { payload: unknown }) => void)[],
  unlisten: vi.fn(),
}))

vi.mock('../composables/apiBase', () => ({
  apiUrl: (path: string) => path,
  authFetch: apiMocks.authFetch,
  getApiBase: apiMocks.getApiBase,
}))

vi.mock('../composables/useTransport', () => ({
  isTauri: () => transportMocks.isTauri,
  tauriInvoke: transportMocks.tauriInvoke,
}))

vi.mock('@tauri-apps/api/event', () => ({
  listen: async (event: string, handler: (event: { payload: unknown }) => void) => {
    if (event === 'update-download-progress') eventMocks.listeners.push(handler)
    return eventMocks.unlisten
  },
}))

const assetUrl =
  'https://github.com/xichan96/dinotty/releases/download/v0.21.0/Dinotty_0.21.0_aarch64.dmg'

const availableResponse = {
  status: 'update_available',
  current_version: '0.20.0',
  latest_version: '0.21.0',
  published_at: '2026-08-01T08:00:00Z',
  release_url: 'https://github.com/xichan96/dinotty/releases/tag/v0.21.0',
  download: { name: 'Dinotty_0.21.0_aarch64.dmg', url: assetUrl, size: 30_083_385, kind: 'dmg' },
  alternates: [
    {
      name: 'Dinotty_0.21.0_amd64.deb',
      url: 'https://github.com/xichan96/dinotty/releases/download/v0.21.0/Dinotty_0.21.0_amd64.deb',
      size: 30_083_822,
      kind: 'deb',
    },
  ],
}

function emitProgress(payload: unknown) {
  for (const listener of eventMocks.listeners) listener({ payload })
}

async function freshUpdateCheck() {
  vi.resetModules()
  return import('../composables/useUpdateCheck')
}

describe('useUpdateCheck', () => {
  beforeEach(() => {
    apiMocks.authFetch.mockReset()
    apiMocks.getApiBase.mockClear()
    transportMocks.isTauri = false
    transportMocks.tauriInvoke.mockReset()
    transportMocks.tauriInvoke.mockResolvedValue({ path: '/tmp/Dinotty_0.21.0_aarch64.dmg' })
    eventMocks.listeners.length = 0
    eventMocks.unlisten.mockClear()
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
    // The automatic path keeps its exact request shape; only the manual recheck
    // asks the server to bypass its success cache.
    expect(apiMocks.authFetch).toHaveBeenNthCalledWith(1, '/api/update-check', {
      signal: expect.any(AbortSignal),
    })
    expect(apiMocks.authFetch).toHaveBeenNthCalledWith(2, '/api/update-check?force=1', {
      signal: expect.any(AbortSignal),
    })
    expect(update.status.value).toBe('update_available')
  })

  it('exposes the matched installer and the alternate bundles', async () => {
    apiMocks.authFetch.mockResolvedValue(
      new Response(JSON.stringify(availableResponse), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    )
    const { useUpdateCheck } = await freshUpdateCheck()
    const update = useUpdateCheck()

    await update.start()

    expect(update.assetName.value).toBe('Dinotty_0.21.0_aarch64.dmg')
    expect(update.assetUrl.value).toBe(assetUrl)
    expect(update.assetSize.value).toBe(30_083_385)
    expect(update.alternateAssets.value.map((asset) => asset.name)).toEqual([
      'Dinotty_0.21.0_amd64.deb',
    ])
  })

  it('drops a download whose URL is not an official release asset', async () => {
    apiMocks.authFetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          ...availableResponse,
          download: {
            name: 'Dinotty_0.21.0_aarch64.dmg',
            url: 'https://example.com/xichan96/dinotty/releases/download/v0.21.0/x.dmg',
            size: 1,
            kind: 'dmg',
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    )
    const { useUpdateCheck } = await freshUpdateCheck()
    const update = useUpdateCheck()

    await update.start()

    // The update itself is still announced; only the untrusted download link is
    // discarded.
    expect(update.status.value).toBe('update_available')
    expect(update.assetUrl.value).toBe('')
  })

  it('tracks download progress and finishes when the command resolves', async () => {
    apiMocks.authFetch.mockResolvedValue(
      new Response(JSON.stringify(availableResponse), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    )
    transportMocks.isTauri = true
    const { useUpdateCheck } = await freshUpdateCheck()
    const update = useUpdateCheck()
    await update.start()

    transportMocks.tauriInvoke.mockImplementation(async (command: string): Promise<unknown> => {
      if (command === 'download_update_asset') {
        emitProgress({ downloaded: 500, total: 1000, percent: 50 })
        return { path: '/tmp/Dinotty_0.21.0_aarch64.dmg' }
      }
      return null
    })

    const pending = update.startDownload()
    await vi.waitFor(() => expect(update.downloadStatus.value).not.toBe('saving'))
    await pending

    expect(transportMocks.tauriInvoke).toHaveBeenCalledWith('download_update_asset', {
      url: assetUrl,
      tag: 'v0.21.0',
      filename: 'Dinotty_0.21.0_aarch64.dmg',
    })
    expect(update.downloadProgress.value.percent).toBe(50)
    expect(update.downloadStatus.value).toBe('done')
    expect(update.downloadedPath.value).toBe('/tmp/Dinotty_0.21.0_aarch64.dmg')
    // The listener must be released, or remounting the panel would stack them.
    expect(eventMocks.unlisten).toHaveBeenCalled()
  })

  it('reports a dismissed save dialog as cancelled and anything else as an error', async () => {
    apiMocks.authFetch.mockResolvedValue(
      new Response(JSON.stringify(availableResponse), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    )
    transportMocks.isTauri = true
    const { useUpdateCheck } = await freshUpdateCheck()
    const update = useUpdateCheck()
    await update.start()

    transportMocks.tauriInvoke.mockRejectedValueOnce('cancelled')
    await update.startDownload()
    expect(update.downloadStatus.value).toBe('cancelled')

    transportMocks.tauriInvoke.mockRejectedValueOnce('http_status:404')
    await update.startDownload()
    expect(update.downloadStatus.value).toBe('error')
    expect(update.downloadError.value).toContain('404')
  })

  it('does not start a download outside the desktop app or without a matched asset', async () => {
    apiMocks.authFetch.mockResolvedValue(
      new Response(JSON.stringify(availableResponse), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    )
    const { useUpdateCheck } = await freshUpdateCheck()
    const update = useUpdateCheck()
    await update.start()

    await update.startDownload()

    expect(transportMocks.tauriInvoke).not.toHaveBeenCalled()
    expect(update.downloadStatus.value).toBe('idle')
  })

  it('keeps an in-flight download across disposal', async () => {
    apiMocks.authFetch.mockResolvedValue(
      new Response(JSON.stringify(availableResponse), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    )
    transportMocks.isTauri = true
    let resolveDownload!: (value: { path: string }) => void
    transportMocks.tauriInvoke.mockImplementation(
      async () =>
        new Promise<{ path: string }>((resolve) => {
          resolveDownload = resolve
        })
    )
    const { useUpdateCheck } = await freshUpdateCheck()
    const update = useUpdateCheck()
    await update.start()

    const pending = update.startDownload()
    // `downloadStatus` flips to `saving` synchronously, so wait for the command
    // itself to prove the download is genuinely in flight.
    await vi.waitFor(() => expect(transportMocks.tauriInvoke).toHaveBeenCalled())

    // `dispose` runs when the settings panel unmounts; the Rust side keeps
    // downloading, so the state must survive or the UI would forget the file.
    update.dispose()
    expect(update.downloadStatus.value).toBe('saving')
    expect(update.downloadStatus.value).toBe('saving')

    resolveDownload({ path: '/tmp/Dinotty_0.21.0_aarch64.dmg' })
    await pending
    expect(update.downloadStatus.value).toBe('done')
  })

  it('reveals and opens the downloaded file through the desktop commands', async () => {
    apiMocks.authFetch.mockResolvedValue(
      new Response(JSON.stringify(availableResponse), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    )
    transportMocks.isTauri = true
    const { useUpdateCheck } = await freshUpdateCheck()
    const update = useUpdateCheck()
    await update.start()
    await update.startDownload()

    await expect(update.revealDownloadedFile()).resolves.toBe(true)
    expect(transportMocks.tauriInvoke).toHaveBeenCalledWith('reveal_downloaded_file', {
      path: '/tmp/Dinotty_0.21.0_aarch64.dmg',
    })

    await expect(update.openDownloadedFile()).resolves.toBe(true)
    expect(transportMocks.tauriInvoke).toHaveBeenCalledWith('open_downloaded_file', {
      path: '/tmp/Dinotty_0.21.0_aarch64.dmg',
    })
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
          status: 'up_to_date',
          current_version: '0.21.0',
          latest_version: '0.21.0',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    )
    const { useUpdateCheck } = await freshUpdateCheck()
    const update = useUpdateCheck()

    await update.start()

    expect(update.status.value).toBe('up_to_date')
    expect(update.takeAvailablePrompt()).toBeNull()
    expect(intervalSpy).not.toHaveBeenCalled()
    intervalSpy.mockRestore()
  })

  it('announces a release published moments ago with its installer', async () => {
    apiMocks.authFetch.mockResolvedValue(
      new Response(
        JSON.stringify({ ...availableResponse, published_at: new Date().toISOString() }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    )
    const { useUpdateCheck } = await freshUpdateCheck()
    const update = useUpdateCheck()

    await update.start()

    expect(update.status.value).toBe('update_available')
    expect(update.assetName.value).toBe('Dinotty_0.21.0_aarch64.dmg')
    expect(update.assetUrl.value).toBe(assetUrl)
    expect(update.takeAvailablePrompt()).toEqual({
      currentVersion: '0.20.0',
      latestVersion: '0.21.0',
    })
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

  it('clears stale download and asset state when a later check has no update', async () => {
    apiMocks.authFetch.mockResolvedValue(
      new Response(JSON.stringify(availableResponse), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    )
    transportMocks.isTauri = true
    const { useUpdateCheck } = await freshUpdateCheck()
    const update = useUpdateCheck()
    await update.start()
    await update.startDownload()
    expect(update.downloadStatus.value).toBe('done')

    apiMocks.authFetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          status: 'up_to_date',
          current_version: '0.21.0',
          latest_version: '0.21.0',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    )
    await update.recheck()

    expect(update.assetUrl.value).toBe('')
    expect(update.alternateAssets.value).toEqual([])
  })
})
