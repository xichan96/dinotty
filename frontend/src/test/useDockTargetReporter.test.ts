import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DETACHED_DOCK_TARGET_EVENT,
  DETACHED_DOCK_TARGET_REQUEST_EVENT,
} from '../composables/detachedWindowBridge'
import {
  PREVIEW_DOCK_TARGET_EVENT,
  PREVIEW_DOCK_TARGET_REQUEST_EVENT,
} from '../composables/previewWindowBridge'

const mocks = vi.hoisted(() => ({
  tauri: true,
}))

vi.mock('../composables/useTransport', () => ({
  isTauri: () => mocks.tauri,
}))

import { useDockTargetReporter } from '../composables/useDockTargetReporter'

type Handler = (event: {
  payload?: { tab_id?: string; request_id?: string; requestId?: string }
}) => void

interface Rect {
  left: number
  top: number
  width: number
  height: number
}

function stubRect(rect: Rect): () => DOMRect {
  return () =>
    ({
      ...rect,
      x: rect.left,
      y: rect.top,
      right: rect.left + rect.width,
      bottom: rect.top + rect.height,
      toJSON: () => ({}),
    }) as DOMRect
}

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

function mountTabBar(rect?: Rect): HTMLElement {
  const element = document.createElement('div')
  element.id = 'tab-bar'
  if (rect) element.getBoundingClientRect = stubRect(rect)
  document.body.appendChild(element)
  return element
}

/** Toolbar buttons seated on the right end of the tab bar. */
function mountTools(rect: Rect): void {
  const bar = document.getElementById('tab-bar')
  if (!bar) throw new Error('mount the tab bar first')
  const tools = document.createElement('div')
  tools.className = 'tab-bar-tools'
  tools.getBoundingClientRect = stubRect(rect)
  bar.appendChild(tools)
}

async function setupReporter(): Promise<() => void> {
  const dispose = useDockTargetReporter()
  await vi.waitFor(() => {
    expect(handlers.get(DETACHED_DOCK_TARGET_REQUEST_EVENT)).toBeTypeOf('function')
    expect(handlers.get(PREVIEW_DOCK_TARGET_REQUEST_EVENT)).toBeTypeOf('function')
  })
  return dispose
}

async function requestPreview(handler: Handler, requestId = 'p1'): Promise<void> {
  handler({ payload: { requestId } })
  await vi.waitFor(() => expect(emit).toHaveBeenCalled())
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

  it('reports the tab strip ending where the toolbar buttons begin', async () => {
    mountTabBar({ left: 10, top: 20, width: 300, height: 40 })
    mountTools({ left: 250, top: 20, width: 50, height: 40 })
    const dispose = await setupReporter()

    await requestPreview(handlers.get(PREVIEW_DOCK_TARGET_REQUEST_EVENT)!)

    // Same client-area origin and scale as above; the strip stops at x=250.
    expect(emit).toHaveBeenCalledWith(PREVIEW_DOCK_TARGET_EVENT, {
      requestId: 'p1',
      rect: { x: 120, y: 90, width: 480, height: 80 },
    })
    dispose()
  })

  it('reports the whole bar for a vertical (side) placement', async () => {
    mountTabBar({ left: 10, top: 20, width: 40, height: 300 })
    mountTools({ left: 10, top: 20, width: 40, height: 60 })
    const dispose = await setupReporter()

    await requestPreview(handlers.get(PREVIEW_DOCK_TARGET_REQUEST_EVENT)!)

    expect(emit).toHaveBeenCalledWith(PREVIEW_DOCK_TARGET_EVENT, {
      requestId: 'p1',
      rect: { x: 120, y: 90, width: 80, height: 600 },
    })
    dispose()
  })

  it('reports null when the tab strip is not mounted', async () => {
    const dispose = await setupReporter()

    await requestPreview(handlers.get(PREVIEW_DOCK_TARGET_REQUEST_EVENT)!)

    expect(emit).toHaveBeenCalledWith(PREVIEW_DOCK_TARGET_EVENT, {
      requestId: 'p1',
      rect: null,
    })
    dispose()
  })

  it('is a no-op outside the desktop app', async () => {
    mocks.tauri = false

    const dispose = useDockTargetReporter()
    dispose()

    expect(handlers.size).toBe(0)
  })
})
