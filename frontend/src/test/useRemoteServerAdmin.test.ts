import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ authFetch: vi.fn() }))

vi.mock('../composables/apiBase', () => ({
  authFetch: mocks.authFetch,
  hubApiUrl: (p: string) => p,
}))

import {
  classifyProbeFailure,
  draftFromEntry,
  draftWillHaveToken,
  newDraft,
  probeFailureText,
  probeRemoteServer,
  putRemoteServers,
  serializeDraft,
  switchFailureText,
  type RemoteServerDraft,
} from '../composables/useRemoteServerAdmin'

function jsonResponse(body: unknown, status = 200) {
  return { ok: status < 400, status, json: async () => body }
}

function draft(overrides: Partial<RemoteServerDraft> = {}): RemoteServerDraft {
  return {
    id: 'a',
    name: 'Lab board',
    url: 'http://h:1',
    group: null,
    lastSeenVersion: null,
    hasToken: false,
    tokenInput: '',
    tokenDirty: false,
    tokenCleared: false,
    ...overrides,
  }
}

/** The PUT body as it actually went out. */
function putBody(): Record<string, unknown>[] {
  const call = mocks.authFetch.mock.calls.find(([, init]) => (init as RequestInit)?.method === 'PUT')
  if (!call) throw new Error('no PUT request was made')
  return JSON.parse(String((call[1] as RequestInit).body))
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.authFetch.mockResolvedValue(jsonResponse([]))
})

describe('serializeDraft', () => {
  // The whole reason the draft carries three token fields instead of one. The
  // hub reads a missing key as "keep", "" as "clear" and a value as "set", so
  // the key's *presence* is the payload's most load-bearing detail.
  describe('the token key', () => {
    it('is omitted when untouched, which asks the hub to keep the stored token', () => {
      const body = serializeDraft(draft({ hasToken: true, tokenInput: '', tokenDirty: false }))

      // `in`, not `=== undefined`: an explicit `undefined` would serialize to
      // nothing here but assert the wrong thing.
      expect('token' in body).toBe(false)
    })

    it('carries the typed value when one was entered', () => {
      const body = serializeDraft(draft({ tokenInput: 'secret', tokenDirty: true }))
      expect(body.token).toBe('secret')
    })

    it('is an empty string when the clear button was pressed', () => {
      const body = serializeDraft(draft({ hasToken: true, tokenCleared: true }))
      expect('token' in body).toBe(true)
      expect(body.token).toBe('')
    })

    // The regression this design exists to prevent: backspacing over a value
    // must not read as "clear", or a slip of the keyboard destroys a working
    // credential on the hub with no way to recover it from the client.
    it('falls back to keep when a typed value is erased again', () => {
      const body = serializeDraft(draft({ hasToken: true, tokenInput: '', tokenDirty: false }))
      expect('token' in body).toBe(false)
    })

    it('prefers an explicit clear over a stale typed value', () => {
      const body = serializeDraft(draft({ tokenInput: 'secret', tokenDirty: true, tokenCleared: true }))
      expect(body.token).toBe('')
    })
  })

  it('echoes the fields the UI cannot edit, which the replace would otherwise drop', () => {
    const body = serializeDraft(draft({ group: 'lab', lastSeenVersion: '1.2.3' }))
    expect(body).toMatchObject({ group: 'lab', last_seen_version: '1.2.3' })
  })

  it('never sends the derived flag', () => {
    expect('has_token' in serializeDraft(draft({ hasToken: true }))).toBe(false)
  })

  it('trims the fields the user types', () => {
    const body = serializeDraft(draft({ name: '  Lab  ', url: '  http://h:1  ' }))
    expect(body).toMatchObject({ name: 'Lab', url: 'http://h:1' })
  })
})

describe('draft identity', () => {
  it('mints a fresh id per new draft, and never the local sentinel', () => {
    const a = newDraft()
    const b = newDraft()

    expect(a.id).not.toBe(b.id)
    expect(a.id).not.toBe('__local__')
    // It rides in a URL path (`/__srv/<id>`), so it has to survive one.
    expect(encodeURIComponent(a.id)).toBe(a.id)
  })

  // The hub inherits a stored token by matching `id`, so the id has to come
  // from the roster entry verbatim rather than being re-minted on edit.
  it('copies an existing entry id and its read-only fields', () => {
    const d = draftFromEntry({
      id: 'lab',
      name: 'Lab board',
      url: 'http://h:1',
      hasToken: true,
      group: 'floor 2',
      lastSeenVersion: '1.2.3',
      local: false,
    })

    expect(d).toMatchObject({
      id: 'lab',
      name: 'Lab board',
      url: 'http://h:1',
      hasToken: true,
      group: 'floor 2',
      lastSeenVersion: '1.2.3',
    })
    expect(d.tokenInput).toBe('')
    expect(d.tokenDirty).toBe(false)
    expect(d.tokenCleared).toBe(false)
  })
})

