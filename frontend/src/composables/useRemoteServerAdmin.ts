// Write side of the remote-server roster.
//
// `useRemoteServers` owns the *read* model - the shared roster that the Mission
// Control switcher and the status bar both render. This module owns everything
// that changes it, plus the one piece of UI state that has to outlive whichever
// component opened it.
//
// The roster endpoint is a full atomic replace (`PUT /api/remote-servers`), so
// there is no per-entry create/update/delete call: the manager holds a list of
// drafts and submits the whole thing. Two consequences shape everything below:
//
// 1. Fields the UI does not edit still have to be echoed back, or the replace
//    drops them.
// 2. A token is three states on the wire, not two - see `serializeDraft`.
//
// Nothing here writes the read model directly. A successful save re-reads the
// roster instead, so the `has_token` flags the hub recomputes land in the
// shared singleton and every consumer sees them.

import { ref } from 'vue'
import { authFetch, hubApiUrl } from './apiBase'
import { refreshRemoteServers, useRemoteServers, type ServerEntry } from './useRemoteServers'
import type { SwitchFailure } from './activeServer'

const ROSTER_PATH = '/api/remote-servers'
const PROBE_PATH = '/api/remote-servers/probe'

/**
 * One roster entry being edited.
 *
 * `id` is minted by the frontend and **never** changes: the hub inherits a
 * stored token by matching `id` on save (`inherit_remote_server_tokens`), so a
 * rename that also changed the id would silently drop the credential. It also
 * outlives the roster - it is the key for `/__srv/<id>`, the per-server tab
 * namespace and the per-server token map - so it has to stay URL-safe and never
 * collide with `__local__`.
 *
 * `tokenInput` / `tokenDirty` / `tokenCleared` describe what to *send*, not what
 * the hub holds. `hasToken` is the read model's view of the latter.
 */
export interface RemoteServerDraft {
  id: string
  name: string
  url: string
  /** Read-only passthrough: the replace would drop it otherwise. */
  group: string | null
  /** Read-only passthrough, same reason. */
  lastSeenVersion: string | null
  hasToken: boolean
  /** Raw text in the field. `''` means "typed nothing". */
  tokenInput: string
  /** A non-empty value was typed, so submit it. */
  tokenDirty: boolean
  /** The clear button was pressed, so submit `""`. */
  tokenCleared: boolean
}

export function draftFromEntry(entry: ServerEntry): RemoteServerDraft {
  return {
    id: entry.id,
    name: entry.name,
    url: entry.url,
    group: entry.group ?? null,
    lastSeenVersion: entry.lastSeenVersion ?? null,
    hasToken: entry.hasToken,
    tokenInput: '',
    tokenDirty: false,
    tokenCleared: false,
  }
}

export function newDraft(): RemoteServerDraft {
  return {
    // URL-safe by construction, and never `__local__`.
    id: crypto.randomUUID(),
    name: '',
    url: '',
    group: null,
    lastSeenVersion: null,
    hasToken: false,
    tokenInput: '',
    tokenDirty: false,
    tokenCleared: false,
  }
}

/** What `has_token` will be once this draft is saved - drives the row badges. */
export function draftWillHaveToken(draft: RemoteServerDraft): boolean {
  if (draft.tokenCleared) return false
  if (draft.tokenDirty && draft.tokenInput !== '') return true
  return draft.hasToken
}

/**
 * A draft as `PUT /api/remote-servers` wants it.
 *
 * The token key is the whole trick. `Option<SensitiveString>` with
 * `#[serde(default)]` reads three ways, and only the middle one is obvious:
 *
 * | payload        | meaning                            |
 * |----------------|------------------------------------|
 * | key absent     | **keep** the token stored for `id` |
 * | `""`           | clear it                           |
 * | `"abc"`        | set it                             |
 *
 * Note `null` also means *keep*, not clear - serde's `Option` swallows it. We
 * never send it: "keep" is expressed by omitting the key, which is the same
 * thing without leaning on a subtlety.
 *
 * That is why clearing needs its own flag. Typing a value and then deleting it
 * leaves `tokenInput === ''`, which must fall back to "keep" - a destructive
 * clear has to be something the user asked for, never something they reached by
 * backspacing.
 */
