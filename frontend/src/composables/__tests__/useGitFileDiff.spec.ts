import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useGitFileDiff } from '../useGitFileDiff'
import { authFetch } from '../apiBase'
import type { DiffTarget, WorkspaceGitFileDiffResponse } from '../../types/workspaceChanges'

vi.mock('../apiBase', () => ({
  apiUrl: (path: string) => path,
  authFetch: vi.fn(),
  getApiBase: vi.fn(async () => ''),
}))

const target: DiffTarget = {
  path: 'src/a.ts',
  origPath: null,
  status: 'modified',
  conflicted: false,
}

const diff: WorkspaceGitFileDiffResponse = {
  is_git_repo: true,
  path: 'src/a.ts',
  orig_path: null,
  base: 'head',
  original: 'a\n',
  modified: 'b\n',
  binary: false,
  too_large: false,
  submodule: false,
  conflicted: false,
}

function response(body: unknown, ok = true): Response {
  return {
    ok,
    status: ok ? 200 : 500,
    json: async () => body,
  } as unknown as Response
}

function setup(getTarget: () => DiffTarget | null = () => target) {
  return useGitFileDiff({ paneId: () => 'pane-1', target: getTarget })
}

const fetchMock = vi.mocked(authFetch)

describe('useGitFileDiff', () => {
  beforeEach(() => {
    fetchMock.mockReset()
  })

  it('fetches the head diff for the target and stores the response', async () => {
    fetchMock.mockResolvedValueOnce(response(diff))
    const state = setup()

    await state.load()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(
      '/api/workspace/git-file-diff?pane_id=pane-1&path=src%2Fa.ts&orig_path=&base=head'
    )
    expect(init?.signal).toBeInstanceOf(AbortSignal)
    expect(state.data.value).toEqual(diff)
    expect(state.error.value).toBe('')
    expect(state.loading.value).toBe(false)
  })

  it('aborts the previous request and ignores its late response', async () => {
    let resolveFirst!: (value: Response) => void
    const first = new Promise<Response>((resolve) => {
      resolveFirst = resolve
    })
    fetchMock.mockReturnValueOnce(first)
    const state = setup()

    const firstLoad = state.load()
    await Promise.resolve()
    const firstSignal = (fetchMock.mock.calls[0][1] as RequestInit).signal as AbortSignal

    const secondDiff = { ...diff, modified: 'c\n' }
    fetchMock.mockResolvedValueOnce(response(secondDiff))
    const secondLoad = state.load()

    expect(firstSignal.aborted).toBe(true)
    resolveFirst(response(diff))
    await Promise.all([firstLoad, secondLoad])

    expect(state.data.value).toEqual(secondDiff)
  })

  it('records a request error without dropping previous data', async () => {
    fetchMock.mockResolvedValueOnce(response(diff))
    const state = setup()
    await state.load()

    fetchMock.mockResolvedValueOnce(response({}, false))
    await state.load()

    expect(state.error.value).toBe('request')
    expect(state.data.value).toEqual(diff)
  })

  it('records a network error', async () => {
    fetchMock.mockRejectedValueOnce(new Error('boom'))
    const state = setup()

    await state.load()

    expect(state.error.value).toBe('network')
    expect(state.data.value).toBeNull()
  })

  it('clears state when the target disappears', async () => {
    let current: DiffTarget | null = target
    fetchMock.mockResolvedValueOnce(response(diff))
    const state = setup(() => current)
    await state.load()

    current = null
    await state.load()

    expect(state.data.value).toBeNull()
    expect(state.error.value).toBe('')
  })

  it('cancels an in-flight request and ignores its result', async () => {
    let resolveFirst!: (value: Response) => void
    const pending = new Promise<Response>((resolve) => {
      resolveFirst = resolve
    })
    fetchMock.mockReturnValueOnce(pending)
    const state = setup()

    const load = state.load()
    await Promise.resolve()
    const signal = (fetchMock.mock.calls[0][1] as RequestInit).signal as AbortSignal

    state.cancel()
    expect(signal.aborted).toBe(true)
    expect(state.loading.value).toBe(false)

    resolveFirst(response(diff))
    await load
    expect(state.data.value).toBeNull()
  })
})