describe('draftWillHaveToken', () => {
  it('follows the pending edit rather than the stored state', () => {
    expect(draftWillHaveToken(draft({ hasToken: true, tokenCleared: true }))).toBe(false)
    expect(draftWillHaveToken(draft({ hasToken: false, tokenInput: 'x', tokenDirty: true }))).toBe(
      true
    )
    expect(draftWillHaveToken(draft({ hasToken: true }))).toBe(true)
    expect(draftWillHaveToken(draft({ hasToken: false }))).toBe(false)
  })
})

describe('putRemoteServers', () => {
  beforeEach(() => {
    mocks.authFetch.mockImplementation(async (_url: string, init?: RequestInit) =>
      init?.method === 'PUT' ? jsonResponse({}, 200) : jsonResponse([])
    )
  })

  it('replaces the whole roster over the hub, in draft order', async () => {
    await putRemoteServers([draft({ id: 'a' }), draft({ id: 'b', name: 'Attic' })])

    const [url, init] = mocks.authFetch.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/remote-servers')
    expect(init.method).toBe('PUT')
    expect(putBody().map((s) => s.id)).toEqual(['a', 'b'])
  })

  it('re-reads the roster afterwards so the shared singleton sees the new list', async () => {
    const result = await putRemoteServers([draft()])

    expect(result).toEqual({ ok: true, refreshed: true })
    // The second call is the refresh: a GET, no method.
    const second = mocks.authFetch.mock.calls[1] as [string, RequestInit?]
    expect(second[0]).toBe('/api/remote-servers')
    expect(second[1]).toBeUndefined()
  })

  it('pins a rejected entry to its id', async () => {
    mocks.authFetch.mockResolvedValue(
      jsonResponse({ error: 'remote server `b`: url must be an origin with no path' }, 400)
    )

    const result = await putRemoteServers([draft({ id: 'b' })])

    expect(result).toEqual({
      ok: false,
      error: 'remote server `b`: url must be an origin with no path',
      serverId: 'b',
    })
    // Nothing was saved, so the roster must not be re-read as if it had been.
    expect(mocks.authFetch).toHaveBeenCalledTimes(1)
  })

  it('reports a transport failure without throwing', async () => {
    mocks.authFetch.mockRejectedValue(new Error('network down'))

    await expect(putRemoteServers([draft()])).resolves.toEqual({
      ok: false,
      error: 'network down',
      serverId: null,
    })
  })

  // A save the hub accepted but a re-read that failed is not a failed save;
  // saying otherwise would invite the user to retry a write that already landed.
  it('reports a failed refresh as saved-but-stale, not as a failed save', async () => {
    mocks.authFetch
      .mockResolvedValueOnce(jsonResponse({}, 200))
      .mockResolvedValueOnce(jsonResponse('not implemented', 501))

    await expect(putRemoteServers([draft()])).resolves.toEqual({ ok: true, refreshed: false })
  })
})

