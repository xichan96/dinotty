import { computed, markRaw, reactive } from 'vue'
import type {
  RemoteServerTransport,
  RemoteServerTransportResult,
  RemoteServerTransportServer,
} from '../../../plugin-api/index'

/** The explicit capability a plugin must declare before it can alter the host roster flow. */
export const REMOTE_SERVER_TRANSPORT_PERMISSION = 'remoteServers.transport'

export interface RegisteredRemoteServerTransport extends RemoteServerTransport {
  pluginId: string
  available: boolean
  error: string | null
}

const transports = reactive(new Map<string, RegisteredRemoteServerTransport>())

function key(pluginId: string, transportId: string): string {
  return `${pluginId}:${transportId}`
}

export function registerRemoteServerTransport(
  pluginId: string,
  contribution: RemoteServerTransport
): { dispose(): void } {
  if (!/^[a-z][a-z0-9-]*$/.test(contribution.id)) {
    throw new Error("remote server transport id must match [a-z][a-z0-9-]*")
  }
  if (!contribution.label.trim() || !contribution.component) {
    throw new Error('remote server transport requires a label and component')
  }
  const registryKey = key(pluginId, contribution.id)
  if (transports.has(registryKey)) {
    throw new Error(`remote server transport '${contribution.id}' is already registered`)
  }
  transports.set(registryKey, {
    ...contribution,
    component: markRaw(contribution.component),
    pluginId,
    available: true,
    error: null,
  })
  return { dispose: () => transports.delete(registryKey) }
}

export function unregisterRemoteServerTransports(pluginId: string): void {
  for (const [registryKey, transport] of transports) {
    if (transport.pluginId === pluginId) transports.delete(registryKey)
  }
}

export function hasRemoteServerTransports(pluginId: string): boolean {
  return Array.from(transports.values()).some((transport) => transport.pluginId === pluginId)
}

export async function unloadRemoteServerTransports(
  pluginId: string,
  servers: Array<{ id: string; name: string; url: string; transport?: { pluginId: string; transportId: string } | null }>
): Promise<void> {
  for (const server of servers) {
    if (server.transport?.pluginId !== pluginId) continue
    await invokeTransportLifecycle('unload', { ...server, transport: server.transport })
  }
  unregisterRemoteServerTransports(pluginId)
}

export function getRemoteServerTransport(
  ref: { pluginId: string; transportId: string } | null | undefined
): RegisteredRemoteServerTransport | undefined {
  return ref ? transports.get(key(ref.pluginId, ref.transportId)) : undefined
}

export function useRemoteServerTransports() {
  return {
    transports: computed(() => Array.from(transports.values())),
    get: getRemoteServerTransport,
  }
}

/**
 * A connector is intentionally limited to an origin on this machine. Remote
 * credentials belong to the host's token field, never to a transport plugin.
 */
export function validateRemoteServerTransportResult(
  result: RemoteServerTransportResult
): { ok: true; url: string } | { ok: false; error: string } {
  if (!result || typeof result.url !== 'string') {
    return { ok: false, error: 'transport must return a local URL' }
  }
  let url: URL
  try {
    url = new URL(result.url)
  } catch {
    return { ok: false, error: 'transport returned an invalid URL' }
  }
  const loopback = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]'
  if (!loopback || (url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    return { ok: false, error: 'transport URL must be an http(s) loopback origin without credentials or a path' }
  }
  return { ok: true, url: url.origin }
}

/** Host-safe lifecycle view. It never includes a remote-server token. */
export function transportServer(draft: {
  id: string
  name: string
  url: string
  transport?: { pluginId: string; transportId: string } | null
}): RemoteServerTransportServer {
  return { id: draft.id, name: draft.name.trim(), url: draft.url.trim() }
}

export async function invokeTransportLifecycle(
  phase: 'saved' | 'deleted' | 'unload',
  draft: { id: string; name: string; url: string; transport?: { pluginId: string; transportId: string } | null }
): Promise<string | null> {
  const transport = getRemoteServerTransport(draft.transport)
  if (!transport) return null // unavailable plugins cannot run cleanup; removal still remains possible.
  const callback =
    phase === 'saved' ? transport.onSaved : phase === 'deleted' ? transport.onDeleted : transport.onUnload
  if (!callback) return null
  try {
    await callback(transportServer(draft))
    return null
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    transport.available = false
    transport.error = message
    return `${transport.label}: ${message}`
  }
}

export async function recoverRemoteServerTransport(
  pluginId: string,
  servers: Array<{ id: string; name: string; url: string; transport?: { pluginId: string; transportId: string } | null }>
): Promise<void> {
  for (const transport of transports.values()) {
    if (transport.pluginId !== pluginId || !transport.recover) continue
    const matching = servers
      .filter((server) => server.transport?.pluginId === pluginId && server.transport.transportId === transport.id)
      .map((server) => transportServer({ ...server, transport: server.transport ?? null }))
    try {
      await transport.recover(matching)
      transport.available = true
      transport.error = null
    } catch (error) {
      transport.available = false
      transport.error = error instanceof Error ? error.message : String(error)
    }
  }
}