export function serializeDraft(draft: RemoteServerDraft): Record<string, unknown> {
  const out: Record<string, unknown> = {
    id: draft.id,
    name: draft.name.trim(),
    url: draft.url.trim(),
    group: draft.group,
    last_seen_version: draft.lastSeenVersion,
  }
  if (draft.tokenCleared) {
    out.token = ''
  } else if (draft.tokenDirty && draft.tokenInput !== '') {
    out.token = draft.tokenInput
  }
  return out
}

/**
 * The record without `key`.
 *
 * Plain-object records here are replaced rather than mutated so Vue tracks the
 * change (a `ref` holding an object does not see a `delete`), which makes
 * "forget this row's last result" a copy every time. The destructuring
 * shorthand for that leaves an unused binding behind, hence the helper.
 */
export function omitKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  const next = { ...record }
  delete next[key]
  return next
}

export type PutResult =
  | { ok: true; refreshed: boolean }
  | { ok: false; error: string; serverId: string | null }

/**
 * Replace the roster with `drafts`.
 *
 * Returns rather than throws, for the same reason `switchServer` does: a
 * rejected save is an ordinary outcome the dialog has to render.
 *
 * `refreshed` reports whether the follow-up re-read worked. A failed refresh is
 * not a failed save - the hub already persisted - but the shared roster is now
 * stale, and the caller should say so instead of pretending otherwise.
 */
export async function putRemoteServers(drafts: RemoteServerDraft[]): Promise<PutResult> {
  let res: Response
  try {
    res = await authFetch(hubApiUrl(ROSTER_PATH), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(drafts.map(serializeDraft)),
    })
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e), serverId: null }
  }

  if (!res.ok) {
    const data = await res.json().catch(() => null)
    const error = typeof data?.error === 'string' ? data.error : `HTTP ${res.status}`
    return { ok: false, error, serverId: serverIdFromError(error) }
  }

  // Re-read rather than patching the singleton: the hub recomputes `has_token`
  // from the merged token, and it is the only thing that can.
  await refreshRemoteServers()
  return { ok: true, refreshed: rosterStatus.value === 'ready' }
}

/**
 * The hub names the offending entry as ``remote server `<id>`: <reason>``, so a
 * 400 can be pinned to the field that caused it instead of shown as a blob.
 */
