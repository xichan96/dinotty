import { reactive } from 'vue'
import type { Terminal as XTerm } from '@xterm/xterm'

export interface ScrollPositionState {
  viewportY: number
  baseY: number
  length: number
  rows: number
  atBottom: boolean
  isAltScreen: boolean
}

export interface ScrollPositionHandle {
  state: ScrollPositionState
  kick(): void
  dispose(): void
}

interface DisposableLike {
  dispose(): void
}

interface NumericScrollPosition {
  viewportY: number
  baseY: number
  length: number
  rows: number
}

const IDLE_FRAME_LIMIT = 8

function samePosition(a: NumericScrollPosition, b: NumericScrollPosition): boolean {
  return (
    a.viewportY === b.viewportY &&
    a.baseY === b.baseY &&
    a.length === b.length &&
    a.rows === b.rows
  )
}

/**
 * Must be called after `xterm.open()` has created `xterm.element`.
 * DOM listeners bind once at construction time and are not re-bound if the element appears later.
 */
export function useScrollPosition(xterm: XTerm): ScrollPositionHandle {
  const state = reactive<ScrollPositionState>({
    viewportY: 0,
    baseY: 0,
    length: 0,
    rows: 0,
    atBottom: true,
    isAltScreen: false,
  })

  const disposables: DisposableLike[] = []
  const element = xterm.element
  let disposed = false
  let polling = false
  let pendingFrame: number | null = null
  let idleFrameCount = 0
  let lastFramePosition: NumericScrollPosition | null = null

  const readPosition = (): NumericScrollPosition | null => {
    if (disposed) return null

    try {
      const buffer = xterm.buffer.active
      const position = {
        viewportY: buffer.viewportY,
        baseY: buffer.baseY,
        length: buffer.length,
        rows: xterm.rows,
      }

      state.viewportY = position.viewportY
      state.baseY = position.baseY
      state.length = position.length
      state.rows = position.rows
      state.atBottom = position.baseY - position.viewportY <= 1
      state.isAltScreen = buffer.type === 'alternate' // Reported for consumers; F2/F3 gate on !isAltScreen, this observer does not self-gate.

      return position
    } catch {
      return null
    }
  }

  const scheduleFrame = () => {
    if (disposed || pendingFrame !== null) return
    pendingFrame = requestAnimationFrame(() => {
      pendingFrame = null
      if (disposed || !polling) return

      const position = readPosition()
      if (position && (!lastFramePosition || !samePosition(position, lastFramePosition))) {
        idleFrameCount = 0
        lastFramePosition = position
      } else {
        idleFrameCount += 1
      }

      if (idleFrameCount >= IDLE_FRAME_LIMIT) {
        polling = false
        // Stopping on idle alone is safe because every real change source re-arms via kick().
        readPosition()
        return
      }

      scheduleFrame()
    })
  }

  const kick = () => {
    if (disposed) return
    polling = true
    idleFrameCount = 0
    scheduleFrame()
  }

  const dispose = () => {
    if (disposed) return
    disposed = true
    polling = false

    if (pendingFrame !== null) {
      cancelAnimationFrame(pendingFrame)
      pendingFrame = null
    }

    for (const disposable of disposables) {
      disposable.dispose()
    }

    if (element) {
      element.removeEventListener('wheel', kick)
      element.removeEventListener('touchmove', kick)
      element.removeEventListener('scroll', kick, { capture: true })
    }
  }

  readPosition()

  disposables.push(
    xterm.onRender(() => kick()),
    xterm.onScroll(() => kick()),
    xterm.buffer.onBufferChange(() => {
      readPosition()
      kick()
    })
  )

  if (element) {
    element.addEventListener('wheel', kick, { passive: true })
    element.addEventListener('touchmove', kick, { passive: true })
    element.addEventListener('scroll', kick, { capture: true, passive: true })
  }

  return {
    state,
    kick,
    dispose,
  }
}
