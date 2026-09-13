// Which Dinotty server the frontend is currently talking to.
//
// This module is deliberately dependency-free: `apiBase.ts` imports it and
// would otherwise create a cycle (apiBase must never be imported from here).
// Everything in it is synchronous on purpose — `apiUrl()` needs the relay
// prefix on 120 synchronous call sites, so the prefix can only depend on the
// server *id*, never on anything that needs awaiting.

/** The embedded server of the host we are already running on. */
export const LOCAL_SERVER_ID = '__local__'

/** Device-level: which server this device views, not a shared preference. */
const ACTIVE_SERVER_KEY = 'dinotty_device_active_server_v1'

let cachedId: string | null = null

const teardowns: Array<() => void | Promise<void>> = []

function readStoredId(): string {
  try {
    return localStorage.getItem(ACTIVE_SERVER_KEY) || LOCAL_SERVER_ID
  } catch {
    return LOCAL_SERVER_ID
  }
}

export function activeServerId(): string {
  if (cachedId === null) cachedId = readStoredId()
  return cachedId
}

export function setActiveServerId(id: string): void {
  const next = id || LOCAL_SERVER_ID
  cachedId = next
  try {
    localStorage.setItem(ACTIVE_SERVER_KEY, next)
  } catch {
    /* storage unavailable — keep the in-memory value */
  }
}

export function isLocalActive(): boolean {
  return activeServerId() === LOCAL_SERVER_ID
}

/**
 * Path prefix that routes a request through the hub's relay to the active
 * upstream server. Empty for the local server, which *is* the hub.
 */
export function relayPrefix(): string {
  return isLocalActive() ? '' : `/__srv/${activeServerId()}`
}

/**
 * Register a hook to run when switching away from the current server.
 *
 * Hooks stay registered across switches — they describe "how to tear this
 * subsystem down", not a one-shot action — so callers register once at setup.
 */
export function registerSwitchTeardown(fn: () => void | Promise<void>): void {
  teardowns.push(fn)
}

/**
 * Run every registered teardown, in registration order.
 *
 * A failing hook is logged and skipped rather than aborting the sequence:
 * a half-torn-down switch is worse than a partially failed one.
 */
export async function runSwitchTeardown(): Promise<void> {
  for (const fn of teardowns) {
    try {
      await fn()
    } catch (e) {
      console.warn('[activeServer] switch teardown failed:', e)
    }
  }
}

/**
 * A switch target as the hub's probe endpoint needs it.
 *
 * `id` is a roster id, and it is the *only* field that goes on the wire. The
 * hub owns both the url and the credential: `GET /api/remote-servers` scrubs
 * the token out of its response by design, so a switch that identified its
 * target by url could only ever probe anonymously and every token-protected
 * server would answer 401 — the switch was aborting for the whole main path.
 * Probing by id lets the hub supply the stored credential itself, which is
 * also why a caller cannot aim an id at a different host (see
 * `ProbeRemoteServerRequest` in `src/settings/remote_servers.rs`).
 *
 * `name`/`url` are for logs and error messages only, and are never sent. Prefer
 * `name` — the manager lets an entry be saved before it has a usable url, so
 * `url` is the one that can be empty.
 */
export interface ServerSwitchTarget {
  id: string
  /** Display name for probe-failure messages. */
  name?: string
  /** Origin, for probe-failure messages when no name is known. */
  url?: string
}

/** Human-readable label for a probe failure — never the wire format. */
function describeTarget(target: ServerSwitchTarget): string {
  return target.name || target.url || target.id
}

/**
 * Why a switch did not happen.
 *
 * A switch is all-or-nothing: every one of these leaves the previous server
 * exactly as it was, so the caller can render the reason and offer a retry
 * without having to undo anything.
 */
export type SwitchFailure =
  /** No roster entry carries this id, so there is nothing to probe. */
  | { kind: 'unknownId' }
  /** The hub could not reach the target. `detail` is the hub's own wording. */
  | { kind: 'unreachable'; detail: string }
  /** The target answered, but rejected the stored credential (401). */
  | { kind: 'tokenRejected' }

