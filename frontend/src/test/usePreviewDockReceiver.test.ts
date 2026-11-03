import { flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  PREVIEW_DOCK_REQUEST_EVENT,
  PREVIEW_DOCK_RESULT_EVENT,
} from '../composables/previewWindowBridge'

const mocks = vi.hoisted(() => ({
  tauri: true,
  dock: vi.fn(
    async (): Promise<'ok' | 'no-active-terminal' | 'invalid-target' | 'insert-failed'> => 'ok'
  ),
  closeWindow: vi.fn(async () => undefined),
  notify: vi.fn(),
}))

vi.mock('../composables/useTransport', () => ({
  isTauri: () => mocks.tauri,
}))

import { usePreviewDockReceiver } from '../composables/usePreviewDockReceiver'

let handlers: Map<string, (event: { payload?: unknown }) => void>
let emitTo: ReturnType<typeof vi.fn>

function installTauri() {
  handlers = new Map()
  emitTo = vi.fn(async () => undefined)
  ;(window as any).__TAURI__ = {
    event: {
      listen: vi.fn(async (event: string, handler: (e: { payload?: unknown }) => void) => {
        handlers.set(event, handler)
        return () => handlers.delete(event)
      }),
      emitTo,
    },
  }
}

async function setup(): Promise<() => void> {
  installTauri()
  const dispose = usePreviewDockReceiver({
    dock: mocks.dock,
    closeWindow: mocks.closeWindow,
    notify: mocks.notify,
  })
  await vi.waitFor(() => expect(handlers.has(PREVIEW_DOCK_REQUEST_EVENT)).toBe(true))
  return dispose
}

async function fire(payload: unknown) {
  handlers.get(PREVIEW_DOCK_REQUEST_EVENT)?.({ payload })
  await flushPromises()
}

const request = {
  requestId: 'req-1',
  windowLabel: 'preview-files-pane-1',
  kind: 'files' as const,
  sourcePaneId: 'pane-1',
  path: '/tmp/a.md',
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.dock.mockResolvedValue('ok')
  mocks.closeWindow.mockResolvedValue(undefined)
})

afterEach(() => {
  delete (window as any).__TAURI__
})

describe('usePreviewDockReceiver', () => {
  it('closes the source window after the pane was inserted', async () => {
    const dispose = await setup()
    await fire(request)

    expect(mocks.dock).toHaveBeenCalledWith(expect.objectContaining(request))
    expect(mocks.closeWindow).toHaveBeenCalledWith('preview-files-pane-1')
    expect(mocks.notify).not.toHaveBeenCalled()
    expect(emitTo).not.toHaveBeenCalled()

    dispose()
  })

  it('reports a rejected merge back to the window and keeps it open', async () => {
    mocks.dock.mockResolvedValue('no-active-terminal')
    const dispose = await setup()
    await fire(request)

    expect(mocks.closeWindow).not.toHaveBeenCalled()
    expect(mocks.notify).toHaveBeenCalledWith('no-active-terminal')
    expect(emitTo).toHaveBeenCalledWith('preview-files-pane-1', PREVIEW_DOCK_RESULT_EVENT, {
      requestId: 'req-1',
      ok: false,
      reason: 'no-active-terminal',
    })

    dispose()
  })

  it('maps a thrown insert to insert-failed', async () => {
    mocks.dock.mockRejectedValue(new Error('boom'))
    const dispose = await setup()
    await fire(request)

    expect(mocks.notify).toHaveBeenCalledWith('insert-failed')
    expect(mocks.closeWindow).not.toHaveBeenCalled()

    dispose()
  })

  it('ignores malformed requests and non-preview labels', async () => {
    const dispose = await setup()

    await fire({ ...request, windowLabel: 'main' })
    await fire({ ...request, requestId: '' })
    await fire({ ...request, kind: 'plugin' })

    expect(mocks.dock).not.toHaveBeenCalled()

    dispose()
  })

  it('handles a replayed request id only once', async () => {
    const dispose = await setup()
    await fire(request)
    await fire(request)

    expect(mocks.dock).toHaveBeenCalledTimes(1)

    dispose()
  })

  it('is a no-op outside the desktop app', async () => {
    mocks.tauri = false
    installTauri()

    const dispose = usePreviewDockReceiver({
      dock: mocks.dock,
      closeWindow: mocks.closeWindow,
      notify: mocks.notify,
    })
    dispose()

    expect((window as any).__TAURI__.event.listen).not.toHaveBeenCalled()
    mocks.tauri = true
  })
})
