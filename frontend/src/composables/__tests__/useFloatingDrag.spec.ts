import { describe, it, expect, vi } from 'vitest'
import { ref } from 'vue'
import { useFloatingDrag, type FloatingDrag } from '../useFloatingDrag'

const raf = () => new Promise((r) => requestAnimationFrame(r))

function makeSurface() {
  return {
    offsetWidth: 100,
    offsetHeight: 50,
    setPointerCapture: vi.fn(),
    releasePointerCapture: vi.fn(),
  } as unknown as HTMLElement
}

function pointerDown(over: Partial<PointerEvent> = {}) {
  return {
    button: 0,
    pointerId: 1,
    clientX: 0,
    clientY: 0,
    currentTarget: null as unknown as HTMLElement,
    ...over,
  } as unknown as PointerEvent
}

function pointerMove(x: number, y: number, pointerId = 1) {
  window.dispatchEvent(new PointerEvent('pointermove', { clientX: x, clientY: y, pointerId }))
}

function pointerEnd(type: 'pointerup' | 'pointercancel', pointerId = 1) {
  window.dispatchEvent(new PointerEvent(type, { pointerId }))
}

function setup(drag: FloatingDrag, surface: HTMLElement) {
  drag.mount()
  drag.onPointerDown(pointerDown({ pointerId: 1, clientX: 0, clientY: 0, currentTarget: surface }))
}

