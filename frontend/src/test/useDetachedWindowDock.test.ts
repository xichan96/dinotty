import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WindowRect } from '../utils/windowDock'
import {
  DETACHED_DOCK_TARGET_EVENT,
  DETACHED_DOCK_TARGET_REQUEST_EVENT,
} from '../composables/detachedWindowBridge'

const mocks = vi.hoisted(() => ({
  tauri: true,
  invoke: vi.fn(async () => undefined),
}))

vi.mock('../composables/useTransport', () => ({
  isTauri: () => mocks.tauri,
  tauriInvoke: mocks.invoke,
}))

import { useDetachedWindowDock } from '../composables/useDetachedWindowDock'

interface FakeWindow {
  label: string
  outerPosition: ReturnType<typeof vi.fn>
  innerPosition: ReturnType<typeof vi.fn>
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
    outerSize: vi.fn(async () => ({ width, height })),
    scaleFactor: vi.fn(async () => 1),
    onMoved: vi.fn(async () => () => {}),
    isVisible: vi.fn(async () => true),
    unminimize: vi.fn(async () => {}),
    show: vi.fn(async () => {}),
    setFocus: vi.fn(async () => {}),
  }
}

/** The tab bar of the fake main window at (100, 100): below its 28px title bar. */
const TAB_BAR: WindowRect = { x: 100, y: 128, width: 800, height: 36 }

let handlers: Map<string, (event: { payload?: any }) => void>

