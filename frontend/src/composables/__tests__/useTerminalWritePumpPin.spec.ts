import { afterEach, describe, expect, it, vi } from 'vitest'
import { TerminalInstance } from '../useTerminal'
import { createTerminalWheel, type WheelHost } from '../useTerminalWheel'

function createMinimalXterm(options: { viewportY?: number; baseY?: number } = {}) {
  const active = {
    viewportY: options.viewportY ?? 0,
    baseY: options.baseY ?? 0,
  }
  const xterm = {
    buffer: { active },
    write: (_data: string, cb?: () => void) => {
      cb?.()
    },
    scrollToBottom: vi.fn(),
  } as any
  return { xterm, active }
}

function primePump(inst: TerminalInstance, xterm: any, pinned: boolean) {
  ;(inst as any).xterm = xterm
  ;(inst as any)._writePinnedToBottom = pinned
}

describe('write pump viewport self-heal (issue #268)', () => {
  it('re-pins when unpinned but the viewport is back at the bottom', () => {
    const inst = new TerminalInstance('pane-1')
    // Un-pinned (e.g. user scrolled up earlier) but the view has since
    // returned to ybase - the stream must resume following the tail.
    const { xterm } = createMinimalXterm({ viewportY: 40, baseY: 40 })
    primePump(inst, xterm, false)
    ;(inst as any)._enqueueWrite('hello world\n')

    expect(xterm.scrollToBottom).toHaveBeenCalled()
    expect((inst as any)._writePinnedToBottom).toBe(true)
  })

  it('stays unpinned while the viewport is above the bottom (scrollback reading)', () => {
    const inst = new TerminalInstance('pane-2')
    const { xterm } = createMinimalXterm({ viewportY: 10, baseY: 40 })
    primePump(inst, xterm, false)
    ;(inst as any)._enqueueWrite('hello world\n')

    expect(xterm.scrollToBottom).not.toHaveBeenCalled()
    expect((inst as any)._writePinnedToBottom).toBe(false)
  })
})

