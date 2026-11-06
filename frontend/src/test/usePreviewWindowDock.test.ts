import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WindowRect } from '../utils/windowDock'
import {
  PREVIEW_DOCK_REQUEST_EVENT,
  PREVIEW_DOCK_RESULT_EVENT,
  PREVIEW_DOCK_TARGET_EVENT,
  PREVIEW_DOCK_TARGET_REQUEST_EVENT,
} from '../composables/previewWindowBridge'

const mocks = vi.hoisted(() => ({
  tauri: true,
  invoke: vi.fn(async (_cmd: string): Promise<unknown> => null),
}))

vi.mock('../composables/useTransport', () => ({
  isTauri: () => mocks.tauri,
  tauriInvoke: mocks.invoke,
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

/** The tab strip reported by the main window: top-left of the tab bar, ending
 *  where `.tab-bar-tools` begins. */
const DEFAULT_TARGET: WindowRect = { x: 100, y: 100, width: 600, height: 40 }

let handlers: Map<string, (event: { payload?: any }) => void>
let emitTo: ReturnType<typeof vi.fn>
let targetRect: WindowRect | null

function installTauri(windows: FakeWindow[]): ReturnType<typeof vi.fn> {
  handlers = new Map()
  targetRect = DEFAULT_TARGET
  emitTo = vi.fn(async (_label: string, event: string, payload: any) => {
    if (event === PREVIEW_DOCK_TARGET_REQUEST_EVENT) {
      // Stand-in for the main window: answer every request with the current
      // tab-strip rectangle.
      handlers.get(PREVIEW_DOCK_TARGET_EVENT)?.({
        payload: { requestId: payload.requestId, rect: targetRect },
      })
    }
  })
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
): Promise<{ move: () => void; dispose: () => void }> {
  installTauri(windows)
  let moved: (() => void) | undefined
  windows[0].onMoved.mockImplementation(async (handler: () => void) => {
    moved = handler
    return () => {}
  })

  const dispose = usePreviewWindowDock({ ...options, ...overrides })
  await vi.waitFor(() => expect(moved).toBeTypeOf('function'))
  return { move: () => moved?.(), dispose }
}

function dockRequests(): any[] {
  return emitTo.mock.calls
    .filter((call) => call[1] === PREVIEW_DOCK_REQUEST_EVENT)
    .map((call) => call[2])
}

describe('usePreviewWindowDock', () => {
  beforeEach(() => {
    mocks.tauri = true
    mocks.invoke.mockReset()
    mocks.invoke.mockResolvedValue(null)
  })

  afterEach(() => {
    vi.useRealTimers()
    delete (window as any).__TAURI__
  })

  it('shows the hint when the title bar is over the tab strip', async () => {
    const self = fakeWindow('preview-files-pane-1', 150, 105, 300, 200)
    const main = fakeWindow('main', 100, 100, 800, 600)
    const onHintChange = vi.fn()
    const { move, dispose } = await setupMoved([self, main], { onHintChange })

    vi.useFakeTimers()
    move()
    await vi.advanceTimersByTimeAsync(100)

    expect(onHintChange).toHaveBeenLastCalledWith(true)
    dispose()
  })

  it('never hints over the terminal area', async () => {
    // Same main window, but the title bar sits far below the tab strip.
    const self = fakeWindow('preview-files-pane-1', 150, 300, 300, 200)
    const main = fakeWindow('main', 100, 100, 800, 600)
    const onHintChange = vi.fn()
    const { move, dispose } = await setupMoved([self, main], { onHintChange })

    vi.useFakeTimers()
    move()
    await vi.advanceTimersByTimeAsync(200)

    expect(onHintChange).not.toHaveBeenCalled()
    dispose()
  })

  it('does not merge while the mouse button is still down', async () => {
    mocks.invoke.mockResolvedValue(1)
    const self = fakeWindow('preview-files-pane-1', 150, 105, 300, 200)
    const main = fakeWindow('main', 100, 100, 800, 600)
    const { move, dispose } = await setupMoved([self, main])

    vi.useFakeTimers()
    move()
    await vi.advanceTimersByTimeAsync(2000)

    expect(emitTo).toHaveBeenCalledWith(
      'main',
      PREVIEW_DOCK_TARGET_REQUEST_EVENT,
      expect.anything()
    )
    expect(dockRequests()).toHaveLength(0)
    dispose()
  })

  it('merges when the button is released over the tab strip', async () => {
    mocks.invoke.mockResolvedValueOnce(1).mockResolvedValue(0)
    const self = fakeWindow('preview-files-pane-1', 150, 105, 300, 200)
    const main = fakeWindow('main', 100, 100, 800, 600)
    const { move, dispose } = await setupMoved([self, main])

    vi.useFakeTimers()
    move()
    await vi.advanceTimersByTimeAsync(200)

    expect(dockRequests()).toEqual([
      expect.objectContaining({
        windowLabel: 'preview-files-pane-1',
        kind: 'files',
        sourcePaneId: 'pane-1',
        path: '/tmp/a.md',
      }),
    ])
    expect(main.setFocus).toHaveBeenCalled()
    dispose()
  })

  it('does not merge when the button is released away from the strip', async () => {
    mocks.invoke.mockResolvedValueOnce(1).mockResolvedValue(0)
    const self = fakeWindow('preview-files-pane-1', 150, 300, 300, 200)
    const main = fakeWindow('main', 100, 100, 800, 600)
    const onHintChange = vi.fn()
    const { move, dispose } = await setupMoved([self, main], { onHintChange })

    vi.useFakeTimers()
    move()
    await vi.advanceTimersByTimeAsync(200)

    expect(dockRequests()).toHaveLength(0)
    expect(onHintChange).not.toHaveBeenLastCalledWith(true)
    dispose()
  })

  it('falls back to merging after the move settles when button state is unavailable', async () => {
    mocks.invoke.mockResolvedValue(null)
    const self = fakeWindow('preview-files-pane-1', 150, 105, 300, 200)
    const main = fakeWindow('main', 100, 100, 800, 600)
    const { move, dispose } = await setupMoved([self, main])

    vi.useFakeTimers()
    move()
    await vi.advanceTimersByTimeAsync(500)

    expect(dockRequests()).toHaveLength(1)
    dispose()
  })

  it('ignores a programmatic move that never sees a press', async () => {
    mocks.invoke.mockResolvedValue(0)
    const self = fakeWindow('preview-files-pane-1', 150, 105, 300, 200)
    const main = fakeWindow('main', 100, 100, 800, 600)
    const { move, dispose } = await setupMoved([self, main])

    vi.useFakeTimers()
    move()
    await vi.advanceTimersByTimeAsync(2000)

    expect(dockRequests()).toHaveLength(0)
    dispose()
  })

  it('does nothing when the main window is hidden', async () => {
    mocks.invoke.mockResolvedValueOnce(1).mockResolvedValue(0)
    const self = fakeWindow('preview-files-pane-1', 150, 105, 300, 200)
    const main = fakeWindow('main', 100, 100, 800, 600)
    main.isVisible.mockResolvedValue(false)
    const { move, dispose } = await setupMoved([self, main])

    vi.useFakeTimers()
    move()
    await vi.advanceTimersByTimeAsync(500)

    expect(dockRequests()).toHaveLength(0)
    dispose()
  })

  it('unlocks after a rejected merge so the user can try again', async () => {
    mocks.invoke.mockResolvedValueOnce(1).mockResolvedValueOnce(0)
    const self = fakeWindow('preview-files-pane-1', 150, 105, 300, 200)
    const main = fakeWindow('main', 100, 100, 800, 600)
    const onRejected = vi.fn()
    const { move, dispose } = await setupMoved([self, main], { onRejected })

    vi.useFakeTimers()
    move()
    await vi.advanceTimersByTimeAsync(200)
    expect(dockRequests()).toHaveLength(1)

    const requestId = dockRequests()[0].requestId
    handlers.get(PREVIEW_DOCK_RESULT_EVENT)?.({
      payload: { requestId, ok: false, reason: 'no-active-terminal' },
    })
    expect(onRejected).toHaveBeenCalledWith('no-active-terminal')

    mocks.invoke.mockResolvedValueOnce(1).mockResolvedValue(0)
    move()
    await vi.advanceTimersByTimeAsync(200)

    expect(dockRequests()).toHaveLength(2)
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