function serverIdFromError(error: string): string | null {
  return /remote server `([^`]+)`/.exec(error)?.[1] ?? null
}

const { status: rosterStatus } = useRemoteServers()

export interface ProbeResult {
  reachable: boolean
  /**
   * Whether the *target* has a token configured. False is a warning, not a
   * detail: with an empty token its `auth_middleware` lets everyone through, so
   * anyone who can reach it is an admin.
   */
  tokenConfigured: boolean
  serverMode: 'server' | 'embedded' | null
  /**
   * `null` means "not learned", which is **not** "incompatible": it is also
   * what an upstream older than the field reports. See `tokenValid` to tell
   * the two apart.
   */
  settingsVersion: number | null
  /** `null` = no credential was tested, `true` = accepted, `false` = 401. */
  tokenValid: boolean | null
  /** The hub's wording, set only when `reachable` is false. */
  error: string | null
}

/**
 * What to probe: an existing roster entry, or a form's current contents.
 *
 * The two are not interchangeable. An `entry` probe makes the hub use its own
 * stored url *and* token, and ignores whatever the request carries - which is
 * the only form that can authenticate, since `GET /api/remote-servers` never
 * hands the token to JavaScript. A `draft` probe is for the add/edit form,
 * where the credential is still in the user's hands and the entry may not exist
 * yet.
 *
 * Never use `entry` to test edits: the hub ignores the submitted url, so a
 * changed address would probe the *old* one and report on a server the user is
 * no longer looking at.
 */
export type ProbeRequest =
  | { kind: 'entry'; id: string }
  | { kind: 'draft'; url: string; token?: string }

export async function probeRemoteServer(req: ProbeRequest): Promise<ProbeResult> {
  // The by-id form sends the id and nothing else, deliberately: the hub ignores
  // a url or token alongside it, and a client able to substitute either could
  // aim a stored id at a host the roster does not name.
  const body: Record<string, unknown> = req.kind === 'entry' ? { id: req.id } : { url: req.url }
  if (req.kind === 'draft' && req.token) body.token = req.token

  try {
    const res = await authFetch(hubApiUrl(PROBE_PATH), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) return probeFailure(`HTTP ${res.status}`)
    const data = (await res.json().catch(() => null)) as Record<string, unknown> | null
    if (!data) return probeFailure('the hub returned an empty probe result')
    return {
      reachable: data.reachable === true,
      tokenConfigured: data.token_configured === true,
      serverMode:
        data.server_mode === 'server' || data.server_mode === 'embedded' ? data.server_mode : null,
      settingsVersion: typeof data.settings_version === 'number' ? data.settings_version : null,
      tokenValid: typeof data.token_valid === 'boolean' ? data.token_valid : null,
      error: typeof data.error === 'string' && data.error ? data.error : null,
    }
  } catch (e) {
    return probeFailure(e instanceof Error ? e.message : String(e))
  }
}

function probeFailure(error: string): ProbeResult {
  return {
    reachable: false,
    tokenConfigured: false,
    serverMode: null,
    settingsVersion: null,
    tokenValid: null,
    error,
  }
}

export type ProbeFailureKind = 'timeout' | 'refused' | 'dns' | 'notDinotty' | 'badUrl' | 'other'

/**
 * The backend's own wordings, from `classify_transport_error` and
 * `normalize_origin` (`src/settings/remote_servers.rs`).
 *
 * Purely decorative: anything unrecognised falls through to `other`, which
 * shows the hub's text verbatim. A message this misses is a worse-looking
 * message, never a lost one.
 */
const FAILURE_PATTERNS: ReadonlyArray<readonly [RegExp, ProbeFailureKind]> = [
  [/did not respond within/i, 'timeout'],
  [/connection refused by/i, 'refused'],
  [/DNS lookup failed for/i, 'dns'],
  [/is not a dinotty server/i, 'notDinotty'],
  [/did not return a dinotty \/api\/token-configured payload/i, 'notDinotty'],
  [/url is empty|invalid url|unsupported scheme|must be an origin|must not /i, 'badUrl'],
]

export function classifyProbeFailure(detail: string | null): ProbeFailureKind {
  if (!detail) return 'other'
  for (const [pattern, kind] of FAILURE_PATTERNS) {
    if (pattern.test(detail)) return kind
  }
  return 'other'
}

/** The subset of `useI18n().t` these helpers need. */
type Translate = (key: string, params?: Record<string, string | number>) => string

/**
 * A switch failure as a sentence.
 *
 * Takes `t` rather than importing it so this stays a pure function, and keeps
 * the keys as literals so `i18nCoverage` can check them.
 */
export function switchFailureText(t: Translate, failure: SwitchFailure, url: string): string {
  if (failure.kind === 'unknownId') return t('server.failUnknownId')
  if (failure.kind === 'tokenRejected') return t('server.failTokenRejected')
  if (!failure.detail) return t('server.switchFailed')
  switch (classifyProbeFailure(failure.detail)) {
    case 'timeout':
      return t('server.failTimeout', { url })
    case 'refused':
      return t('server.failRefused', { url })
    case 'dns':
      return t('server.failDns', { url })
    case 'notDinotty':
      return t('server.failNotDinotty', { url })
    case 'badUrl':
      return t('server.failBadUrl', { detail: failure.detail })
    default:
      return t('server.failDetail', { detail: failure.detail })
  }
}

/** The same wording for a failed "Test connection", or `null` if it worked. */
export function probeFailureText(t: Translate, result: ProbeResult, url: string): string | null {
  if (result.reachable) return null
  return switchFailureText(t, { kind: 'unreachable', detail: result.error ?? '' }, url)
}

// ── Manager UI state ─────────────────────────────────────────────
//
// Module-level rather than owned by a component: it is opened from the server
// picker, which is rendered by the status bar but driven from several places
// (the chip, the palette, the keybinding, Mission Control's disconnected
// panel). Exactly one instance must exist, or two dialogs would race over the
// same roster.

export const managerOpen = ref(false)

export function openServerManager(): void {
  managerOpen.value = true
}

export function closeServerManager(): void {
  managerOpen.value = false
}
