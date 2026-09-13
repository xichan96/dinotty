import { isTauri, tauriInvoke } from './useTransport'
import { activeServerId, isLocalActive, LOCAL_SERVER_ID, relayPrefix } from './activeServer'

/**
 * Header the hub's relay demands on every mutating relayed request, mirroring
 * `RELAY_CSRF_HEADER` in `src/proxy/relay.rs`.
 *
 * The relay carries *another server's* credentials, so it must not be drivable
 * by any page the user happens to have open. `is_cross_site_browser_request`
 * deliberately lets header-less requests through (that is what `<img>`-style
 * `no-cors` subresources look like), which means a cross-origin
 * `POST …/api/…` with `Content-Type: text/plain` — a simple request, so no
 * preflight — could otherwise cause a side effect. A custom header cannot be
 * set by such a request, so requiring one closes that path.
 */
const RELAY_CSRF_HEADER = 'X-Dinotty-Relay'

/** Legacy single-token key. Read once to migrate, then removed. */
const LEGACY_STORAGE_KEY = 'dinotty_auth_token'
/** Per-server token map: `{ [serverId]: token }`. */
const SERVER_TOKENS_KEY = 'dinotty_server_tokens_v1'

// Browser mode: cookie-based session (no token in localStorage).
// Tauri mode: Bearer token in localStorage (tauri_fetch has no cookie jar).
//
// Both flags describe "the session at this origin", so they are scoped by
// server: after switching to a remote server, the previous server's session
// says nothing about the new one. Keyed by server id, not a single boolean.
const loggedInServers = new Set<string>()
// Session-authenticated with no bearer token: Tauri loopback-bypass, or a
// desktop/web cookie session. setAuthToken() is never called on these paths,
// so hasAuthToken() must not depend on a stored token alone.
const sessionAuthedServers = new Set<string>()

let cached = ''
let inflight: Promise<string> | null = null

function readTokenMap(): Record<string, string> {
  let map: Record<string, string> = {}
  try {
    const raw = localStorage.getItem(SERVER_TOKENS_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (parsed && typeof parsed === 'object') map = parsed as Record<string, string>
    }
    // One-time read-migrate: existing desktop users have a working token under
    // the old flat key. Without this they would all be logged out on upgrade.
    // Delete the legacy key afterwards — leaving it would resurrect the token
    // on the next read after the user explicitly clears it.
    const legacy = localStorage.getItem(LEGACY_STORAGE_KEY)
    if (legacy && !map[LOCAL_SERVER_ID]) {
      map[LOCAL_SERVER_ID] = legacy
      writeTokenMap(map)
      localStorage.removeItem(LEGACY_STORAGE_KEY)
    }
  } catch {
    return {}
  }
  return map
}

function writeTokenMap(map: Record<string, string>): void {
  try {
    localStorage.setItem(SERVER_TOKENS_KEY, JSON.stringify(map))
  } catch {
    /* storage unavailable — the token simply won't persist */
  }
}

export function getAuthToken(): string {
  if (!isTauri()) return loggedInServers.has(activeServerId()) ? 'cookie' : ''
  const stored = readTokenMap()[activeServerId()]
  return stored || ''
}

export function setAuthToken(token: string): void {
  if (!isTauri()) {
    loggedInServers.add(activeServerId())
    return
  }
  const map = readTokenMap()
  map[activeServerId()] = token
  writeTokenMap(map)
}

export function markCookieAuthenticated(): void {
  sessionAuthedServers.add(activeServerId())
  if (!isTauri()) loggedInServers.add(activeServerId())
}

export function clearAuthToken(): void {
  const id = activeServerId()
  sessionAuthedServers.delete(id)
  if (!isTauri()) {
    loggedInServers.delete(id)
    return
  }
  const map = readTokenMap()
  delete map[id]
  writeTokenMap(map)
}

export function hasAuthToken(): boolean {
  const id = activeServerId()
  if (sessionAuthedServers.has(id)) return true
  if (!isTauri()) return loggedInServers.has(id)
  return !!readTokenMap()[id]
}

export type ValidateTokenResult =
  | { ok: true }
  | { ok: false; reason: 'invalid' | 'locked'; retryAfter?: number }

export async function validateToken(token: string): Promise<ValidateTokenResult> {
  try {
    await getApiBase()
    const init: RequestInit = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    }
    if (!isTauri()) {
      ;(init as RequestInit).credentials = 'include'
    }
    // Deliberately *not* `authFetch`: `/api/auth` is in the relay's
    // `is_hub_only_path` list, so `apiUrl`'s prefix is never carried upstream
    // and this always resolves against the hub. No `X-Dinotty-Relay` header —
    // nothing on that path checks it. Same for every other `fetch` in this
    // file (`/api/token-configured`, `/api/auto-token`, `/api/auth/request-code`).
    const res = await fetch(apiUrl('/api/auth'), init)
    if (res.ok) {
      setAuthToken(token)
      return { ok: true }
    }
    if (res.status === 429) {
      return {
        ok: false,
        reason: 'locked',
        retryAfter: parseRetryAfter(res.headers.get('Retry-After')),
      }
    }
    return { ok: false, reason: 'invalid' }
  } catch {
    return { ok: false, reason: 'invalid' }
  }
}