describe('useFloatingDrag', () => {
  it('a tap (< threshold) does not persist and does not suppress the click', async () => {
    const persist = vi.fn()
    const surface = makeSurface()
    const drag = useFloatingDrag({
      element: ref(surface),
      initialPosition: () => ({ x: 0, y: 0 }),
      persist,
    })
    setup(drag, surface)
    pointerEnd('pointerup')
    expect(drag.dragging.value).toBe(false)
    expect(persist).not.toHaveBeenCalled()
    const click = { preventDefault: vi.fn(), stopPropagation: vi.fn() } as unknown as MouseEvent
    drag.onSurfaceClick(click)
    expect(click.preventDefault).not.toHaveBeenCalled()
    expect(click.stopPropagation).not.toHaveBeenCalled()
  })

  it('a drag (>= threshold) persists, fires onDragEnd and suppresses the following click', async () => {
    const persist = vi.fn()
    const onDragEnd = vi.fn()
    const surface = makeSurface()
    const drag = useFloatingDrag({
      element: ref(surface),
      initialPosition: () => ({ x: 0, y: 0 }),
      persist,
      onDragEnd,
    })
    setup(drag, surface)
    pointerMove(50, 0)
    await raf()
    pointerEnd('pointerup')
    expect(drag.dragging.value).toBe(false)
    expect(persist).toHaveBeenCalledWith(50, 0)
    expect(onDragEnd).toHaveBeenCalled()
    expect(surface.releasePointerCapture).toHaveBeenCalledWith(1)
    const click = { preventDefault: vi.fn(), stopPropagation: vi.fn() } as unknown as MouseEvent
    drag.onSurfaceClick(click)
    expect(click.preventDefault).toHaveBeenCalled()
    expect(click.stopPropagation).toHaveBeenCalled()
  })

  it('clamps y against safeBottom', async () => {
    const persist = vi.fn()
    const surface = makeSurface()
    const drag = useFloatingDrag({
      element: ref(surface),
      initialPosition: () => ({ x: 0, y: 0 }),
      persist,
      safeBottom: () => 200,
    })
    setup(drag, surface)
    pointerMove(0, 5000)
    await raf()
    pointerEnd('pointerup')
    expect(drag.y.value).toBe(window.innerHeight - 50 - 200)
  })

  it('a pointercancel resets the drag, releases capture and does not persist', async () => {
    const persist = vi.fn()
    const surface = makeSurface()
    const drag = useFloatingDrag({
      element: ref(surface),
      initialPosition: () => ({ x: 0, y: 0 }),
      persist,
    })
    setup(drag, surface)
    pointerMove(80, 0)
    await raf()
    pointerEnd('pointercancel')
    expect(drag.dragging.value).toBe(false)
    expect(persist).not.toHaveBeenCalled()
    expect(surface.releasePointerCapture).toHaveBeenCalledWith(1)
  })

  it('reClamp on mount pulls out-of-bounds initial position into the safe area', () => {
    const surface = makeSurface()
    const drag = useFloatingDrag({
      element: ref(surface),
      initialPosition: () => ({ x: 2000, y: -50 }),
    })
    drag.mount()
    expect(drag.x.value).toBe(window.innerWidth - 100)
    expect(drag.y.value).toBe(0)
  })

  it('coalesces pointer moves within a frame into a single rAF write', async () => {
    const rafSpy = vi.spyOn(window, 'requestAnimationFrame')
    try {
      const surface = makeSurface()
      const drag = useFloatingDrag({
        element: ref(surface),
        initialPosition: () => ({ x: 0, y: 0 }),
      })
      drag.mount()
      rafSpy.mockClear()
      setup(drag, surface)
      pointerMove(10, 0)
      pointerMove(20, 0)
      pointerMove(30, 0)
      expect(rafSpy).toHaveBeenCalledTimes(1)
      await raf()
      pointerEnd('pointerup')
      expect(drag.x.value).toBe(30)
    } finally {
      rafSpy.mockRestore()
    }
  })

  it('ignores a non-primary button and a second pointer while dragging', async () => {
    const surface = makeSurface()
    const drag = useFloatingDrag({
      element: ref(surface),
      initialPosition: () => ({ x: 0, y: 0 }),
    })
    drag.mount()
    drag.onPointerDown(pointerDown({ button: 2, pointerId: 9, currentTarget: surface }))
    expect(drag.dragging.value).toBe(false)
    drag.onPointerDown(pointerDown({ pointerId: 1, currentTarget: surface }))
    drag.onPointerDown(pointerDown({ pointerId: 2, currentTarget: surface }))
    expect(surface.setPointerCapture).toHaveBeenCalledTimes(1)
    expect(drag.dragging.value).toBe(true)
  })

  describe('hold-to-drag', () => {
    const hold = () => new Promise((r) => setTimeout(r, 30))

    it('stays inert during the hold, then enters drag and persists after the delay', async () => {
      const persist = vi.fn()
      const surface = makeSurface()
      const drag = useFloatingDrag({
        element: ref(surface),
        initialPosition: () => ({ x: 0, y: 0 }),
        persist,
        holdToDrag: true,
        holdDelayMs: 5,
      })
      drag.mount()
      drag.onPointerDown(
        pointerDown({ pointerId: 1, clientX: 0, clientY: 0, currentTarget: surface })
      )
      expect(drag.dragging.value).toBe(false)
      expect(surface.setPointerCapture).not.toHaveBeenCalled()
      await hold()
      expect(drag.dragging.value).toBe(true)
      expect(surface.setPointerCapture).toHaveBeenCalledWith(1)
      pointerMove(50, 0)
      await raf()
      pointerEnd('pointerup')
      expect(persist).toHaveBeenCalledWith(50, 0)
    })

    it('movement before the hold cancels and passes through without dragging', async () => {
      const persist = vi.fn()
      const surface = makeSurface()
      const drag = useFloatingDrag({
        element: ref(surface),
        initialPosition: () => ({ x: 0, y: 0 }),
        persist,
        holdToDrag: true,
        holdDelayMs: 1000,
      })
      drag.mount()
      drag.onPointerDown(
        pointerDown({ pointerId: 1, clientX: 0, clientY: 0, currentTarget: surface })
      )
      pointerMove(10, 0) // >= DRAG_THRESHOLD: cancels the hold, releases to content
      await hold()
      expect(drag.dragging.value).toBe(false)
      expect(surface.setPointerCapture).not.toHaveBeenCalled()
      pointerEnd('pointerup')
      expect(persist).not.toHaveBeenCalled()
    })

    it('release before the hold is a click (no capture, no persist, click not suppressed)', async () => {
      const persist = vi.fn()
      const surface = makeSurface()
      const drag = useFloatingDrag({
        element: ref(surface),
        initialPosition: () => ({ x: 0, y: 0 }),
        persist,
        holdToDrag: true,
        holdDelayMs: 1000,
      })
      drag.mount()
      drag.onPointerDown(
        pointerDown({ pointerId: 1, clientX: 0, clientY: 0, currentTarget: surface })
      )
      pointerEnd('pointerup')
      expect(drag.dragging.value).toBe(false)
      expect(surface.setPointerCapture).not.toHaveBeenCalled()
      expect(persist).not.toHaveBeenCalled()
      const click = { preventDefault: vi.fn(), stopPropagation: vi.fn() } as unknown as MouseEvent
      drag.onSurfaceClick(click)
      expect(click.preventDefault).not.toHaveBeenCalled()
      expect(click.stopPropagation).not.toHaveBeenCalled()
    })

    it('resolves a holdToDrag getter at pointerdown (true → hold path)', async () => {
      const surface = makeSurface()
      const drag = useFloatingDrag({
        element: ref(surface),
        initialPosition: () => ({ x: 0, y: 0 }),
        holdToDrag: () => true,
        holdDelayMs: 5,
      })
      drag.mount()
      drag.onPointerDown(
        pointerDown({ pointerId: 1, clientX: 0, clientY: 0, currentTarget: surface })
      )
      expect(drag.dragging.value).toBe(false)
      expect(surface.setPointerCapture).not.toHaveBeenCalled()
      await hold()
      expect(drag.dragging.value).toBe(true)
      pointerEnd('pointerup')
    })

    it('resolves a holdToDrag getter at pointerdown (false → immediate drag)', async () => {
      const surface = makeSurface()
      const drag = useFloatingDrag({
        element: ref(surface),
        initialPosition: () => ({ x: 0, y: 0 }),
        holdToDrag: () => false,
      })
      drag.mount()
      drag.onPointerDown(
        pointerDown({ pointerId: 1, clientX: 0, clientY: 0, currentTarget: surface })
      )
      expect(drag.dragging.value).toBe(true)
      expect(surface.setPointerCapture).toHaveBeenCalled()
      pointerEnd('pointerup')
    })
  })
})
