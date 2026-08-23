import { describe, it, expect, beforeEach, vi } from 'vitest'

const api = vi.hoisted(() => ({
  authFetch: vi.fn(() => Promise.resolve(new Response())),
  getApiBase: vi.fn().mockResolvedValue(''),
}))

const ws = vi.hoisted(() => ({
  onEvent: vi.fn(),
  getClientId: vi.fn(() => 'client-1'),
}))

vi.mock('../useSyncWebSocket', () => ({
  onEvent: ws.onEvent,
  getClientId: ws.getClientId,
}))

vi.mock('../apiBase', () => ({
  authFetch: api.authFetch,
  apiUrl: (path: string) => path,
  getApiBase: api.getApiBase,
  wsUrlWithToken: (url: string) => url,
}))

import { subscribe, dispatchLocal } from '../useEventBridge'
import type { SyncEvent } from '../../types/protocol'

// The module-level `onEvent((e) => dispatch(e))` registered at import time;
// capture that handler so the WS path can be driven directly.
function wsHandler(): (e: SyncEvent) => void {
  return ws.onEvent.mock.calls[0][0]
}

describe('useEventBridge dispatchLocal', () => {
  beforeEach(() => {
    api.authFetch.mockClear()
  })

  it('delivers a local event to handlers without hitting the backend', () => {
    const handler = vi.fn()
    const unsub = subscribe('foo', handler)
    dispatchLocal('foo', { n: 1 })
    expect(handler).toHaveBeenCalledTimes(1)
    expect(handler.mock.calls[0][0]).toEqual({ n: 1 })
    expect(api.authFetch).not.toHaveBeenCalled()
    unsub()
  })

  it('routes through the same dispatch body as the WS path', () => {
    const handler = vi.fn()
    const unsub = subscribe('foo', handler)
    wsHandler()({ type: 'event', event_name: 'foo', data: { from: 'ws' } })
    dispatchLocal('foo', { from: 'local' })
    expect(handler).toHaveBeenCalledTimes(2)
    expect(handler.mock.calls[0][0]).toEqual({ from: 'ws' })
    expect(handler.mock.calls[1][0]).toEqual({ from: 'local' })
    unsub()
  })

  it('filters by target_plugin_id on the local path', () => {
    const a = vi.fn()
    const b = vi.fn()
    const unsubA = subscribe('foo', a, { pluginId: 'pA' })
    const unsubB = subscribe('foo', b, { pluginId: 'pB' })
    dispatchLocal('foo', {}, { target_plugin_id: 'pB' })
    expect(a).not.toHaveBeenCalled()
    expect(b).toHaveBeenCalledTimes(1)
    unsubA()
    unsubB()
  })

  it('does nothing when no handler is subscribed', () => {
    expect(() => dispatchLocal('nobody', {})).not.toThrow()
  })

  it('unsubscribe stops local delivery', () => {
    const handler = vi.fn()
    const unsub = subscribe('foo', handler)
    unsub()
    dispatchLocal('foo', {})
    expect(handler).not.toHaveBeenCalled()
  })
})
