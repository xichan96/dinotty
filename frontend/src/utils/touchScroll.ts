import type { Terminal } from '@xterm/xterm'

/**
 * Touch-to-wheel translation for mobile terminal scrolling.
 *
 * Attaches touch/wheel listeners to the terminal wrapper and converts vertical
 * drag gestures into synthetic WheelEvents on the xterm element, letting xterm.js
 * route them through its own pipeline (mouse tracking / alt-screen arrows /
 * viewport scroll). Includes momentum/inertia after lift.
 *
 * Listeners must go on the wrapper, not .xterm-viewport: the xterm canvas
 * (.xterm-screen) sits above the viewport and intercepts all touch events.
 */
export function setupTouchScroll(
  wrapper: HTMLElement,
  opts: {
    getXterm: () => Terminal | null
    isInTouchSelection: () => boolean
    setTouchMoved: (v: boolean) => void
    sendWheelEvent?: (deltaY: number, clientX: number, clientY: number) => void
  },
): () => void {
  const { getXterm, isInTouchSelection, setTouchMoved } = opts

  // Prevent native browser scroll on the wrapper from conflicting with our
  // custom touch-to-wheel translation.
  wrapper.style.touchAction = 'none'

  let startX = 0
  let startY = 0
  let lastY = 0
  let lastTime = 0
  let accumulatedDeltaY = 0
  let velocity = 0
  let momentumId = 0
  let mode: 'undecided' | 'scroll' | 'select' = 'undecided'
  let scrollEventFired = false
  const THRESHOLD = 10
  const SCROLL_THRESHOLD = 12 // Lower threshold for more responsive feel

  const clearMomentum = () => {
    if (momentumId) {
      cancelAnimationFrame(momentumId)
      momentumId = 0
    }
  }

  // Always dispatch a synthetic WheelEvent on the xterm element and let xterm.js
  // handle it through its own event pipeline. This matches how real desktop wheel
  // events are processed:
  //   - Mouse tracking active: xterm.js sends mouse report escape sequences to PTY
  //   - No scrollback (alt screen): xterm.js converts to Up/Down arrow sequences
  //   - Normal shell with scrollback: xterm.js scrolls the viewport
  // Previously the no-mouse-tracking path called scrollLines() directly, which only
  // moves xterm's internal viewport - it never sends data to the PTY. On the alt
  // screen (no scrollback) this was a no-op, so TUI apps like opencode never
  // received scroll input on mobile.
  const sendWheelEvent =
    opts.sendWheelEvent ?? ((deltaY: number, clientX: number, clientY: number) => {
    const xterm = getXterm()
    if (!xterm || deltaY === 0) return
    const xtermEl = xterm.element
    if (xtermEl) {
      xtermEl.dispatchEvent(
        new WheelEvent('wheel', {
          deltaY,
          deltaX: 0,
          deltaZ: 0,
          deltaMode: 0,
          bubbles: true,
          cancelable: true,
          clientX,
          clientY,
        }),
      )
    }
    })

  const onTouchStart = (e: TouchEvent) => {
    clearMomentum()
    setTouchMoved(false)
    scrollEventFired = false
    startX = e.touches[0].clientX
    startY = e.touches[0].clientY
    lastY = startY
    lastTime = Date.now()
    accumulatedDeltaY = 0
    velocity = 0
    mode = 'undecided'
  }

  const onTouchMove = (e: TouchEvent) => {
    if (isInTouchSelection()) return
    const cx = e.touches[0].clientX
    const cy = e.touches[0].clientY
    const now = Date.now()
    if (mode === 'undecided') {
      const dx = Math.abs(cx - startX)
      const dy = Math.abs(cy - startY)
      if (dy > THRESHOLD || dx > THRESHOLD) {
        mode = dy > dx ? 'scroll' : 'select'
        if (mode === 'scroll') setTouchMoved(true)
      } else {
        return
      }
    }
    if (mode === 'scroll') {
      e.preventDefault() // suppress native scroll - safe because passive: false
      // Fire terminal-scroll on first scroll movement to collapse virtual keyboard
      if (!scrollEventFired) {
        scrollEventFired = true
        wrapper.dispatchEvent(new CustomEvent('terminal-scroll', { bubbles: true }))
      }
      const deltaY = lastY - cy
      const dt = now - lastTime || 1
      velocity = deltaY / dt // px/ms
      accumulatedDeltaY += deltaY

      if (getXterm() && Math.abs(accumulatedDeltaY) >= SCROLL_THRESHOLD) {
        sendWheelEvent(accumulatedDeltaY, cx, cy)
        accumulatedDeltaY = 0
      }
    }
    lastY = cy
    lastTime = now
  }

  const onTouchEnd = () => {
    if (mode !== 'scroll') return
    // Flush remaining delta
    if (getXterm() && Math.abs(accumulatedDeltaY) > 2) {
      sendWheelEvent(accumulatedDeltaY, lastY, lastY)
    }
    accumulatedDeltaY = 0

    // Momentum: keep sending wheel events with decaying velocity
    if (getXterm() && Math.abs(velocity) > 0.15) {
      const friction = 0.92
      let v = velocity
      const step = () => {
        v *= friction
        if (Math.abs(v) < 0.05) return
        const delta = v * 16 // ~1 frame at 60fps
        sendWheelEvent(delta, lastY, lastY)
        momentumId = requestAnimationFrame(step)
      }
      momentumId = requestAnimationFrame(step)
    }

    // Notify that a scroll gesture ended - used to dismiss the virtual keyboard.
    wrapper.dispatchEvent(new CustomEvent('terminal-scroll', { bubbles: true }))
  }

  wrapper.addEventListener('touchstart', onTouchStart, { passive: true })
  wrapper.addEventListener('touchmove', onTouchMove, { passive: false })
  wrapper.addEventListener('touchend', onTouchEnd, { passive: true })
  // Wheel listener: collapse virtual keyboard on trackpad/mouse scroll
  const onWheel = () => {
    wrapper.dispatchEvent(new CustomEvent('terminal-scroll', { bubbles: true }))
  }
  wrapper.addEventListener('wheel', onWheel, { passive: true })

  return () => {
    clearMomentum()
    wrapper.removeEventListener('touchstart', onTouchStart)
    wrapper.removeEventListener('touchmove', onTouchMove)
    wrapper.removeEventListener('touchend', onTouchEnd)
    wrapper.removeEventListener('wheel', onWheel)
  }
}
