import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { authFetch } from '../composables/apiBase'
import {
  useWorkspaceSearch,
  type WorkspaceSearchMatch,
} from '../composables/useWorkspaceSearch'

// The composable only talks to the backend through authFetch; mocking apiBase
// keeps the test independent of Tauri/browser transport details.
vi.mock('../composables/apiBase', () => ({
  getApiBase: vi.fn().mockResolvedValue(''),
  apiUrl: (path: string) => path,
  authFetch: vi.fn(),
}))

const fetchMock = vi.mocked(authFetch)

function response(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response
}

function ok(matches: WorkspaceSearchMatch[], truncated = false): Response {
  return response({ matches, truncated })
}

function status(code: number): Response {
  return response({ error: 'boom' }, code)
}

function match(file_path: string, line: number, line_text = 'hit'): WorkspaceSearchMatch {
  return { file_path, line, column: 0, line_text }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

function makeSearch(opts: { paneId?: string; isSsh?: boolean } = {}) {
  return useWorkspaceSearch({
    paneId: () => opts.paneId ?? 'pane-1',
    isSsh: () => opts.isSsh ?? false,
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  fetchMock.mockReset()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useWorkspaceSearch request', () => {
  it('POSTs the trimmed query and every option to /api/workspace/search', async () => {
    fetchMock.mockResolvedValue(ok([]))
    const search = makeSearch({ paneId: 'pane-42' })
    search.query.value = '  needle  '
    search.caseSensitive.value = true
    search.word.value = true
    search.regex.value = true

    await search.search()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/workspace/search')
    expect(init?.method).toBe('POST')
    expect(init?.headers).toEqual({ 'Content-Type': 'application/json' })
    expect(JSON.parse(String(init?.body))).toEqual({
      pane_id: 'pane-42',
      path: '.',
      query: 'needle',
      regex: true,
      word: true,
      case_sensitive: true,
      max_results: 500,
    })
  })

  it('sends the default option flags as false', async () => {
    fetchMock.mockResolvedValue(ok([]))
    const search = makeSearch()
    search.query.value = 'x'

    await search.search()

    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({
      regex: false,
      word: false,
      case_sensitive: false,
    })
  })

  it('tracks loading while the request is in flight', async () => {
    const pending = deferred<Response>()
    fetchMock.mockReturnValueOnce(pending.promise)
    const search = makeSearch()
    search.query.value = 'x'

    const run = search.search()
    expect(search.loading.value).toBe(true)

    pending.resolve(ok([]))
    await run
    expect(search.loading.value).toBe(false)
  })
})

describe('useWorkspaceSearch results', () => {
  it('groups matches by file and derives name/dir', async () => {
    fetchMock.mockResolvedValue(
      ok([
        match('src/a.ts', 1),
        match('README.md', 2),
        match('src/a.ts', 9),
      ])
    )
    const search = makeSearch()
    search.query.value = 'hit'

    await search.search()

    expect(search.totalMatches.value).toBe(3)
    expect(search.files.value).toHaveLength(2)
    expect(search.files.value[0]).toMatchObject({
      path: 'src/a.ts',
      name: 'a.ts',
      dir: 'src',
    })
    expect(search.files.value[0].matches.map((m) => m.line)).toEqual([1, 9])
    expect(search.files.value[0].count).toBe(2)
    // Top-level file: split('/') yields no directory part.
    expect(search.files.value[1]).toMatchObject({ path: 'README.md', dir: '' })
    expect(search.hasResults.value).toBe(true)
  })

  it('collapses multiple hits on one line to one row but keeps the count', async () => {
    fetchMock.mockResolvedValue(
      ok([match('a.ts', 3, 'foo foo'), match('a.ts', 3, 'foo foo'), match('a.ts', 8)])
    )
    const search = makeSearch()
    search.query.value = 'foo'

    await search.search()

    expect(search.totalMatches.value).toBe(3)
    expect(search.files.value[0].count).toBe(3)
    expect(search.files.value[0].matches.map((m) => m.line)).toEqual([3, 8])
  })

  it('flags truncated when the backend hits the 500-result cap', async () => {
    const matches = Array.from({ length: 500 }, (_, i) => match('big.ts', i + 1))
    fetchMock.mockResolvedValue(ok(matches, true))
    const search = makeSearch()
    search.query.value = 'hit'

    await search.search()

    expect(search.totalMatches.value).toBe(500)
    expect(search.truncated.value).toBe(true)
  })

  it('does not flag truncated below the cap', async () => {
    const matches = Array.from({ length: 499 }, (_, i) => match('big.ts', i + 1))
    fetchMock.mockResolvedValue(ok(matches, false))
    const search = makeSearch()
    search.query.value = 'hit'

    await search.search()

    expect(search.truncated.value).toBe(false)
  })

  it('an empty/whitespace query clears all state without a request', async () => {
    fetchMock.mockResolvedValue(ok([match('a.ts', 1)]))
    const search = makeSearch()
    search.query.value = 'hit'
    await search.search()
    expect(search.files.value).toHaveLength(1)

    search.query.value = '   '
    await search.search()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(search.files.value).toEqual([])
    expect(search.totalMatches.value).toBe(0)
    expect(search.truncated.value).toBe(false)
    expect(search.error.value).toBeNull()
    expect(search.loading.value).toBe(false)
    expect(search.isActive.value).toBe(false)
  })

  it('clear() resets state and cancels a scheduled search', async () => {
    fetchMock.mockResolvedValue(
      ok(Array.from({ length: 500 }, (_, i) => match('big.ts', i + 1)), true)
    )
    const search = makeSearch()
    search.query.value = 'hit'
    await search.search()
    expect(search.truncated.value).toBe(true)

    search.scheduleSearch(10)
    search.clear()
    await vi.advanceTimersByTimeAsync(50)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(search.query.value).toBe('')
    expect(search.files.value).toEqual([])
    expect(search.totalMatches.value).toBe(0)
    expect(search.truncated.value).toBe(false)
    expect(search.error.value).toBeNull()
    expect(search.loading.value).toBe(false)
  })

  it('ignores a stale response that resolves after a newer search', async () => {
    const first = deferred<Response>()
    const second = deferred<Response>()
    fetchMock
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
    const search = makeSearch()

    search.query.value = 'old'
    const firstRun = search.search()
    // Let the first call reach authFetch before starting the second one.
    await Promise.resolve()
    await Promise.resolve()

    search.query.value = 'new'
    const secondRun = search.search()
    await Promise.resolve()
    await Promise.resolve()
    expect(fetchMock).toHaveBeenCalledTimes(2)

    second.resolve(ok([match('new.ts', 1)]))
    await secondRun
    first.resolve(ok([match('old.ts', 1)]))
    await firstRun

    expect(search.files.value.map((f) => f.path)).toEqual(['new.ts'])
    expect(search.totalMatches.value).toBe(1)
  })
})

describe('useWorkspaceSearch errors', () => {
  it('maps 502 to rgMissing', async () => {
    fetchMock.mockResolvedValue(status(502))
    const search = makeSearch()
    search.query.value = 'x'

    await search.search()

    expect(search.error.value).toBe('rgMissing')
    expect(search.files.value).toEqual([])
    expect(search.totalMatches.value).toBe(0)
    expect(search.loading.value).toBe(false)
  })

  it('maps 400 to invalidRegex when regex mode is on', async () => {
    fetchMock.mockResolvedValue(status(400))
    const search = makeSearch()
    search.query.value = '['
    search.regex.value = true

    await search.search()

    expect(search.error.value).toBe('invalidRegex')
  })

  it('maps 400 to unknown when regex mode is off', async () => {
    fetchMock.mockResolvedValue(status(400))
    const search = makeSearch()
    search.query.value = 'x'

    await search.search()

    expect(search.error.value).toBe('unknown')
  })

  it('maps other non-2xx statuses to unknown', async () => {
    fetchMock.mockResolvedValue(status(500))
    const search = makeSearch()
    search.query.value = 'x'

    await search.search()

    expect(search.error.value).toBe('unknown')
  })

  it('rejects SSH sessions locally without calling the backend', async () => {
    const search = makeSearch({ isSsh: true })
    search.query.value = 'x'

    await search.search()

    expect(fetchMock).not.toHaveBeenCalled()
    expect(search.error.value).toBe('sshUnsupported')
    expect(search.loading.value).toBe(false)
  })

  it('maps a rejected fetch to network', async () => {
    fetchMock.mockRejectedValue(new Error('offline'))
    const search = makeSearch()
    search.query.value = 'x'

    await search.search()

    expect(search.error.value).toBe('network')
    expect(search.files.value).toEqual([])
    expect(search.totalMatches.value).toBe(0)
    expect(search.loading.value).toBe(false)
  })

  it('resets truncated on an error after a capped result set', async () => {
    fetchMock.mockResolvedValue(
      ok(Array.from({ length: 500 }, (_, i) => match('big.ts', i + 1)), true)
    )
    let ssh = false
    const search = useWorkspaceSearch({
      paneId: () => 'pane-1',
      isSsh: () => ssh,
    })
    search.query.value = 'hit'
    await search.search()
    expect(search.truncated.value).toBe(true)

    ssh = true
    await search.search()

    expect(search.truncated.value).toBe(false)
  })
})

describe('useWorkspaceSearch debounce', () => {
  it('coalesces rapid scheduleSearch calls into one request for the latest query', async () => {
    fetchMock.mockResolvedValue(ok([]))
    const search = makeSearch()

    search.query.value = 'a'
    search.scheduleSearch()
    search.query.value = 'ab'
    search.scheduleSearch()

    await vi.advanceTimersByTimeAsync(179)
    expect(fetchMock).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body)).query).toBe('ab')
  })

  it('supports a custom debounce delay', async () => {
    fetchMock.mockResolvedValue(ok([]))
    const search = makeSearch()
    search.query.value = 'x'
    search.scheduleSearch(50)

    await vi.advanceTimersByTimeAsync(49)
    expect(fetchMock).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('cancelPending prevents the scheduled request', async () => {
    fetchMock.mockResolvedValue(ok([]))
    const search = makeSearch()
    search.query.value = 'x'
    search.scheduleSearch(20)
    search.cancelPending()

    await vi.advanceTimersByTimeAsync(100)

    expect(fetchMock).not.toHaveBeenCalled()
  })
})
