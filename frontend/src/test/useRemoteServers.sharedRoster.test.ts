import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ authFetch: vi.fn(), activeId: '__local__' }))

vi.mock('../composables/activeServer', async () => {
  const actual = await vi.importActual<typeof import('../composables/activeServer')>(
    '../composables/activeServer'
  )
  return {
    ...actual,
    activeServerId: () => mocks.activeId,
    LOCAL_SERVER_ID: '__local__',
  }
})

vi.mock('../composables/apiBase', () => ({
  authFetch: mocks.authFetch,
  hubApiUrl: (p: string) => p,
}))

import {
  markServerVerified,
  refreshRemoteServers,
  useRemoteServers,
} from '../composables/useRemoteServers'

function jsonResponse(body: unknown, status = 200) {
  return { ok: status < 400, status, json: async () => body }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.activeId = '__local__'
  // Reset the module singleton between tests; an empty success leaves just the
  // synthesized local entry.
  mocks.authFetch.mockResolvedValue(jsonResponse([]))
})

describe('useRemoteServers roster sharing', () => {
  // Every consumer of the roster - the status bar's chip and picker, and the
  // manager dialog - reads this module's state rather than fetching its own, so
  // a refresh triggered by one is what the others render.
  it('is a shared singleton: a refresh is visible to a second consumer', async () => {
    const first = useRemoteServers()
    const second = useRemoteServers()

    mocks.authFetch.mockResolvedValue(
      jsonResponse([{ id: 'a', name: 'Lab board', url: 'http://h:1', has_token: true }])
    )
    await refreshRemoteServers()

    expect(first.servers.value.map((s) => s.id)).toEqual(['__local__', 'a'])
    expect(second.servers.value.map((s) => s.id)).toEqual(['__local__', 'a'])
  })

  it('always lists the local entry first, as the way back', async () => {
    const { servers } = useRemoteServers()
    expect(servers.value[0]).toMatchObject({ id: '__local__', local: true })
  })

  it('markServerVerified flips the lock flag on a listed server', async () => {
    mocks.authFetch.mockResolvedValue(
      jsonResponse([{ id: 'a', name: 'Lab', url: 'http://h:1', has_token: false }])
    )
    const { servers } = useRemoteServers()
    await refreshRemoteServers()

    expect(servers.value.find((s) => s.id === 'a')?.hasToken).toBe(false)
    markServerVerified('a')
    expect(servers.value.find((s) => s.id === 'a')?.hasToken).toBe(true)
  })

  it('markServerVerified ignores the local server and unknown ids', async () => {
    const { servers } = useRemoteServers()
    await refreshRemoteServers()

    markServerVerified('__local__')
    markServerVerified('nope')
    expect(servers.value).toHaveLength(1)
    expect(servers.value[0].hasToken).toBe(true)
  })
})