function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined
  const n = parseInt(value, 10)
  return Number.isFinite(n) && n > 0 ? n : undefined
}

export async function checkTokenConfigured(): Promise<{
  configured: boolean
  serverMode: boolean
  loginMethod?: 'token' | 'verification_code'
}> {
  try {
    await getApiBase()
    const res = await fetch(apiUrl('/api/token-configured'))
    if (!res.ok) return { configured: true, serverMode: true }
    const data = await res.json()
    return {
      configured: !!data.configured,
      serverMode: !!data.server_mode,
      loginMethod: data.login_method === 'verification_code' ? 'verification_code' : 'token',
    }
  } catch {
    return { configured: true, serverMode: true }
  }
}

export async function fetchAutoToken(): Promise<string> {
  try {
    await getApiBase()
    const res = await fetch(apiUrl('/api/auto-token'))
    if (!res.ok) return ''
    const data = await res.json()
    return data.token || ''
  } catch {
    return ''
  }
}

export async function fetchServerToken(): Promise<string> {
  try {
    await getApiBase()
    const res = await authFetch(apiUrl('/api/token'))
    if (!res.ok) return ''
    const data = await res.json()
    return data.token || ''
  } catch {
    return ''
  }
}

export async function getApiBase(): Promise<string> {
  if (!isTauri()) {
    cached = ''
    return ''
  }
  if (cached) return cached
  if (!inflight) {
    inflight = tauriInvoke('embedded_http_origin')
      .then((o) => {
        const s = String(o).replace(/\/$/, '')
        cached = s
        return s
      })
      .finally(() => {
        inflight = null
      })
  }
  return inflight
}

/**
 * URL for a path on the *active* server.
 *
 * On the local server this is the bare path (the hub serves it directly); on a
 * remote server the relay prefix routes it through the hub. All ~120 call
 * sites go through here, so the prefix is added in exactly one place.
 *
 * `cached` is only ever set in Tauri mode (see `getApiBase`); the browser is
 * same-origin, so a bare path is already correct.
 */
export function apiUrl(path: string): string {
  const p = path.startsWith('/') ? path : `/${path}`
  return cached ? `${cached}${relayPrefix()}${p}` : `${relayPrefix()}${p}`
}

/**
 * URL for a path that must always hit the hub itself, never the active
 * upstream server — auth, the remote-server roster, probing.
 */
export function hubApiUrl(path: string): string {
  const p = path.startsWith('/') ? path : `/${path}`
  return cached ? `${cached}${p}` : p
}

/** Origin of the hub serving this page, or `''` in the browser (same-origin). */
export async function getHubBase(): Promise<string> {
  return getApiBase()
}

/**
 * Absolute `ws(s)://` URL for a path on the active server.
 *
 * Tauri uses the embedded server's origin; the browser is same-origin. The
 * relay prefix carries WS through the hub just like HTTP.
 *
 * NOTE: this is synchronous, so in Tauri it can only use the origin once
 * `getApiBase()` has resolved. **Callers in Tauri must `await getApiBase()`
 * before calling this** (as `connectSyncWS` already does) — otherwise it falls
 * back to `location.host`, which in Tauri is `tauri.localhost`, not the server.
 */
export function wsUrl(path: string): string {
  const p = path.startsWith('/') ? path : `/${path}`
  const full = `${relayPrefix()}${p}`
  if (cached) return `${cached.replace(/^http/, 'ws')}${full}`
  if (isTauri()) {
    // `wsUrl` is synchronous (callers construct sockets from sync contexts) but
    // the Tauri origin is only known after an async IPC call. Kick that off so
    // the next call is correct; this one falls back to location.host.
    try {
      void getApiBase().catch(() => {})
    } catch {
      /* ignore */
    }
  }
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${proto}//${location.host}${full}`
}

export function authHeaders(): Record<string, string> {
  if (!isTauri()) return {}
  const token = getAuthToken()
  return token ? { Authorization: `Bearer ${token}` } : {}
}

/**
 * The CSRF header for a request going through the relay, or `{}` when none is
 * needed.
 *
 * Two conditions, both load-bearing:
 *
 * - **The active server must not be local.** Only relayed requests reach
 *   `relay.rs`'s check. On the local server the header would be meaningless
 *   (nothing reads it) and adding it unconditionally would change the bytes on
 *   the wire for the common case — and for every existing test.
 * - **The method must be able to have a side effect.** The relay exempts
 *   GET/HEAD/OPTIONS, which is the same read-only set: those are never gated,
 *   so the header would only add noise (and, on a cross-origin GET, would turn
 *   a simple request into a preflighted one for no benefit).
 *
 * `authFetch` calls this for every request it issues, including the ones that
 * never reach the relay (see the hub-only paths in `relay.rs`): sending an
 * unread header on those is harmless, and gating on the path here would
 * duplicate the relay's exclusion list in a second place that could drift.
 */