/** Outcome of [`switchServer`]. `ok` is the only thing a caller must branch on. */
export type SwitchResult =
  | { ok: true; id: string }
  | { ok: false; id: string; failure: SwitchFailure }

/** The probe's verdict on one target. */
type ProbeOutcome = { ok: true } | { ok: false; failure: SwitchFailure }

function unreachable(detail: string): ProbeOutcome {
  return { ok: false, failure: { kind: 'unreachable', detail } }
}

let targetResolver: ((id: string) => ServerSwitchTarget | null) | null = null

/**
 * Register the roster lookup the pre-switch probe needs.
 *
 * Kept as a hook rather than an import so this module stays free of the
 * settings singleton (`useSettings` → `apiBase` → here is a cycle). Resolving
 * `null` means "not a server we know about", which aborts the switch.
 *
 * The resolver is what proves the id is a real roster entry. That matters for
 * more than a nice error: `relayPrefix()` builds `/__srv/${id}` from a
 * localStorage value, so switching to an id the roster does not have would
 * leave the app scoped to a prefix no server answers to.
 */
export function registerServerTargetResolver(fn: (id: string) => ServerSwitchTarget | null): void {
  targetResolver = fn
}

const reconnects: Array<() => void | Promise<void>> = []

/**
 * Register a hook to run *after* the active id has moved — the mirror image of
 * `registerSwitchTeardown`. This is where a subsystem comes back up against the
 * new server (reload settings, reconnect the sync WS, re-open Mission Control).
 * Hooks stay registered across switches, like the teardown ones.
 */
export function registerSwitchReconnect(fn: () => void | Promise<void>): void {
  reconnects.push(fn)
}

/** Run every registered reconnect hook, in registration order; a failing hook
 *  is logged and skipped, matching `runSwitchTeardown`. */
export async function runSwitchReconnect(): Promise<void> {
  for (const fn of reconnects) {
    try {
      await fn()
    } catch (e) {
      console.warn('[activeServer] post-switch hook failed:', e)
    }
  }
}

const PROBE_PATH = '/api/remote-servers/probe'

/**
 * Step 1 of a switch: can we reach the target at all?
 *
 * The probe is a *hub* operation — the hub owns the roster and the credentials,
 * and it is the only one that can reach the upstream without CORS or origin
 * games — so this deliberately does **not** go through `relayPrefix()`.
 *
 * The body is the target's `id` and nothing else. Sending a `url` (let alone a
 * `token`) would be worse than useless: the hub ignores both when `id` is set,
 * and a client that could substitute them could point a stored id's probe at
 * another host. `GET /api/remote-servers` never hands out a token, so there is
 * no credential here to send in the first place — that is the whole reason the
 * by-id form exists.
 *
 * `getHubBase()` rather than `getApiBase()`: same origin today, but the named
 * accessor is the contract for "the hub, not the active server", and it is what
 * keeps this correct if the two ever diverge.
 *
 * "Can we reach it" is read as "will the relayed requests work", not merely "is
 * anything listening" — a target that answers but rejects the stored credential
 * is *not* a target we may switch to. See the `token_valid` check below.
 *
 * Every failure mode (network error, non-2xx, `reachable: false`, a rejected
 * credential) comes back as a [`SwitchFailure`] rather than a bare `false`, so
 * the caller can show the user *why* instead of only logging it. The hub's own
 * wording is carried through as `detail`; nothing here has to be translated
 * for the message to be useful.
 */
