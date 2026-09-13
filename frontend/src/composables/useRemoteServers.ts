import { computed, ref } from 'vue'
import { authFetch, hubApiUrl } from './apiBase'
import { activeServerId, LOCAL_SERVER_ID } from './activeServer'

/**
 * One entry in the server picker on the status bar.
 *
 * Mirrors the Rust `RemoteServer` shape (minus the write-only token, which the
 * API never returns - clients read `hasToken` instead). `local` is synthesized
 * here and is never part of the stored roster: the embedded server of the host
 * we are already on is not something the user manages.
 */
export interface ServerEntry {
  id: string
  name: string
  /** Origin. Empty for the synthesized local entry, which is the hub itself. */
  url: string
  hasToken: boolean
  group?: string | null
  lastSeenVersion?: string | null
  /** The host we are already running on - not stored in settings. */
  local: boolean
}

/** Why the roster may be missing entries the user expects to see. */
export type RosterStatus = 'idle' | 'loading' | 'ready' | 'unavailable'

const localEntry: ServerEntry = {
  id: LOCAL_SERVER_ID,
  name: '', // filled from i18n at render time
  url: '',
  hasToken: true,
  group: null,
  lastSeenVersion: null,
  local: true,
}

const roster = ref<ServerEntry[]>([])
const status = ref<RosterStatus>('idle')
const error = ref<string | null>(null)

function normalize(raw: any): ServerEntry | null {
  const id = typeof raw?.id === 'string' ? raw.id : ''
  if (!id || id === LOCAL_SERVER_ID) return null
  return {
    id,
    name: typeof raw?.name === 'string' && raw.name ? raw.name : id,
    url: typeof raw?.url === 'string' ? raw.url : '',
    hasToken: !!raw?.has_token,
    group: raw?.group ?? null,
    lastSeenVersion: raw?.last_seen_version ?? null,
    local: false,
  }
}

async function readRoster(): Promise<{
  ok: boolean
  entries: ServerEntry[]
  error: string | null
}> {
  try {
    // Always the hub, never the active upstream: the roster is the hub's own
    // settings.json, and routing it through the relay would ask a remote
    // server for its own (different) list.
    const res = await authFetch(hubApiUrl('/api/remote-servers'))
    if (!res.ok) {
      // 501 is the documented pre-B2 state. Anything else is a real failure,
      // but both degrade to "local only" rather than throwing at the caller.
      return { ok: false, entries: [], error: `HTTP ${res.status}` }
    }
    const data = await res.json()
    const list = Array.isArray(data) ? data : (data?.servers ?? [])
    return {
      ok: true,
      entries: (list as any[]).map(normalize).filter(Boolean) as ServerEntry[],
      error: null,
    }
  } catch (e) {
    return { ok: false, entries: [], error: e instanceof Error ? e.message : String(e) }
  }
}

/**
 * Refresh the roster from the hub.
 *
 * Degrades quietly: the switcher stays usable with just the local entry when
 * the endpoint is not implemented yet (`501`) or unreachable. A failed refresh
 * keeps whatever was already listed, so a transient error doesn't blank the
 * popover.
 */
export async function refreshRemoteServers(): Promise<void> {
  status.value = 'loading'
  const { ok, entries, error: err } = await readRoster()
  if (ok) {
    roster.value = entries
    status.value = 'ready'
    error.value = null
  } else {
    status.value = 'unavailable'
    error.value = err
  }
}

/**
 * `refreshRemoteServers`, but only when the roster is not already loaded.
 *
 * The server switchers call `refreshRemoteServers` on open so a roster change
 * made on another device shows up; this is the cheaper variant for a caller
 * that only needs the list to exist.
 */
export async function ensureRemoteServers(): Promise<void> {
  if (status.value === 'ready' || status.value === 'loading') return
  await refreshRemoteServers()
}

/**
 * Note that a server answered our probe, which means we hold a credential it
 * accepted — the one fact the roster endpoint cannot carry, because it is
 * `skip_serializing` on the token and would otherwise require a round trip to
 * re-derive. Drives the same lock icon as `has_token`.
 */
export function markServerVerified(id: string): void {
  if (id === LOCAL_SERVER_ID) return
  const entry = roster.value.find((s) => s.id === id)
  if (!entry || entry.hasToken) return
  // Replace rather than mutate: `roster` is a `ref` holding plain objects, and
  // the entry is also handed out to callers that hold on to the old one.
  roster.value = roster.value.map((s) => (s.id === id ? { ...s, hasToken: true } : s))
}

/**
 * How one roster row should read.
 *
 * Read by the status bar's picker - both the chip's dot and every row's - so
 * that "no token" cannot mean an amber dot in one place and a plain one in
 * another. The tokenless state is the one that matters: with an empty token
 * the upstream's `auth_middleware` lets everyone through, so it is a security
 * state, not a cosmetic one.
 */
export type ServerVisualState = 'local' | 'current' | 'noToken' | 'ready'

export function serverVisualState(entry: ServerEntry, currentId: string): ServerVisualState {
  if (entry.local) return 'local'
  if (entry.id === currentId) return 'current'
  return entry.hasToken ? 'ready' : 'noToken'
}

export function useRemoteServers() {
  const servers = computed<ServerEntry[]>(() => [localEntry, ...roster.value])
  const currentId = computed(() => activeServerId())
  const current = computed(() => servers.value.find((s) => s.id === currentId.value) ?? localEntry)
  /** True when the active server is no longer in the roster (e.g. removed). */
  const currentMissing = computed(
    () => !currentId.value.startsWith(LOCAL_SERVER_ID) && current.value.local
  )
  return { servers, current, currentId, currentMissing, status, error, refreshRemoteServers }
}
