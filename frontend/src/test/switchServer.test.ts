import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const ACTIVE_KEY = 'dinotty_device_active_server_v1'
const PROBE_PATH = '/api/remote-servers/probe'

/** Fresh module graph — `activeServer` memoises the id and the hook lists. */
async function load() {
  vi.resetModules()
  return import('../composables/activeServer')
}

/**
 * Stub the hub transport.
 *
 * `activeServer` imports `apiBase` lazily (a static import would close the
 * cycle), so the mock has to be registered before `switchServer()` *runs*
 * rather than before the module is loaded — hence `doMock`, which is not
 * hoisted.
 */
function mockHub(opts: { ok?: boolean; status?: number; body?: unknown; throws?: boolean } = {}) {
  const authFetch = vi.fn(async (_url: string, _init?: RequestInit) => {
    if (opts.throws) throw new Error('network down')
    return {
      ok: opts.ok ?? true,
      status: opts.status ?? 200,
      json: async () => opts.body ?? { reachable: true },
    } as unknown as Response
  })
  vi.doMock('../composables/apiBase', () => ({
    authFetch,
    getHubBase: async () => '',
    hubApiUrl: (p: string) => p,
  }))
  return authFetch
}

/** The probe request as it actually went out, wherever it sits among the calls. */
function probeCall(authFetch: ReturnType<typeof mockHub>): [string, RequestInit] {
  const call = authFetch.mock.calls.find(([url]) => String(url).endsWith(PROBE_PATH))
  if (!call) throw new Error('no probe request was made')
  return call as unknown as [string, RequestInit]
}

function probeBody(authFetch: ReturnType<typeof mockHub>): unknown {
  return JSON.parse(String(probeCall(authFetch)[1].body))
}

/**
 * Stub the hub with a real `GET /api/remote-servers` roster.
 *
 * The probe is answered as reachable, which is exactly what the hub does for an
 * entry whose stored token it holds — the point being that the client sends
 * nothing but the id and the entry arrives in the shape the API actually
 * produces (`has_token`, never `token`).
 */
function mockHubWithRoster(servers: unknown[]) {
  const authFetch = vi.fn(async (url: string) => {
    if (String(url).endsWith(PROBE_PATH)) {
      return { ok: true, status: 200, json: async () => ({ reachable: true }) }
    }
    return { ok: true, status: 200, json: async () => servers }
  })
  vi.doMock('../composables/apiBase', () => ({
    authFetch,
    getHubBase: async () => '',
    hubApiUrl: (p: string) => p,
  }))
  return authFetch
}