async function probeTarget(target: ServerSwitchTarget): Promise<ProbeOutcome> {
  const label = describeTarget(target)
  try {
    // Dynamic import: a static one would close the `apiBase` ⇄ `activeServer`
    // cycle at module-init time. Same reason `useMonitor` imports the plugin
    // monitor store lazily.
    const { authFetch, getHubBase } = await import('./apiBase')
    const base = await getHubBase()
    const res = await authFetch(`${base}${PROBE_PATH}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: target.id }),
    })
    if (!res.ok) {
      console.warn(`[activeServer] probe of ${label} failed: HTTP ${res.status}`)
      return unreachable(`the hub answered HTTP ${res.status}`)
    }
    const data = (await res.json().catch(() => null)) as {
      reachable?: boolean
      error?: string
      token_valid?: boolean
    } | null
    if (!data) {
      console.warn(`[activeServer] probe of ${label} returned no result`)
      return unreachable('the hub returned no probe result')
    }
    if (data.reachable === false) {
      console.warn(`[activeServer] probe of ${label} reported unreachable: ${data.error ?? ''}`)
      return unreachable(data.error || 'the hub could not reach it')
    }
    // The hub reached the target and the target rejected the stored credential
    // (a 401 from its `/api/info` — reached only now that the probe runs by id
    // and the hub can supply a token at all). Every reachability check above
    // passed, but switching would land the UI on a server that 401s every
    // relayed request: tabs, settings and the sync socket would all come back
    // empty against a server we *did* reach. There is no recovery from inside
    // the new server — the fix is re-pasting the token on the hub — so this is
    // a failed switch, not a degraded one. Leaving the old server in place is
    // the only state the user can act from.
    //
    // Only an explicit `false` counts. `undefined` means the hub had no token
    // to try, which is an ordinary working configuration (`token_configured`
    // false), and `true` means it was accepted.
    if (data.token_valid === false) {
      console.warn(
        `[activeServer] probe of ${label} rejected the stored token — refusing to switch`
      )
      return { ok: false, failure: { kind: 'tokenRejected' } }
    }
    return { ok: true }
  } catch (e) {
    console.warn(`[activeServer] probe of ${label} failed:`, e)
    return unreachable(e instanceof Error ? e.message : String(e))
  }
}

/**
 * Switch the active server, running the teardown/bring-up sequence.
 *
 * The order is the point (see "切换时的 teardown 顺序" in the design doc):
 *
 * 1. probe the target first — a failure leaves the old server exactly as it was
 * 2–6. `runSwitchTeardown()`: flush the old server's tabs, clear the session,
 *    close the sync WS, close every float window, reset the Mission Control
 *    mirror — in registration order, all of it still under the *old* id
 * 7. persist the device-level id
 * 8–9. `runSwitchReconnect()`: reload settings, reconnect the sync WS, and
 *    re-send `McOp::Set { open: true }` if Mission Control was open
 *
 * Steps 2–6 and 8–9 live behind hooks so this module can stay free of the
 * subsystems it orchestrates.
 *
 * Returns a [`SwitchResult`] instead of throwing: an aborted switch is an
 * ordinary outcome with a reason the UI should show, not an exception. The
 * `ok: true` early return for "already on that server" is deliberate — the
 * caller asked for a state, and that state already holds.
 */
export async function switchServer(id: string): Promise<SwitchResult> {
  const next = id || LOCAL_SERVER_ID
  if (next === activeServerId()) return { ok: true, id: next }

  // 1. Probe before touching anything. The local server *is* the hub, so it
  // needs no reachability check (and must stay reachable even if the roster
  // is unreadable — it is the way back). Both the resolver and the probe are
  // inside this branch: `__local__` is synthesized by `useRemoteServers` and
  // is deliberately *not* a roster entry, so resolving it there would return
  // `null` and abort the switch back to local — the one switch that must
  // always succeed.
  if (next !== LOCAL_SERVER_ID) {
    const target = targetResolver?.(next) ?? null
    if (!target) {
      console.warn(`[activeServer] no roster entry for "${next}" — refusing to switch`)
      return { ok: false, id: next, failure: { kind: 'unknownId' } }
    }
    const probe = await probeTarget(target)
    if (!probe.ok) return { ok: false, id: next, failure: probe.failure }
  }

  await runSwitchTeardown() // 2–6, still under the old id
  setActiveServerId(next) // 7
  await runSwitchReconnect() // 8–9
  return { ok: true, id: next }
}
