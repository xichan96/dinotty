import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useWorkspaceChanges } from '../useWorkspaceChanges'
import type { WorkspaceChangesResponse } from '../../types/workspaceChanges'

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

const readyBody: WorkspaceChangesResponse = {
  is_git_repo: true,
  repo_root: '/repo',
  head: 'abc123',
  summary: { files: 1, additions: 2, deletions: 1, counts_complete: true, truncated: false },
  files: [
    {
      path: 'src/a.ts',
      orig_path: null,
      index_status: '',
      worktree_status: 'M',
      status: 'modified',
      additions: 2,
      deletions: 1,
      binary: false,
      conflicted: false,
      submodule: false,
    },
  ],
}

function setup(isActive = () => true) {
  return useWorkspaceChanges({ paneId: () => 'pane-1', isActive })
}

describe('useWorkspaceChanges', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('loads the pane change list and keeps snake_case fields', async () => {
    fetchMock.mockResolvedValueOnce(response(readyBody))
    const changes = setup()

    await changes.load()

    expect(changes.state.value).toBe('ready')
    expect(changes.error.value).toBeNull()
    expect(changes.data.value?.files[0]).toMatchObject({
      path: 'src/a.ts',
      worktree_status: 'M',
      additions: 2,
    })
    const url = String(fetchMock.mock.calls[0][0])
    expect(url).toContain('/api/workspace/git-changes?')
    expect(url).toContain('pane_id=pane-1')
  })

  it('reports 404 as unsupported (older server without the endpoint)', async () => {
    fetchMock.mockResolvedValueOnce(response({ error: 'not found' }, 404))
    const changes = setup()

    await changes.load()

    expect(changes.state.value).toBe('unsupported')
    expect(changes.data.value).toBeNull()
  })

  it('reports a non-repository workspace without treating it as an error', async () => {
    fetchMock.mockResolvedValueOnce(
      response({ ...readyBody, is_git_repo: false, repo_root: null, files: [] })
    )
    const changes = setup()

    await changes.load()

    expect(changes.state.value).toBe('notRepo')
    expect(changes.error.value).toBeNull()
    expect(changes.data.value).toBeNull()
  })

  it('keeps the last good list when a refresh fails', async () => {
    fetchMock.mockResolvedValueOnce(response(readyBody))
    const changes = setup()
    await changes.load()

    fetchMock.mockRejectedValueOnce(new Error('socket closed'))
    await changes.load()

    expect(changes.state.value).toBe('ready')
    expect(changes.error.value?.status).toBe(0)
    expect(changes.data.value?.files).toHaveLength(1)
  })

  it('never stacks overlapping loads', async () => {
    let resolve!: (res: Response) => void
    fetchMock.mockReturnValueOnce(new Promise<Response>((r) => (resolve = r)))
    const changes = setup()

    const first = changes.load()
    const second = changes.load()
    // `load` awaits getApiBase before touching fetch; flush those microtasks.
    await Promise.resolve()
    await Promise.resolve()
    expect(fetchMock).toHaveBeenCalledTimes(1)

    resolve(response(readyBody))
    await Promise.all([first, second])
    expect(changes.data.value?.is_git_repo).toBe(true)
  })

  it('coalesces scheduled refreshes behind one debounce', async () => {
    vi.useFakeTimers()
    fetchMock.mockResolvedValue(response(readyBody))
    const changes = setup()

    changes.scheduleRefresh()
    changes.scheduleRefresh()
    changes.scheduleRefresh()
    expect(fetchMock).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(500)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('does not fetch a scheduled refresh while the changes view is inactive', async () => {
    vi.useFakeTimers()
    fetchMock.mockResolvedValue(response(readyBody))
    const changes = setup(() => false)

    changes.scheduleRefresh()
    await vi.advanceTimersByTimeAsync(500)

    expect(fetchMock).not.toHaveBeenCalled()
  })
})
