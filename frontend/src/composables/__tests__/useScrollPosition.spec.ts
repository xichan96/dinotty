import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Terminal as XTerm } from '@xterm/xterm'
import { useScrollPosition } from '../useScrollPosition'

type BufferType = 'normal' | 'alternate'

interface FakeActiveBuffer {
  viewportY: number
  baseY: number
  length: number
  type: BufferType
}

function createEmitter<T>() {
  const callbacks: Array<(event: T) => void> = []
  const dispose = vi.fn()

  return {
    event: vi.fn((callback: (event: T) => void) => {
      callbacks.push(callback)
      return { dispose }
    }),
    fire(event: T) {
      for (const callback of callbacks) {
        callback(event)
      }
    },
    dispose,
  }
}

function createFakeXTerm(options: {
  rows?: number
  viewportY?: number
  baseY?: number
  length?: number
  type?: BufferType
  element?: HTMLElement
} = {}) {
  const active: FakeActiveBuffer = {
    viewportY: options.viewportY ?? 0,
    baseY: options.baseY ?? 0,
    length: options.length ?? 100,
    type: options.type ?? 'normal',
  }
  const bufferChange = createEmitter<FakeActiveBuffer>()
  const scroll = createEmitter<number>()
  const render = createEmitter<{ start: number; end: number }>()
  const element = options.element ?? document.createElement('div')
  let readCount = 0
  let throwOnRead = false

  const xterm = {
    rows: options.rows ?? 24,
    buffer: {
      get active() {
        if (throwOnRead) throw new Error('xterm disposed')
        readCount += 1
        return active
      },
      onBufferChange: bufferChange.event,
    },
    onScroll: scroll.event,
    onRender: render.event,
    element,
  } as unknown as XTerm

  return {
    xterm,
    active,
    element,
    bufferChange,
    scroll,
    render,
    getReadCount: () => readCount,
    setThrowOnRead: (value: boolean) => {
      throwOnRead = value
    },
  }
}

let frameId = 0
let frameQueue: Array<{ id: number; callback: FrameRequestCallback }>

function stepFrame(): boolean {
  const frame = frameQueue.shift()
  if (!frame) return false
  frame.callback(performance.now())
  return true
}

function stepFrames(count: number) {
  for (let i = 0; i < count; i += 1) {
    stepFrame()
  }
}

