import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTerminalWheel, type WheelHost } from '../useTerminalWheel'

function createFakeXterm(
  options: { viewportY?: number; baseY?: number; type?: 'normal' | 'alternate' } = {}
) {
  const active = {
    viewportY: options.viewportY ?? 0,
    baseY: options.baseY ?? 0,
    type: options.type ?? 'normal',
  }
  let wheelHandler: ((e: WheelEvent) => boolean) | null = null
  const xterm = {
    buffer: { active },
    element: document.createElement('div'),
    attachCustomWheelEventHandler: vi.fn((h: (e: WheelEvent) => boolean) => {
      wheelHandler = h
    }),
  } as any
  return {
    xterm,
    active,
    fireWheel: (e: Partial<WheelEvent>) => {
      if (!wheelHandler) throw new Error('wheel handler not attached')
      const ev = {
        deltaY: 0,
        deltaX: 0,
        deltaMode: 0,
        shiftKey: false,
        ctrlKey: false,
        altKey: false,
        metaKey: false,
        clientX: 0,
        clientY: 0,
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
        ...e,
      } as WheelEvent
      return wheelHandler(ev)
    },
  }
}

function createHost(xterm: any) {
  const state = { pinned: true }
  const host: WheelHost = {
    getXterm: () => xterm,
    isMouseModeEnabled: () => false,
    getWritePinnedToBottom: () => state.pinned,
    setWritePinnedToBottom: (v: boolean) => {
      state.pinned = v
    },
  }
  return { host, state }
}

describe('terminal wheel un-pin semantics (issue #268)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('wheel-up while viewport is already at bottom must NOT un-pin (no scrollback revealed)', () => {
    // viewportY === baseY: the terminal is showing the live tail; an upward
    // wheel tick (e.g. stray trackpad inertia) cannot reveal any history.
    const fake = createFakeXterm({ viewportY: 40, baseY: 40 })
    const { host, state } = createHost(fake.xterm)
    const wheel = createTerminalWheel(host)
    wheel.setup()

    fake.fireWheel({ deltaY: -5 })
    fake.fireWheel({ deltaY: -5 })

    expect(state.pinned).toBe(true)
    wheel.cleanup()
  })

  it('wheel-up with history above un-pins (deliberate scroll-up still works)', () => {
    const fake = createFakeXterm({ viewportY: 10, baseY: 40 })
    const { host, state } = createHost(fake.xterm)
    const wheel = createTerminalWheel(host)
    wheel.setup()

    fake.fireWheel({ deltaY: -5 })
    fake.fireWheel({ deltaY: -5 })

    expect(state.pinned).toBe(false)
    wheel.cleanup()
  })

  it('wheel-down back to the bottom re-pins', () => {
    const fake = createFakeXterm({ viewportY: 10, baseY: 40 })
    const { host, state } = createHost(fake.xterm)
    const wheel = createTerminalWheel(host)
    wheel.setup()

    fake.fireWheel({ deltaY: -5 })
    fake.fireWheel({ deltaY: -5 })
    expect(state.pinned).toBe(false)

    fake.active.viewportY = 40
    fake.fireWheel({ deltaY: 5 })

    expect(state.pinned).toBe(true)
    wheel.cleanup()
  })
})