export function relayCsrfHeaders(method: string | undefined): Record<string, string> {
  if (isLocalActive()) return {}
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return {}
  return { [RELAY_CSRF_HEADER]: '1' }
}

export async function authFetch(url: string, init?: RequestInit): Promise<Response> {
  const method = init?.method || 'GET'
  const csrf = relayCsrfHeaders(method)
  if (isTauri()) {
    if (init?.body != null && typeof init.body !== 'string') {
      return new Response('desktop bridge does not support binary/multipart body', { status: 400 })
    }
    const entries: [string, string][] = [...Object.entries(authHeaders()), ...Object.entries(csrf)]
    if (init?.headers) {
      const h = new Headers(init.headers)
      h.forEach((v, k) => entries.push([k, v]))
    }
    const resp = (await tauriInvoke('tauri_fetch', {
      url,
      method,
      headers: entries,
      body: typeof init?.body === 'string' ? init.body : null,
    })) as { status: number; headers: [string, string][]; body: string }
    const bodyless =
      resp.status === 204 || resp.status === 304 || (resp.status >= 100 && resp.status < 200)
    return new Response(bodyless || !resp.body ? null : resp.body, {
      status: resp.status,
      headers: resp.headers,
    })
  }
  // No header to add: pass `init` through exactly as before, so the local
  // server's requests are byte-for-byte what they have always been.
  if (csrf[RELAY_CSRF_HEADER] === undefined) {
    return fetch(url, { ...init, credentials: 'include' })
  }
  // `Headers` normalizes names, so an explicitly-set `X-Dinotty-Relay` from the
  // caller is detected however it was spelled and left alone.
  const headers = new Headers(init?.headers)
  if (!headers.has(RELAY_CSRF_HEADER)) headers.set(RELAY_CSRF_HEADER, '1')
  return fetch(url, { ...init, credentials: 'include', headers })
}

export function wsUrlWithToken(url: string): string {
  // Browser: same-origin WS sends cookies automatically.
  // Tauri: loopback bypass or Bearer in WS URL is not needed.
  return url
}

export type RequestCodeResult =
  | { ok: true; requestId: string }
  | { ok: false; reason: 'rate_limited' | 'unknown'; retryAfter?: number }

export async function requestCode(): Promise<RequestCodeResult> {
  try {
    await getApiBase()
    const init: RequestInit = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    }
    if (!isTauri()) {
      ;(init as RequestInit).credentials = 'include'
    }
    const res = await fetch(apiUrl('/api/auth/request-code'), init)
    if (res.ok) {
      const data = await res.json()
      return { ok: true, requestId: String(data.request_id ?? '') }
    }
    if (res.status === 429) {
      return {
        ok: false,
        reason: 'rate_limited',
        retryAfter: parseRetryAfter(res.headers.get('Retry-After')),
      }
    }
    return { ok: false, reason: 'unknown' }
  } catch {
    return { ok: false, reason: 'unknown' }
  }
}

export type ValidateCodeResult =
  | { ok: true }
  | {
      ok: false
      reason:
        | 'invalid'
        | 'locked'
        | 'not_found'
        | 'expired'
        | 'consumed'
        | 'too_many_attempts'
        | 'method_mismatch'
      retryAfter?: number
    }

export async function validateCode(requestId: string, code: string): Promise<ValidateCodeResult> {
  try {
    await getApiBase()
    const init: RequestInit = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ request_id: requestId, code }),
    }
    if (!isTauri()) {
      ;(init as RequestInit).credentials = 'include'
    }
    const res = await fetch(apiUrl('/api/auth'), init)
    if (res.ok) {
      setAuthToken('cookie')
      return { ok: true }
    }
    if (res.status === 429) {
      return {
        ok: false,
        reason: 'locked',
        retryAfter: parseRetryAfter(res.headers.get('Retry-After')),
      }
    }
    const data = await res.json().catch(() => ({}))
    const errStr = typeof data.error === 'string' ? data.error : ''
    if (errStr === 'code not found') return { ok: false, reason: 'not_found' }
    if (errStr === 'code expired') return { ok: false, reason: 'expired' }
    if (errStr === 'code already used') return { ok: false, reason: 'consumed' }
    if (errStr === 'too many attempts') return { ok: false, reason: 'too_many_attempts' }
    if (errStr === 'login method mismatch') return { ok: false, reason: 'method_mismatch' }
    return { ok: false, reason: 'invalid' }
  } catch {
    return { ok: false, reason: 'invalid' }
  }
}
