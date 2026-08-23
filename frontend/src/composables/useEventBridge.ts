import { onEvent, getClientId } from './useSyncWebSocket'
import { authFetch, apiUrl } from './apiBase'
import type { SyncEvent } from '../types/protocol'

export type EventHandler<T = unknown> = (data: T, e: SyncEvent) => void

type HandlerEntry = {
  handler: EventHandler
  pluginId?: string
}

const handlers = new Map<string, Set<HandlerEntry>>()

// Shared routing body used by both the WS event path and local dispatch
// (dispatchLocal) so same-client plugins hear the same events with the same
// target_plugin_id semantics.
function dispatch(e: SyncEvent) {
  const set = handlers.get(e.event_name)
  if (!set) return
  for (const entry of set) {
    // If the event carries a target_plugin_id, only trigger the matching plugin's handler.
    if (e.target_plugin_id && entry.pluginId !== e.target_plugin_id) continue
    entry.handler(e.data, e)
  }
}

// Register a single onEvent listener at module load; dispatches to matching handlers.
onEvent((e) => dispatch(e))

function reportPluginSubscription(
  pluginId: string,
  eventName: string,
  kind: 'subscribe' | 'unsubscribe'
) {
  void authFetch(apiUrl(`/api/plugins/${encodeURIComponent(pluginId)}/events/${kind}`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ event_name: eventName }),
  }).catch(() => {
    // Best-effort: registry is in-memory on the backend; a missed POST just
    // means the settings UI / uninstall guard may be momentarily stale.
  })
}

export function subscribe<T = unknown>(
  eventName: string,
  handler: EventHandler<T>,
  opts?: { pluginId?: string }
): () => void {
  const entry: HandlerEntry = { handler: handler as EventHandler, pluginId: opts?.pluginId }
  let set = handlers.get(eventName)
  const wasEmpty = !set || set.size === 0
  if (!set) {
    set = new Set()
    handlers.set(eventName, set)
  }
  set.add(entry)
  // Notify backend when a plugin's subscription transitions to active so the
  // settings UI / uninstall guard can reflect it.
  if (opts?.pluginId && wasEmpty) {
    reportPluginSubscription(opts.pluginId, eventName, 'subscribe')
  }
  return () => {
    set?.delete(entry)
    if (set && set.size === 0) {
      handlers.delete(eventName)
      if (entry.pluginId) {
        reportPluginSubscription(entry.pluginId, eventName, 'unsubscribe')
      }
    }
  }
}

export function hasSubscriber(eventName: string): boolean {
  const set = handlers.get(eventName)
  return !!set && set.size > 0
}

export function emit(
  eventName: string,
  data: unknown,
  opts?: { source_pane_id?: string; plugin_id?: string; target_plugin_id?: string }
): void {
  void authFetch(apiUrl('/api/events/emit'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      event_name: eventName,
      data,
      source_pane_id: opts?.source_pane_id,
      plugin_id: opts?.plugin_id,
      target_plugin_id: opts?.target_plugin_id,
      client_id: getClientId(),
    }),
  })
}

/** Dispatch an event locally (no backend round-trip, no client_id) so that
 *  same-client plugins can hear host UI broadcasts (e.g. kb-open / kb-close)
 *  which the server's broadcast_sync_others would otherwise exclude. */
export function dispatchLocal(
  eventName: string,
  data: unknown,
  opts?: { source_pane_id?: string; plugin_id?: string; target_plugin_id?: string }
): void {
  dispatch({ type: 'event', event_name: eventName, data, ...opts })
}

if (import.meta.env.DEV) {
  ;(window as any).__dinotty_eventBridge = { subscribe, emit, dispatchLocal, hasSubscriber }
}