describe('probeRemoteServer', () => {
  /** The probe body as it actually went out. */
  function probeBody(): Record<string, unknown> {
    const call = mocks.authFetch.mock.calls.find(([url]) => String(url).endsWith('/probe'))
    if (!call) throw new Error('no probe request was made')
    return JSON.parse(String((call[1] as RequestInit).body))
  }

  beforeEach(() => {
    mocks.authFetch.mockResolvedValue(jsonResponse({ reachable: true }))
  })

  // The hub ignores a url/token sent alongside an id, and a client that could
  // substitute either could aim a stored id at a different host. So the by-id
  // form must carry the id and nothing else.
  it('sends the id alone when probing a roster entry', async () => {
    await probeRemoteServer({ kind: 'entry', id: 'a' })
    expect(probeBody()).toEqual({ id: 'a' })
  })

  it('sends the url and the candidate token when probing a form', async () => {
    await probeRemoteServer({ kind: 'draft', url: 'http://h:1', token: 'secret' })
    expect(probeBody()).toEqual({ url: 'http://h:1', token: 'secret' })
  })

  it('omits the token key entirely when the form has none to offer', async () => {
    await probeRemoteServer({ kind: 'draft', url: 'http://h:1' })
    expect('token' in probeBody()).toBe(false)
  })

  it('maps the response onto the client shape', async () => {
    mocks.authFetch.mockResolvedValue(
      jsonResponse({
        reachable: true,
        token_configured: true,
        server_mode: 'server',
        settings_version: 14,
        token_valid: true,
      })
    )

    await expect(probeRemoteServer({ kind: 'entry', id: 'a' })).resolves.toEqual({
      reachable: true,
      tokenConfigured: true,
      serverMode: 'server',
      settingsVersion: 14,
      tokenValid: true,
      error: null,
    })
  })

  // `settings_version` is absent for three different reasons - no credential to
  // test with, a rejected credential, or an upstream that predates the field -
  // so "not learned" must survive as null rather than becoming an error.
  it('keeps an absent settings_version as "not learned" without inventing an error', async () => {
    mocks.authFetch.mockResolvedValue(jsonResponse({ reachable: true, token_configured: true }))

    const result = await probeRemoteServer({ kind: 'entry', id: 'a' })

    expect(result.settingsVersion).toBeNull()
    expect(result.error).toBeNull()
    expect(result.reachable).toBe(true)
    expect(result.tokenValid).toBeNull()
  })

  it('turns a non-2xx answer into an actionable failure', async () => {
    mocks.authFetch.mockResolvedValue(jsonResponse({}, 502))

    const result = await probeRemoteServer({ kind: 'entry', id: 'a' })

    expect(result.reachable).toBe(false)
    expect(result.error).toBe('HTTP 502')
  })

  it('survives a probe request that throws', async () => {
    mocks.authFetch.mockRejectedValue(new Error('network down'))

    await expect(probeRemoteServer({ kind: 'entry', id: 'a' })).resolves.toMatchObject({
      reachable: false,
      error: 'network down',
    })
  })
})

describe('failure wording', () => {
  it('recognises the hub transport wordings', () => {
    expect(classifyProbeFailure('http://h:1 did not respond within 4s')).toBe('timeout')
    expect(classifyProbeFailure('connection refused by http://h:1')).toBe('refused')
    expect(classifyProbeFailure('DNS lookup failed for http://h:1')).toBe('dns')
    expect(
      classifyProbeFailure('http://h:1 answered HTTP 404 for /api/token-configured, which is not a dinotty server')
    ).toBe('notDinotty')
    expect(
      classifyProbeFailure('http://h:1 did not return a dinotty /api/token-configured payload')
    ).toBe('notDinotty')
    expect(classifyProbeFailure('url must be an origin with no path')).toBe('badUrl')
    expect(classifyProbeFailure('unsupported scheme `ws`, use http:// or https://')).toBe('badUrl')
  })

  // The classification is decoration: an unrecognised message still has to
  // reach the user, because it is the only thing that says what went wrong.
  it('leaves an unrecognised message intact rather than swallowing it', () => {
    const t = (key: string, params?: Record<string, string | number>) =>
      params ? `${key}|${params.detail}` : key

    expect(classifyProbeFailure('something nobody predicted')).toBe('other')
    expect(
      switchFailureText(t, { kind: 'unreachable', detail: 'something nobody predicted' }, 'http://h:1')
    ).toBe('server.failDetail|something nobody predicted')
  })

  it('names the target for the transport failures it recognises', () => {
    const t = (key: string, params?: Record<string, string | number>) =>
      params ? `${key}|${params.url}` : key

    expect(switchFailureText(t, { kind: 'unreachable', detail: 'connection refused by x' }, 'http://h:1')).toBe(
      'server.failRefused|http://h:1'
    )
    expect(switchFailureText(t, { kind: 'unreachable', detail: 'DNS lookup failed for x' }, 'http://h:1')).toBe(
      'server.failDns|http://h:1'
    )
  })

  it('does not need the detail for the structural failures', () => {
    const t = (key: string) => key

    expect(switchFailureText(t, { kind: 'unknownId' }, 'http://h:1')).toBe('server.failUnknownId')
    expect(switchFailureText(t, { kind: 'tokenRejected' }, 'http://h:1')).toBe(
      'server.failTokenRejected'
    )
  })

  it('says nothing about a probe that worked', () => {
    const t = (key: string) => key
    expect(
      probeFailureText(t, { reachable: true, error: null } as never, 'http://h:1')
    ).toBeNull()
  })

  it('reuses the transport wording for a failed test connection', () => {
    const t = (key: string, params?: Record<string, string | number>) =>
      params ? `${key}|${params.url}` : key

    expect(
      probeFailureText(
        t,
        { reachable: false, error: 'connection refused by http://h:1' } as never,
        'http://h:1'
      )
    ).toBe('server.failRefused|http://h:1')
  })
})
