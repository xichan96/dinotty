import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DETACHED_DOCK_TARGET_EVENT,
  DETACHED_DOCK_TARGET_REQUEST_EVENT,
} from '../composables/detachedWindowBridge'

const mocks = vi.hoisted(() => ({
  tauri: true,
}))

vi.mock('../composables/useTransport', () => ({
  isTauri: () => mocks.tauri,
}))

import { useDockTargetReporter } from '../composables/useDockTargetReporter'

type Handler = (event: { payload?: { tab_id?: string; request_id?: string } }) => void

let handlers: Map<string, Handler>
let emit: ReturnType<typeof vi.fn>

function installTauri(): void {
  handlers = new Map()
  emit = vi.fn(async () => {})
  ;(window as any).__TAURI__ = {
    window: {
      getCurrentWindow: () => ({
        innerPosition: async () => ({ x: 100, y: 50 }),
        scaleFactor: async () => 2,
      }),
    },
    event: {
      listen: vi.fn(async (event: string, handler: Handler) => {
        handlers.set(event, handler)
        return () => handlers.delete(event)
      }),
      emit,
    },
  }
}

function mountTabBar(rect?: { left: number; top: number; width: number; height: number }): void {
  const element = document.createElement('div')
  element.id = 'tab-bar'
  if (rect) {
    element.getBoundingClientRect = () =>
      ({
        ...rect,
        x: rect.left,
        y: rect.top,
        right: rect.left + rect.width,
        bottom: rect.top + rect.height,
        toJSON: () => ({}),
      }) as DOMRect
  }
  document.body.appendChild(element)
}

async function setupReporter(): Promise<() => void> {
  const dispose = useDockTargetReporter()
  await vi.waitFor(() =>
    expect(handlers.get(DETACHED_DOCK_TARGET_REQUEST_EVENT)).toBeTypeOf('function')
  )
  return dispose
}

async function request(handler: Handler, tabId = 'a', requestId = 'r1'): Promise<void> {
  handler({ payload: { tab_id: tabId, request_id: requestId } })
  await vi.waitFor(() => expect(emit).toHaveBeenCalled())
}

describe('useDockTargetReporter', () => {
  beforeEach(() => {
    mocks.tauri = true
    installTauri()
  })

  afterEach(() => {
    document.body.replaceChildren()
    delete (window as any).__TAURI__
  })

  it('reports the tab bar in physical screen pixels', async () => {
    mountTabBar({ left: 10, top: 20, width: 300, height: 40 })
    const dispose = await setupReporter()

    await request(handlers.get(DETACHED_DOCK_TARGET_REQUEST_EVENT)!)

    // Client area at (100, 50), scale 2: CSS px become physical px.
    expect(emit).toHaveBeenCalledWith(DETACHED_DOCK_TARGET_EVENT, {
      tab_id: 'a',
      request_id: 'r1',
      rect: { x: 120, y: 90, width: 600, height: 80 },
    })
    dispose()
  })

  it('reports null when the tab bar is not mounted', async () => {
    const dispose = await setupReporter()

    await request(handlers.get(DETACHED_DOCK_TARGET_REQUEST_EVENT)!)

    expect(emit).toHaveBeenCalledWith(DETACHED_DOCK_TARGET_EVENT, {
      tab_id: 'a',
      request_id: 'r1',
      rect: null,
    })
    dispose()
  })

  it('reports null for a collapsed tab bar', async () => {
    mountTabBar() // jsdom measures 0x0 unless stubbed
    const dispose = await setupReporter()

    await request(handlers.get(DETACHED_DOCK_TARGET_REQUEST_EVENT)!)

    expect(emit).toHaveBeenCalledWith(DETACHED_DOCK_TARGET_EVENT, {
      tab_id: 'a',
      request_id: 'r1',
      rect: null,
    })
    dispose()
  })

  it('ignores malformed requests', async () => {
    mountTabBar({ left: 10, top: 20, width: 300, height: 40 })
    const dispose = await setupReporter()
    const handler = handlers.get(DETACHED_DOCK_TARGET_REQUEST_EVENT)!

    handler({ payload: { request_id: 'r1' } })
    handler({ payload: { tab_id: 'a' } })
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(emit).not.toHaveBeenCalled()
    dispose()
  })

  it('stops replying after disposal', async () => {
    mountTabBar({ left: 10, top: 20, width: 300, height: 40 })
    const dispose = await setupReporter()
    const handler = handlers.get(DETACHED_DOCK_TARGET_REQUEST_EVENT)!

    dispose()
    handler({ payload: { tab_id: 'a', request_id: 'r1' } })
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(emit).not.toHaveBeenCalled()
  })

  it('is a no-op outside the desktop app', async () => {
    mocks.tauri = false

    const dispose = useDockTargetReporter()
    dispose()

    expect(handlers.size).toBe(0)
  })
})