function installTauri(
  windows: FakeWindow[],
  target: WindowRect | null = TAB_BAR
): ReturnType<typeof vi.fn> {
  handlers = new Map()
  const emitTo = vi.fn(async (label: string, event: string, payload: any) => {
    if (label !== 'main' || event !== DETACHED_DOCK_TARGET_REQUEST_EVENT) return
    handlers.get(DETACHED_DOCK_TARGET_EVENT)?.({
      payload: { tab_id: payload.tab_id, request_id: payload.request_id, rect: target },
    })
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

async function setupMoved(
  windows: FakeWindow[],
  options?: Parameters<typeof useDetachedWindowDock>[1],
  target: WindowRect | null = TAB_BAR
): Promise<{ move: () => void; dispose: () => void; emitTo: ReturnType<typeof vi.fn> }> {
  const emitTo = installTauri(windows, target)
  let moved: (() => void) | undefined
  windows[0].onMoved.mockImplementation(async (handler: () => void) => {
    moved = handler
    return () => {}
  })

  const dispose = useDetachedWindowDock('tab-1', options)
  await vi.waitFor(() => expect(moved).toBeTypeOf('function'))
  return { move: () => moved?.(), dispose, emitTo }
}

async function dockAfterMoved(
  windows: FakeWindow[],
  target: WindowRect | null = TAB_BAR
): Promise<void> {
  const { move, dispose } = await setupMoved(windows, undefined, target)

  vi.useFakeTimers()
  move()
  await vi.advanceTimersByTimeAsync(400)
  vi.useRealTimers()
  dispose()
}

describe('useDetachedWindowDock', () => {
  beforeEach(() => {
    mocks.tauri = true
    mocks.invoke.mockClear()
  })

  afterEach(() => {
    vi.useRealTimers()
    delete (window as any).__TAURI__
  })

  it('recalls the tab when the title bar is over the main tab bar', async () => {
    const self = fakeWindow('tab-tab-1', 150, 128, 300, 200)
    const main = fakeWindow('main', 100, 100, 800, 600)

    await dockAfterMoved([self, main])

    expect(mocks.invoke).toHaveBeenCalledWith('close_tab_window', {
      tabId: 'tab-1',
      reattach: true,
    })
    expect(main.setFocus).toHaveBeenCalled()
  })

  it('asks the main window where its tab bar is', async () => {
    const self = fakeWindow('tab-tab-1', 150, 128, 300, 200)
    const main = fakeWindow('main', 100, 100, 800, 600)
    const { move, dispose, emitTo } = await setupMoved([self, main])

    vi.useFakeTimers()
    move()
    await vi.advanceTimersByTimeAsync(100)
    vi.useRealTimers()

    expect(emitTo).toHaveBeenCalledWith(
      'main',
      DETACHED_DOCK_TARGET_REQUEST_EVENT,
      expect.objectContaining({ tab_id: 'tab-1' })
    )
    dispose()
  })

  it('does nothing when only the window body is over the main window', async () => {
    // The whole window overlaps main, but its title bar is far below the tab
    // bar: parking the body on the window must not reattach.
    const self = fakeWindow('tab-tab-1', 150, 300, 300, 200)
    const main = fakeWindow('main', 100, 100, 800, 600)

    await dockAfterMoved([self, main])

    expect(mocks.invoke).not.toHaveBeenCalled()
  })

  it('does nothing when the title bar is only a sliver over the tab bar', async () => {
    const self = fakeWindow('tab-tab-1', 150, 110, 300, 200)
    const main = fakeWindow('main', 100, 100, 800, 600)

    await dockAfterMoved([self, main])

    expect(mocks.invoke).not.toHaveBeenCalled()
  })

  it('does nothing when the main tab bar is hidden', async () => {
    const self = fakeWindow('tab-tab-1', 150, 128, 300, 200)
    const main = fakeWindow('main', 100, 100, 800, 600)

    await dockAfterMoved([self, main], null)

    expect(mocks.invoke).not.toHaveBeenCalled()
  })

  it('does nothing when the main window is hidden to the tray', async () => {
    const self = fakeWindow('tab-tab-1', 150, 128, 300, 200)
    const main = fakeWindow('main', 100, 100, 800, 600)
    main.isVisible.mockResolvedValue(false)

    await dockAfterMoved([self, main])

    expect(mocks.invoke).not.toHaveBeenCalled()
  })

  it('shows the dock hint as soon as the title bar is over the tab bar', async () => {
    const self = fakeWindow('tab-tab-1', 150, 128, 300, 200)
    const main = fakeWindow('main', 100, 100, 800, 600)
    const onHintChange = vi.fn()
    const { move, dispose } = await setupMoved([self, main], { onHintChange })

    vi.useFakeTimers()
    move()
    await vi.advanceTimersByTimeAsync(100)

    expect(onHintChange).toHaveBeenLastCalledWith(true)
    // The move has not settled yet, so no recall.
    expect(mocks.invoke).not.toHaveBeenCalled()

    dispose()
    vi.useRealTimers()
  })

  it('clears the dock hint when the title bar moves away', async () => {
    let y = 128
    const self = fakeWindow('tab-tab-1', 150, y, 300, 200)
    self.outerPosition.mockImplementation(async () => ({ x: 150, y }))
    self.innerPosition.mockImplementation(async () => ({ x: 150, y: y + 28 }))
    const main = fakeWindow('main', 100, 100, 800, 600)
    const onHintChange = vi.fn()
    const { move, dispose } = await setupMoved([self, main], { onHintChange })

    vi.useFakeTimers()
    move()
    await vi.advanceTimersByTimeAsync(100)
    expect(onHintChange).toHaveBeenLastCalledWith(true)

    y = 300
    move()
    await vi.advanceTimersByTimeAsync(100)
    expect(onHintChange).toHaveBeenLastCalledWith(false)

    dispose()
    vi.useRealTimers()
  })

  it('does not show the dock hint when the main window is hidden', async () => {
    const self = fakeWindow('tab-tab-1', 150, 128, 300, 200)
    const main = fakeWindow('main', 100, 100, 800, 600)
    main.isVisible.mockResolvedValue(false)
    const onHintChange = vi.fn()
    const { move, dispose } = await setupMoved([self, main], { onHintChange })

    vi.useFakeTimers()
    move()
    await vi.advanceTimersByTimeAsync(100)

    expect(onHintChange).not.toHaveBeenCalled()
    dispose()
    vi.useRealTimers()
  })

  it('is a no-op outside the desktop app', async () => {
    mocks.tauri = false
    installTauri([])

    const dispose = useDetachedWindowDock('tab-1')
    dispose()

    expect(mocks.invoke).not.toHaveBeenCalled()
  })
})