// ── Streaming simulation: real write pump (rAF-yielded batches) + real wheel
// handler + modeled scrollback growth, exercising the issue #268 timeline.
describe('heavy-output stream + wheel interleaving (issue #268 simulation)', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const LINES_PER_CHUNK = 10

  function createStreamingXterm() {
    const active = { viewportY: 0, baseY: 0 }
    let wheelHandler: ((e: WheelEvent) => boolean) | null = null
    const scrollToBottom = vi.fn(() => {
      active.viewportY = active.baseY
    })
    const xterm = {
      buffer: { active },
      element: document.createElement('div'),
      attachCustomWheelEventHandler: (h: (e: WheelEvent) => boolean) => {
        wheelHandler = h
      },
      // Model scrollback growth: every written newline pushes baseY down.
      // When the viewport is at the bottom (xterm isUserScrolling=false)
      // xterm auto-follows the growth; when the user is scrolled up,
      // viewportY stays put while baseY grows.
      write: (data: string, cb?: () => void) => {
        const lines = (data.match(/\n/g) ?? []).length
        if (active.viewportY >= active.baseY) active.viewportY += lines
        active.baseY += lines
        cb?.()
      },
      scrollToBottom,
    } as any
    const fireWheel = (deltaY: number) => {
      if (!wheelHandler) throw new Error('wheel handler not attached')
      wheelHandler({
        deltaY,
        deltaX: 0,
        deltaMode: 0,
        shiftKey: false,
        ctrlKey: false,
        altKey: false,
        metaKey: false,
        clientX: 0,
        clientY: 0,
        preventDefault: () => {},
        stopPropagation: () => {},
      } as WheelEvent)
    }
    return { xterm, active, scrollToBottom, fireWheel }
  }

  function stubRaf() {
    const queue: FrameRequestCallback[] = []
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      queue.push(cb)
      return queue.length
    })
    return () => {
      // Pump re-arms rAF between batches; drain until quiescent.
      for (let i = 0; queue.length > 0 && i < 100; i++) {
        const batch = queue.splice(0, queue.length)
        batch.forEach((cb) => cb(0))
      }
    }
  }

  function attachWheel(inst: TerminalInstance, xterm: any) {
    const host: WheelHost = {
      getXterm: () => xterm,
      isMouseModeEnabled: () => false,
      getWritePinnedToBottom: () => (inst as any)._writePinnedToBottom,
      setWritePinnedToBottom: (v: boolean) => {
        ;(inst as any)._writePinnedToBottom = v
      },
    }
    const wheel = createTerminalWheel(host)
    wheel.setup()
    return wheel
  }

  const chunk = () => `${'line\n'.repeat(LINES_PER_CHUNK)}`

  it('stray wheel-up ticks at the bottom do not detach the viewport mid-stream', () => {
    const flushRaf = stubRaf()
    const inst = new TerminalInstance('pane-stream-1')
    const ctx = createStreamingXterm()
    ;(inst as any).xterm = ctx.xterm
    const wheel = attachWheel(inst, ctx.xterm)

    // Kick the pump off with one chunk, then queue the burst behind it so
    // the pump is mid-stream (rAF-yielded between 4-chunk batches).
    ;(inst as any)._enqueueWrite(chunk())
    for (let i = 0; i < 24; i++) (inst as any)._enqueueWrite(chunk())

    // Mid-stream, at the bottom, two stray trackpad inertia ticks land
    // (accumulated |deltaY| = 10 > 8 threshold) with zero user intent.
    ctx.fireWheel(-5)
    ctx.fireWheel(-5)
    expect(ctx.active.viewportY).toBe(ctx.active.baseY) // still at bottom

    flushRaf()

    // The whole burst landed; the viewport must still be following the tail.
    expect(ctx.active.baseY).toBe(25 * LINES_PER_CHUNK)
    expect(ctx.active.viewportY).toBe(ctx.active.baseY)
    expect((inst as any)._writePinnedToBottom).toBe(true)
    wheel.cleanup()
  })

  it('deliberate scroll-up detaches, and scrolling back to the bottom self-heals', () => {
    const flushRaf = stubRaf()
    const inst = new TerminalInstance('pane-stream-2')
    const ctx = createStreamingXterm()
    ;(inst as any).xterm = ctx.xterm
    const wheel = attachWheel(inst, ctx.xterm)

    ;(inst as any)._enqueueWrite(chunk())
    for (let i = 0; i < 4; i++) (inst as any)._enqueueWrite(chunk())
    // Let the burst drain while following the tail.
    flushRaf()
    expect(ctx.active.viewportY).toBe(ctx.active.baseY)
    const followedBase = ctx.active.baseY

    // User scrolls up 20 lines to read history: view leaves the bottom,
    // then real wheel-ups land (this time they must un-pin).
    ctx.active.viewportY = ctx.active.baseY - 20
    ctx.fireWheel(-5)
    ctx.fireWheel(-5)
    expect((inst as any)._writePinnedToBottom).toBe(false)

    // More output streams in; the viewport must NOT be dragged down while
    // the user is reading.
    ctx.scrollToBottom.mockClear()
    ;(inst as any)._enqueueWrite(chunk())
    flushRaf()
    expect(ctx.scrollToBottom).not.toHaveBeenCalled()
    expect(ctx.active.viewportY).toBe(followedBase - 20)
    expect((inst as any)._writePinnedToBottom).toBe(false)

    // User drags the custom scrollbar back to the bottom (scrollToLine
    // path - no wheel event, previously the permanent-detach trap).
    ctx.active.viewportY = ctx.active.baseY
    ctx.scrollToBottom.mockClear()
    ;(inst as any)._enqueueWrite(chunk())
    flushRaf()

    expect(ctx.scrollToBottom).toHaveBeenCalled()
    expect((inst as any)._writePinnedToBottom).toBe(true)
    expect(ctx.active.viewportY).toBe(ctx.active.baseY)
    wheel.cleanup()
  })
})
