import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  PREVIEW_DOCK_REQUEST_EVENT,
  PREVIEW_DOCK_RESULT_EVENT,
} from '../composables/previewWindowBridge'

const mocks = vi.hoisted(() => ({
  tauri: true,
}))

vi.mock('../composables/useTransport', () => ({
  isTauri: () => mocks.tauri,
  tauriInvoke: vi.fn(async () => undefined),
}))

import {
  usePreviewWindowDock,
  type PreviewWindowDockOptions,
} from '../composables/usePreviewWindowDock'

interface FakeWindow {
  label: string
  outerPosition: ReturnType<typeof vi.fn>
  innerPosition: ReturnType<typeof vi.fn>
  innerSize: ReturnType<typeof vi.fn>
  outerSize: ReturnType<typeof vi.fn>
  scaleFactor: ReturnType<typeof vi.fn>
  onMoved: ReturnType<typeof vi.fn>
  isVisible: ReturnType<typeof vi.fn>
  unminimize: ReturnType<typeof vi.fn>
  show: ReturnType<typeof vi.fn>
  setFocus: ReturnType<typeof vi.fn>
}

function fakeWindow(
  label: string,
  x: number,
  y: number,
  width: number,
  height: number,
  titleBar = 28
): FakeWindow {
  return {
    label,
    outerPosition: vi.fn(async () => ({ x, y })),
    innerPosition: vi.fn(async () => ({ x, y: y + titleBar })),
    innerSize: vi.fn(async () => ({ width, height: height - titleBar })),
    outerSize: vi.fn(async () => ({ width, height })),
    scaleFactor: vi.fn(async () => 1),
    onMoved: vi.fn(async () => () => {}),
    isVisible: vi.fn(async () => true),
    unminimize: vi.fn(async () => {}),
    show: vi.fn(async () => {}),
    setFocus: vi.fn(async () => {}),
  }
}

let handlers: Map<string, (event: { payload?: any }) => void>

function installTauri(windows: FakeWindow[]): ReturnType<typeof vi.fn> {
  handlers = new Map()
  const emitTo = vi.fn(async () => undefined)
  ;(window as any).__TAURI__ = {
    window: {
      getCurrentWindow: () => windows[0],
      getAllWindows: async () => windows,
    },
    event: {
      listen: vi.fn(async (event: string, handler: (e: { payload?: any }) => void) => {
        handlers.set(event, handler)
        return () => handlers.delete(event)
      }),
      emitTo,
    },
  }
  return emitTo
}

const options = {
  windowLabel: 'preview-files-pane-1',
  kind: 'files' as const,
  sourcePaneId: () => 'pane-1',
  getLocation: () => ({ path: '/tmp/a.md' }),
}

async function setupMoved(
  windows: FakeWindow[],
  overrides: Partial<PreviewWindowDockOptions> = {}
): Promise<{ move: () => void; dispose: () => void; emitTo: ReturnType<typeof vi.fn> }> {
  const emitTo = installTauri(windows)
  let moved: (() => void) | undefined
  windows[0].onMoved.mockImplementation(async (handler: () => void) => {
    moved = handler
    return () => {}
  })

  const dispose = usePreviewWindowDock({ ...options, ...overrides })
  await vi.waitFor(() => expect(moved).toBeTypeOf('function'))
  return { move: () => moved?.(), dispose, emitTo }
}

describe('usePreviewWindowDock', () => {
  beforeEach(() => {
    mocks.tauri = true
  })

  afterEach(() => {
    vi.useRealTimers()
    delete (window as any).__TAURI__
  })

  it('asks the main window to merge once the title bar settles over it', async () => {
    const self = fakeWindow('preview-files-pane-1', 150, 128, 300, 200)
    const main = fakeWindow('main', 100, 100, 800, 600)
    const { move, dispose, emitTo } = await setupMoved([self, main])

    vi.useFakeTimers()
    move()
    await vi.advanceTimersByTimeAsync(400)
    vi.useRealTimers()

    expect(emitTo).toHaveBeenCalledWith(
      'main',
      PREVIEW_DOCK_REQUEST_EVENT,
      expect.objectContaining({
        windowLabel: 'preview-files-pane-1',
        kind: 'files',
        sourcePaneId: 'pane-1',
        path: '/tmp/a.md',
      })
    )
    expect(main.setFocus).toHaveBeenCalled()
    dispose()
  })

  it('does nothing when the title bar is outside the main window', async () => {
    const self = fakeWindow('preview-files-pane-1', 150, 10, 300, 200)
    const main = fakeWindow('main', 100, 100, 800, 600)
    const { move, dispose, emitTo } = await setupMoved([self, main])

    vi.useFakeTimers()
    move()
    await vi.advanceTimersByTimeAsync(400)
    vi.useRealTimers()

    expect(emitTo).not.toHaveBeenCalled()
    dispose()
  })

  it('shows the hint before the move settles', async () => {
    const self = fakeWindow('preview-files-pane-1', 150, 128, 300, 200)
    const main = fakeWindow('main', 100, 100, 800, 600)
    const onHintChange = vi.fn()
    const { move, dispose } = await setupMoved([self, main], { onHintChange })

    vi.useFakeTimers()
    move()
    await vi.advanceTimersByTimeAsync(100)

    expect(onHintChange).toHaveBeenLastCalledWith(true)
    expect(vi.getTimerCount()).toBeGreaterThan(0)
    dispose()
  })

  it('does nothing when the main window is hidden', async () => {
    const self = fakeWindow('preview-files-pane-1', 150, 128, 300, 200)
    const main = fakeWindow('main', 100, 100, 800, 600)
    main.isVisible.mockResolvedValue(false)
    const { move, dispose, emitTo } = await setupMoved([self, main])

    vi.useFakeTimers()
    move()
    await vi.advanceTimersByTimeAsync(400)
    vi.useRealTimers()

    expect(emitTo).not.toHaveBeenCalled()
    dispose()
  })

  it('unlocks after a rejected merge so the user can try again', async () => {
    const self = fakeWindow('preview-files-pane-1', 150, 128, 300, 200)
    const main = fakeWindow('main', 100, 100, 800, 600)
    const onRejected = vi.fn()
    const { move, dispose, emitTo } = await setupMoved([self, main], { onRejected })

    vi.useFakeTimers()
    move()
    await vi.advanceTimersByTimeAsync(400)
    expect(emitTo).toHaveBeenCalledTimes(1)

    const requestId = emitTo.mock.calls[0][2].requestId
    handlers.get(PREVIEW_DOCK_RESULT_EVENT)?.({
      payload: { requestId, ok: false, reason: 'no-active-terminal' },
    })
    expect(onRejected).toHaveBeenCalledWith('no-active-terminal')

    move()
    await vi.advanceTimersByTimeAsync(400)
    vi.useRealTimers()
    expect(emitTo).toHaveBeenCalledTimes(2)
    dispose()
  })

  it('is a no-op outside the desktop app', async () => {
    mocks.tauri = false
    installTauri([])

    const dispose = usePreviewWindowDock(options)
    dispose()

    expect((window as any).__TAURI__.event.listen).not.toHaveBeenCalled()
  })
})
