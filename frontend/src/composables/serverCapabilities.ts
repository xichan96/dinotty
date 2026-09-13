import { activeServerId } from './activeServer'
import { apiUrl, authFetch } from './apiBase'

/// Which calls the *active* server has told us it understands.
///
/// A hub relays to servers it did not build and cannot upgrade, and the relay
/// is a pass-through - it carries the bytes and changes nothing - so a client
/// newer than the server it is addressed to has to ask before using anything
/// the wire protocol did not always have. `GET /api/info` is where a server
/// answers, read through the same relayed route as every other call: on a
/// remote that is `/__srv/<id>/api/info`, on the local server the bare path.
///
/// The version string in that same payload cannot stand in for this. It is
/// bumped per release, not per feature, so a build that understands a new call
/// and one that predates it routinely report the same version - the repository
/// has already shipped that exact pair. Only the server can say what it
/// accepts, which is why it says it.
const capabilities = new Map<string, Set<string>>()

/// The answer for the active server, or `null` if we have not got one yet.
///
/// Keyed by server id: an answer describes one server, and a switch changes
/// which one that is. Entries live for the life of the page - a server
/// upgraded underneath a running client keeps its stale answer until reload,
/// which is the safe direction, since the stale answer is the older one.
export function cachedCapabilities(): Set<string> | null {
  return capabilities.get(activeServerId()) ?? null
}

/// Fetch and remember the active server's capabilities, once.
///
/// `null` means the question could not be answered: the request failed, or the
/// payload carries no `capabilities` key. Those two are deliberately not
/// collapsed into an empty set. "This server is too old to say" is a real
/// answer that must downgrade the call, while "we could not ask" is evidence of
/// nothing and must not - a client that confused them would downgrade its calls
/// for every transient network failure.
export async function ensureCapabilities(): Promise<Set<string> | null> {
  const id = activeServerId()
  const known = capabilities.get(id)
  if (known) return known
  try {
    const res = await authFetch(apiUrl('/api/info'))
    if (!res.ok) return null
    const body = await res.json()
    if (!Array.isArray(body?.capabilities)) return null
    const set = new Set<string>(body.capabilities.filter((c: unknown) => typeof c === 'string'))
    // Cached only on a real answer, so a failure is retried rather than
    // remembered as "this server supports nothing".
    capabilities.set(id, set)
    return set
  } catch {
    return null
  }
}

/// Whether the active server advertises `capability`; `null` if it could not be
/// asked. See [`ensureCapabilities`] for why the two are distinct.
export async function serverSupports(capability: string): Promise<boolean | null> {
  const caps = await ensureCapabilities()
  return caps === null ? null : caps.has(capability)
}