describe('useScrollPosition', () => {
  beforeEach(() => {
    frameId = 0
    frameQueue = []
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn((callback: FrameRequestCallback) => {
        frameId += 1
        frameQueue.push({ id: frameId, callback })
        return frameId
      })
    )
    vi.stubGlobal(
      'cancelAnimationFrame',
      vi.fn((id: number) => {
        frameQueue = frameQueue.filter((frame) => frame.id !== id)
      })
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('populates the initial state and alternate-screen flag', () => {
    const fake = createFakeXTerm({
      rows: 30,
      viewportY: 8,
      baseY: 9,
      length: 120,
      type: 'alternate',
    })

    const handle = useScrollPosition(fake.xterm)

    expect(handle.state).toMatchObject({
      viewportY: 8,
      baseY: 9,
      length: 120,
      rows: 30,
      atBottom: true,
      isAltScreen: true,
    })

    handle.dispose()
  })

  it('uses one-row hysteresis for atBottom', () => {
    const diffOne = useScrollPosition(createFakeXTerm({ viewportY: 9, baseY: 10 }).xterm)
    const diffTwo = useScrollPosition(createFakeXTerm({ viewportY: 8, baseY: 10 }).xterm)
    const diffZero = useScrollPosition(createFakeXTerm({ viewportY: 10, baseY: 10 }).xterm)

    expect(diffOne.state.atBottom).toBe(true)
    expect(diffTwo.state.atBottom).toBe(false)
    expect(diffZero.state.atBottom).toBe(true)

    diffOne.dispose()
    diffTwo.dispose()
    diffZero.dispose()
  })

  it('flips isAltScreen on buffer change without a manual kick', () => {
    const fake = createFakeXTerm({ type: 'normal' })
    const handle = useScrollPosition(fake.xterm)

    expect(handle.state.isAltScreen).toBe(false)

    fake.active.type = 'alternate'
    fake.bufferChange.fire(fake.active)

    expect(handle.state.isAltScreen).toBe(true)

    handle.dispose()
  })

  it('polls after kick, updates changing positions, and stops after idle frames', () => {
    const fake = createFakeXTerm({ viewportY: 0, baseY: 0, length: 100, rows: 24 })
    const handle = useScrollPosition(fake.xterm)

    handle.kick()
    expect(frameQueue).toHaveLength(1)

    fake.active.viewportY = 3
    stepFrame()
    expect(handle.state.viewportY).toBe(3)
    expect(frameQueue).toHaveLength(1)

    fake.active.baseY = 10
    stepFrame()
    expect(handle.state.baseY).toBe(10)
    expect(frameQueue).toHaveLength(1)

    stepFrames(8)

    expect(frameQueue).toHaveLength(0)
    expect(requestAnimationFrame).toHaveBeenCalledTimes(10)
    expect(stepFrame()).toBe(false)

    handle.dispose()
  })

  it('disposes xterm listeners, DOM listeners, and pending frames idempotently', () => {
    const fake = createFakeXTerm()
    const addEventListener = vi.spyOn(fake.element, 'addEventListener')
    const removeEventListener = vi.spyOn(fake.element, 'removeEventListener')
    const handle = useScrollPosition(fake.xterm)

    expect(addEventListener).toHaveBeenCalledWith('wheel', expect.any(Function), { passive: true })
    expect(addEventListener).toHaveBeenCalledWith('touchmove', expect.any(Function), { passive: true })
    expect(addEventListener).toHaveBeenCalledWith('scroll', expect.any(Function), {
      capture: true,
      passive: true,
    })

    handle.kick()
    const queuedCallback = frameQueue[0].callback
    const readCountBeforeDispose = fake.getReadCount()

    handle.dispose()

    expect(cancelAnimationFrame).toHaveBeenCalledTimes(1)
    expect(fake.render.dispose).toHaveBeenCalledTimes(1)
    expect(fake.scroll.dispose).toHaveBeenCalledTimes(1)
    expect(fake.bufferChange.dispose).toHaveBeenCalledTimes(1)
    expect(removeEventListener).toHaveBeenCalledWith('wheel', expect.any(Function))
    expect(removeEventListener).toHaveBeenCalledWith('touchmove', expect.any(Function))
    expect(removeEventListener).toHaveBeenCalledWith('scroll', expect.any(Function), {
      capture: true,
    })
    expect(removeEventListener).toHaveBeenCalledTimes(3)

    fake.setThrowOnRead(true)
    expect(() => queuedCallback(performance.now())).not.toThrow()
    expect(fake.getReadCount()).toBe(readCountBeforeDispose)

    handle.dispose()

    expect(fake.render.dispose).toHaveBeenCalledTimes(1)
    expect(fake.scroll.dispose).toHaveBeenCalledTimes(1)
    expect(fake.bufferChange.dispose).toHaveBeenCalledTimes(1)
    expect(removeEventListener).toHaveBeenCalledTimes(3)

    handle.kick()

    expect(frameQueue).toHaveLength(0)
    expect(requestAnimationFrame).toHaveBeenCalledTimes(1)
  })

  it('re-arms polling from real wheel and scroll DOM events after idle', () => {
    const element = document.createElement('div')
    const fake = createFakeXTerm({ element })
    const handle = useScrollPosition(fake.xterm)

    handle.kick()
    while (stepFrame()) {
      // Drain queued animation frames until polling becomes idle.
    }

    expect(frameQueue).toHaveLength(0)

    element.dispatchEvent(new Event('wheel'))

    expect(frameQueue).toHaveLength(1)

    while (stepFrame()) {
      // Drain the polling frames re-armed by the wheel event.
    }

    element.dispatchEvent(new Event('scroll'))

    expect(frameQueue).toHaveLength(1)

    handle.dispose()
  })

  it('keeps two handles independent', () => {
    const first = createFakeXTerm({ viewportY: 1, baseY: 1, rows: 20 })
    const second = createFakeXTerm({ viewportY: 5, baseY: 5, rows: 40 })
    const firstHandle = useScrollPosition(first.xterm)
    const secondHandle = useScrollPosition(second.xterm)

    first.active.viewportY = 7
    first.render.fire({ start: 0, end: 1 })
    stepFrame()

    expect(firstHandle.state.viewportY).toBe(7)
    expect(secondHandle.state.viewportY).toBe(5)

    second.active.type = 'alternate'
    second.active.baseY = 8
    second.bufferChange.fire(second.active)

    expect(secondHandle.state.baseY).toBe(8)
    expect(secondHandle.state.isAltScreen).toBe(true)
    expect(firstHandle.state.baseY).toBe(1)
    expect(firstHandle.state.isAltScreen).toBe(false)

    firstHandle.dispose()
    secondHandle.dispose()
  })
})