describe('switchServer', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.doUnmock('../composables/apiBase')
  })

  describe('step 1 — the probe gates everything', () => {
    it('leaves the old server untouched when the probe reports unreachable', async () => {
      localStorage.setItem(ACTIVE_KEY, 'srv-old')
      const active = await load()
      mockHub({ body: { reachable: false, error: 'connection refused' } })
      active.registerServerTargetResolver(() => ({ id: 'srv-new', name: 'Lab board' }))
      const teardown = vi.fn()
      const reconnect = vi.fn()
      active.registerSwitchTeardown(teardown)
      active.registerSwitchReconnect(reconnect)

      await active.switchServer('srv-new')

      expect(active.activeServerId()).toBe('srv-old')
      expect(localStorage.getItem(ACTIVE_KEY)).toBe('srv-old')
      expect(teardown).not.toHaveBeenCalled()
      expect(reconnect).not.toHaveBeenCalled()
    })

    it('aborts on a non-2xx probe response', async () => {
      localStorage.setItem(ACTIVE_KEY, 'srv-old')
      const active = await load()
      mockHub({ ok: false, status: 502 })
      active.registerServerTargetResolver(() => ({ id: 'srv-new' }))
      const teardown = vi.fn()
      active.registerSwitchTeardown(teardown)

      await active.switchServer('srv-new')

      expect(active.activeServerId()).toBe('srv-old')
      expect(teardown).not.toHaveBeenCalled()
    })

    it('aborts when the probe request throws', async () => {
      localStorage.setItem(ACTIVE_KEY, 'srv-old')
      const active = await load()
      mockHub({ throws: true })
      active.registerServerTargetResolver(() => ({ id: 'srv-new' }))
      const teardown = vi.fn()
      active.registerSwitchTeardown(teardown)

      await active.switchServer('srv-new')

      expect(active.activeServerId()).toBe('srv-old')
      expect(teardown).not.toHaveBeenCalled()
    })

    it('aborts on an id the roster does not know, without probing or tearing down', async () => {
      localStorage.setItem(ACTIVE_KEY, 'srv-old')
      const active = await load()
      const authFetch = mockHub({})
      active.registerServerTargetResolver(() => null)
      const teardown = vi.fn()
      const reconnect = vi.fn()
      active.registerSwitchTeardown(teardown)
      active.registerSwitchReconnect(reconnect)

      await active.switchServer('srv-ghost')

      // An unknown id must never reach `relayPrefix()`: the app would end up
      // scoped to a `/__srv/<id>` prefix no server answers to.
      expect(authFetch).not.toHaveBeenCalled()
      expect(active.activeServerId()).toBe('srv-old')
      expect(localStorage.getItem(ACTIVE_KEY)).toBe('srv-old')
      expect(teardown).not.toHaveBeenCalled()
      expect(reconnect).not.toHaveBeenCalled()
    })

    it('probes the hub endpoint by id, never a relayed path', async () => {
      localStorage.setItem(ACTIVE_KEY, 'srv-old')
      const active = await load()
      const authFetch = mockHub({})
      active.registerServerTargetResolver(() => ({ id: 'srv-new' }))

      await active.switchServer('srv-new')

      // `srv-old` is still active while the probe runs, so a relayed URL would
      // carry `/__srv/srv-old` — the roster lives on the hub, not upstream.
      const [url, init] = authFetch.mock.calls[0] as unknown as [string, RequestInit]
      expect(url).toBe(PROBE_PATH)
      expect(init.method).toBe('POST')
      expect(JSON.parse(String(init.body))).toEqual({ id: 'srv-new' })
    })

    it('sends the id alone — no url and no token ever go on the wire', async () => {
      localStorage.setItem(ACTIVE_KEY, 'srv-old')
      const active = await load()
      const authFetch = mockHub({})
      // A target may carry display fields, and a caller may even hand over a
      // candidate credential. Neither may reach the body: the hub ignores
      // `url`/`token` whenever `id` is set, and the whole reason the by-id form
      // exists is that `GET /api/remote-servers` scrubs the token, so the
      // client has none to send. Serializing the target wholesale would leak
      // it the day the shapes line up.
      const target = {
        id: 'srv-new',
        name: 'Lab board',
        url: 'http://192.168.1.9:8999',
        token: 't0k',
      }
      active.registerServerTargetResolver(() => target)

      await active.switchServer('srv-new')

      expect(Object.keys(probeBody(authFetch) as object)).toEqual(['id'])
      expect(probeBody(authFetch)).toEqual({ id: 'srv-new' })
      expect(localStorage.getItem(ACTIVE_KEY)).toBe('srv-new')
    })

    it('switches to a token-protected server, which the client has no credential for', async () => {
      localStorage.setItem(ACTIVE_KEY, 'srv-old')
      const active = await load()
      // `GET /api/remote-servers` reports `has_token: true` and never echoes the
      // secret, so the client provably holds nothing to authenticate with. The
      // probe still passes because the hub supplies the stored token on the
      // id's behalf — this is the main path, not an edge case.
      const authFetch = mockHub({
        body: { reachable: true, token_configured: true, token_valid: true },
      })
      active.registerServerTargetResolver(() => ({ id: 'lab', name: 'Lab board' }))
      const teardown = vi.fn()
      const reconnect = vi.fn()
      active.registerSwitchTeardown(teardown)
      active.registerSwitchReconnect(reconnect)

      await active.switchServer('lab')

      expect(probeBody(authFetch)).toEqual({ id: 'lab' })
      expect(teardown).toHaveBeenCalled()
      expect(reconnect).toHaveBeenCalled()
      expect(active.activeServerId()).toBe('lab')
      expect(localStorage.getItem(ACTIVE_KEY)).toBe('lab')
    })

    it('switches to a token-protected entry read straight off the hub roster', async () => {
      localStorage.setItem(ACTIVE_KEY, 'srv-old')
      const active = await load()
      // The full path, with both halves real: the roster comes from the hub's
      // own JSON as `useRemoteServers` hands it over (`has_token`, no `token`
      // field at all), and the resolver is the one `useAppCore` registers.
      const authFetch = mockHubWithRoster([
        { id: 'lab', name: 'Lab board', url: 'http://192.168.1.9:58901', has_token: true },
        { id: 'attic', name: 'Attic', url: 'http://192.168.1.10:58901', has_token: false },
      ])
      const { useRemoteServers, refreshRemoteServers } = await import(
        '../composables/useRemoteServers'
      )
      await refreshRemoteServers()
      const { servers } = useRemoteServers()
      active.registerServerTargetResolver((id) => {
        const srv = servers.value.find((s) => s.id === id)
        // Deliberately not `srv.token` — this object has none, and it must never
        // be consulted for one.
        return srv ? { id: srv.id, name: srv.name, url: srv.url } : null
      })
      const teardown = vi.fn()
      const reconnect = vi.fn()
      active.registerSwitchTeardown(teardown)
      active.registerSwitchReconnect(reconnect)

      await active.switchServer('lab')

      // Regression guard the other way round: probing a token-protected server
      // by url alone answered 401 and aborted, so "any remote with a token is
      // unreachable" was the old behaviour on the main path.
      expect(probeBody(authFetch)).toEqual({ id: 'lab' })
      expect(teardown).toHaveBeenCalled()
      expect(reconnect).toHaveBeenCalled()
      expect(active.activeServerId()).toBe('lab')
      expect(localStorage.getItem(ACTIVE_KEY)).toBe('lab')
    })

    it('skips the resolver and the probe when switching back to the local server', async () => {
      localStorage.setItem(ACTIVE_KEY, 'srv-old')
      const active = await load()
      const authFetch = mockHub({ body: { reachable: false } })
      // `__local__` is synthesized by `useRemoteServers` and is deliberately not
      // a roster entry, so a resolver consulted here would return null and abort
      // the one switch that must always succeed.
      const resolver = vi.fn(() => null)
      active.registerServerTargetResolver(resolver)
      const teardown = vi.fn()
      active.registerSwitchTeardown(teardown)

      await active.switchServer(active.LOCAL_SERVER_ID)

      // The local server *is* the hub: it must stay reachable as the way back
      // even when the roster is unreadable, so it is never probed.
      expect(resolver).not.toHaveBeenCalled()
      expect(authFetch).not.toHaveBeenCalled()
      expect(teardown).toHaveBeenCalled()
      expect(active.activeServerId()).toBe(active.LOCAL_SERVER_ID)
    })
  })

  describe('step 1 — a target that rejects the stored credential', () => {
    /** Capture the probe's own log line, which is where the reason is stated. */
    function captureWarnings(): string[] {
      const lines: string[] = []
      vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
        lines.push(args.map(String).join(' '))
      })
      return lines
    }

    it('refuses to switch when the hub reports token_valid: false', async () => {
      localStorage.setItem(ACTIVE_KEY, 'srv-old')
      const active = await load()
      // Reachable, but the hub's stored token was rejected. Switching would put
      // the UI on a server that 401s every relayed request, so this is a failed
      // switch rather than a degraded one.
      mockHub({ body: { reachable: true, token_configured: true, token_valid: false } })
      active.registerServerTargetResolver(() => ({ id: 'lab', name: 'Lab board' }))
      const teardown = vi.fn()
      const reconnect = vi.fn()
      active.registerSwitchTeardown(teardown)
      active.registerSwitchReconnect(reconnect)

      await active.switchServer('lab')

      // "The bad token must not enter the new server": no id move, no teardown,
      // nothing brought up against a credential the target already refused.
      expect(active.activeServerId()).toBe('srv-old')
      expect(localStorage.getItem(ACTIVE_KEY)).toBe('srv-old')
      expect(teardown).not.toHaveBeenCalled()
      expect(reconnect).not.toHaveBeenCalled()
    })

    it('names the target instead of its url when it refuses the credential', async () => {
      localStorage.setItem(ACTIVE_KEY, 'srv-old')
      const active = await load()
      const warnings = captureWarnings()
      mockHub({ body: { reachable: true, token_configured: true, token_valid: false } })
      active.registerServerTargetResolver(() => ({
        id: 'lab',
        name: 'Lab board',
        url: 'http://192.168.1.9:8999',
      }))

      await active.switchServer('lab')

      // The frontend may not hold the url at all (the roster is shared between
      // two shapes and only one carries one), so a message keyed on the url can
      // read as "undefined". The name always exists.
      const line = warnings.find((w) => w.includes('stored token'))
      expect(line).toBeDefined()
      expect(line).toContain('Lab board')
      expect(line).not.toContain('http://192.168.1.9:8999')
    })

    it('still switches when the target has no token to reject', async () => {
      localStorage.setItem(ACTIVE_KEY, 'srv-old')
      const active = await load()
      // `token_valid` is absent, not false: the hub had no credential to try.
      // Reading "absent" as a rejection would break every tokenless server,
      // which is the mirror image of the bug this whole change fixes.
      mockHub({ body: { reachable: true, token_configured: false } })
      active.registerServerTargetResolver(() => ({ id: 'attic', name: 'Attic' }))
      const teardown = vi.fn()
      active.registerSwitchTeardown(teardown)

      await active.switchServer('attic')

      expect(teardown).toHaveBeenCalled()
      expect(active.activeServerId()).toBe('attic')
    })

    it('still switches when the hub accepted the stored token', async () => {
      localStorage.setItem(ACTIVE_KEY, 'srv-old')
      const active = await load()
      mockHub({ body: { reachable: true, token_configured: true, token_valid: true } })
      active.registerServerTargetResolver(() => ({ id: 'lab', name: 'Lab board' }))

      await active.switchServer('lab')

      expect(active.activeServerId()).toBe('lab')
      expect(localStorage.getItem(ACTIVE_KEY)).toBe('lab')
    })
  })

  describe('steps 2-9 — ordering', () => {
    it('runs teardowns under the old id and reconnects under the new one', async () => {
      localStorage.setItem(ACTIVE_KEY, 'srv-old')
      const active = await load()
      mockHub({})
      active.registerServerTargetResolver(() => ({ id: 'srv-new' }))
      const seen: string[] = []
      active.registerSwitchTeardown(() => {
        seen.push(`teardown:${active.activeServerId()}`)
      })
      active.registerSwitchTeardown(async () => {
        seen.push(`teardown2:${active.activeServerId()}`)
      })
      active.registerSwitchReconnect(() => {
        seen.push(`reconnect:${active.activeServerId()}`)
      })

      await active.switchServer('srv-new')

      // Step 2 (persistNow) in particular only lands in the *old* server's
      // namespace if the id has not moved yet.
      expect(seen).toEqual(['teardown:srv-old', 'teardown2:srv-old', 'reconnect:srv-new'])
      expect(active.activeServerId()).toBe('srv-new')
      expect(localStorage.getItem(ACTIVE_KEY)).toBe('srv-new')
    })

    it('does not abort the switch when a teardown hook fails', async () => {
      localStorage.setItem(ACTIVE_KEY, 'srv-old')
      const active = await load()
      mockHub({})
      active.registerServerTargetResolver(() => ({ id: 'srv-new' }))
      const after = vi.fn()
      active.registerSwitchTeardown(() => {
        throw new Error('boom')
      })
      active.registerSwitchTeardown(after)

      await active.switchServer('srv-new')

      expect(after).toHaveBeenCalled()
      expect(active.activeServerId()).toBe('srv-new')
    })

    it('is a no-op when the target is already active', async () => {
      localStorage.setItem(ACTIVE_KEY, 'srv-old')
      const active = await load()
      const authFetch = mockHub({})
      const teardown = vi.fn()
      active.registerSwitchTeardown(teardown)

      await active.switchServer('srv-old')

      expect(authFetch).not.toHaveBeenCalled()
      expect(teardown).not.toHaveBeenCalled()
    })
  })

  describe('failure leaves no half-torn state', () => {
    it('does not run a single teardown when the probe fails', async () => {
      localStorage.setItem(ACTIVE_KEY, 'srv-old')
      const active = await load()
      const authFetch = mockHub({ body: { reachable: false, error: 'connection refused' } })
      active.registerServerTargetResolver(() => ({ id: 'srv-new' }))
      const first = vi.fn()
      const second = vi.fn()
      active.registerSwitchTeardown(first)
      active.registerSwitchTeardown(second)

      await active.switchServer('srv-new')

      // A partial teardown would drop the old server's tabs and sockets while
      // the id still points at it — the switch must fail before step 2.
      expect(first).not.toHaveBeenCalled()
      expect(second).not.toHaveBeenCalled()
      expect(active.activeServerId()).toBe('srv-old')
      expect(localStorage.getItem(ACTIVE_KEY)).toBe('srv-old')
      // The failing probe is still the by-id form, so this covers the shape
      // that actually ships rather than an id-less one.
      expect(probeBody(authFetch)).toEqual({ id: 'srv-new' })
    })
  })

  // The return value is what lets the UI say *why* a switch did not happen
  // instead of only logging it. The transport reports a coarse `kind` and
  // carries the hub's own wording in `detail`; turning that into a
  // user-facing sentence is the caller's job, so nothing here is translated.
  describe('the returned result', () => {
    it('reports success with the id it landed on', async () => {
      localStorage.setItem(ACTIVE_KEY, 'srv-old')
      const active = await load()
      mockHub({ body: { reachable: true } })
      active.registerServerTargetResolver(() => ({ id: 'srv-new' }))

      await expect(active.switchServer('srv-new')).resolves.toEqual({
        ok: true,
        id: 'srv-new',
      })
    })

    it('carries the hub wording through when the target is unreachable', async () => {
      localStorage.setItem(ACTIVE_KEY, 'srv-old')
      const active = await load()
      mockHub({ body: { reachable: false, error: 'connection refused by http://h:1' } })
      active.registerServerTargetResolver(() => ({ id: 'srv-new' }))

      const result = await active.switchServer('srv-new')

      expect(result).toEqual({
        ok: false,
        id: 'srv-new',
        failure: { kind: 'unreachable', detail: 'connection refused by http://h:1' },
      })
    })

    it('distinguishes a rejected credential from an unreachable host', async () => {
      localStorage.setItem(ACTIVE_KEY, 'srv-old')
      const active = await load()
      // Reachable and answering, but the stored token is wrong: the fix is
      // re-pasting a credential, which is a different message entirely.
      mockHub({ body: { reachable: true, token_valid: false } })
      active.registerServerTargetResolver(() => ({ id: 'srv-new' }))

      const result = await active.switchServer('srv-new')

      expect(result.ok).toBe(false)
      expect(result.ok ? null : result.failure.kind).toBe('tokenRejected')
      expect(active.activeServerId()).toBe('srv-old')
    })

    it('reports an unknown id as such rather than as a reachability problem', async () => {
      localStorage.setItem(ACTIVE_KEY, 'srv-old')
      const active = await load()
      mockHub({})
      active.registerServerTargetResolver(() => null)

      await expect(active.switchServer('srv-ghost')).resolves.toEqual({
        ok: false,
        id: 'srv-ghost',
        failure: { kind: 'unknownId' },
      })
    })

    it('treats an already-active id as success without touching anything', async () => {
      localStorage.setItem(ACTIVE_KEY, 'srv-old')
      const active = await load()
      const authFetch = mockHub({})
      const teardown = vi.fn()
      active.registerSwitchTeardown(teardown)

      // The caller asked for a state that already holds; that is not a failure.
      await expect(active.switchServer('srv-old')).resolves.toEqual({ ok: true, id: 'srv-old' })
      expect(authFetch).not.toHaveBeenCalled()
      expect(teardown).not.toHaveBeenCalled()
    })

    it('reports success for the switch back to local, which is never probed', async () => {
      localStorage.setItem(ACTIVE_KEY, 'srv-old')
      const active = await load()
      const authFetch = mockHub({})

      // `__local__` is synthesized, not a roster entry, so the resolver has
      // nothing to say about it — the switch back must still succeed.
      active.registerServerTargetResolver(() => null)

      await expect(active.switchServer(active.LOCAL_SERVER_ID)).resolves.toEqual({
        ok: true,
        id: active.LOCAL_SERVER_ID,
      })
      expect(authFetch).not.toHaveBeenCalled()
    })
  })
})
