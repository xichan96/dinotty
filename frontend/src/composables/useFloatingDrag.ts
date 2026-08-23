import {
  computed,
  getCurrentInstance,
  onBeforeUnmount,
  onMounted,
  ref,
  type ComputedRef,
  type Ref,
} from 'vue'

/** Below this pointer travel a release counts as a click, not a drag. */
const DRAG_THRESHOLD = 4
/** Hold duration before a hold-to-drag surface arms its drag. */
const HOLD_DELAY_MS = 300
/** StatusBar.vue `.status-bar` height — the overlay layer never covers it. */
const STATUSBAR_HEIGHT = 24

export interface FloatingDragOptions {
  /** The positioned element (.overlay-item) — measured for clamp bounds. */
  element: Ref<HTMLElement | null>
  /** Starting position. Corner anchors are expressed as outside-viewport coords
   *  (e.g. bottom-right = {innerWidth, innerHeight}) that the first reClamp
   *  pulls into the safe area. */
  initialPosition: () => { x: number; y: number }
  /** Called when a real drag settles, with the clamped position. */
  persist?: (x: number, y: number) => void
  /** Bottom safe margin; default = status bar + max(--mkb-height, --sys-kb-height). */
  safeBottom?: () => number
  /** Called after a real drag settles (host focus restore). */
  onDragEnd?: () => void
  /** Strict hold-to-drag: only a hold (pointer still, no movement) past holdDelayMs
   *  enters drag; movement before the hold cancels and passes through to the widget's
   *  own gestures (grip fallback keeps its scroll). Release before the hold = click,
   *  no pointer capture was taken so it lands on the widget content. Default false.
   *  A getter is resolved at pointerdown so the surface can switch modes reactively. */
  holdToDrag?: boolean | (() => boolean)
  /** Hold duration before drag arms (holdToDrag only). Default HOLD_DELAY_MS. */
  holdDelayMs?: number
}

export interface FloatingDrag {
  x: Ref<number>
  y: Ref<number>
  dragging: Ref<boolean>
  style: ComputedRef<{ transform: string }>
  /** Bind to pointerdown on the drag surface (widget root in 'whole' mode, grip otherwise). */
  onPointerDown: (e: PointerEvent) => void
  /** Bind to click (capture) on the drag surface to suppress the post-drag synthetic click. */
  onSurfaceClick: (e: MouseEvent) => void
  /** Re-clamp the current position into the safe viewport area. */
  reClamp: () => void
  /** Initialize position + bind resize observers. Auto-called on mount in a component. */
  mount: () => void
  dispose: () => void
}

function defaultSafeBottom(): number {
  if (typeof document === 'undefined') return STATUSBAR_HEIGHT
  const cs = getComputedStyle(document.documentElement)
  const mkb = parseFloat(cs.getPropertyValue('--mkb-height')) || 0
  const sysKb = parseFloat(cs.getPropertyValue('--sys-kb-height')) || 0
  return STATUSBAR_HEIGHT + Math.max(mkb, sysKb)
}

export function useFloatingDrag(opts: FloatingDragOptions): FloatingDrag {
  const x = ref(0)
  const y = ref(0)
  const dragging = ref(false)

  let activePointerId: number | null = null
  let activeSurface: HTMLElement | null = null
  let startPointerX = 0
  let startPointerY = 0
  let startPosX = 0
  let startPosY = 0
  let dragMoved = false
  let suppressClick = false
  let pendingX = 0
  let pendingY = 0
  let rafHandle: number | null = null
  let holdTimer: number | null = null
  let resizeObserver: ResizeObserver | null = null
  let mounted = false

  const style = computed<{ transform: string }>(() => ({
    transform: `translate3d(${x.value}px, ${y.value}px, 0)`,
  }))

  function clamp(nx: number, ny: number): { x: number; y: number } {
    const el = opts.element.value
    const w = el?.offsetWidth ?? 0
    const h = el?.offsetHeight ?? 0
    const vw = window.innerWidth
    const vh = window.innerHeight
    const maxX = Math.max(0, vw - w)
    const maxY = Math.max(0, vh - h - (opts.safeBottom ? opts.safeBottom() : defaultSafeBottom()))
    return { x: Math.min(Math.max(nx, 0), maxX), y: Math.min(Math.max(ny, 0), maxY) }
  }

  function reClamp() {
    const c = clamp(x.value, y.value)
    x.value = c.x
    y.value = c.y
  }

  function onPointerMove(e: PointerEvent) {
    if (e.pointerId !== activePointerId) return
    const dx = e.clientX - startPointerX
    const dy = e.clientY - startPointerY
    if (!dragMoved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return
    dragMoved = true
    pendingX = startPosX + dx
    pendingY = startPosY + dy
    if (rafHandle == null) {
      rafHandle = requestAnimationFrame(() => {
        rafHandle = null
        const c = clamp(pendingX, pendingY)
        x.value = c.x
        y.value = c.y
      })
    }
  }

  function onVisibilityChange() {
    if (!document.hidden) return
    if (dragging.value) {
      finishDrag(true)
      return
    }
    // A pending hold dies with the tab; release everything without persisting.
    clearHoldTimer()
    removeHoldListeners()
    if (activePointerId !== null) {
      activePointerId = null
      activeSurface = null
    }
  }

  function clearHoldTimer() {
    if (holdTimer != null) {
      window.clearTimeout(holdTimer)
      holdTimer = null
    }
  }

  function removeHoldListeners() {
    window.removeEventListener('pointermove', onHoldMove)
    window.removeEventListener('pointerup', onHoldEnd)
    window.removeEventListener('pointercancel', onHoldEnd)
  }

  /** Hold phase observes movement only to bail; no capture is taken, so the
   *  widget's own gestures (scroll, etc.) keep receiving events untouched. */
  function onHoldMove(e: PointerEvent) {
    if (e.pointerId !== activePointerId) return
    const dx = e.clientX - startPointerX
    const dy = e.clientY - startPointerY
    if (Math.hypot(dx, dy) >= DRAG_THRESHOLD) {
      clearHoldTimer()
      removeHoldListeners()
      activePointerId = null
      activeSurface = null
    }
  }

  function onHoldEnd(e: PointerEvent) {
    if (e.pointerId !== activePointerId) return
    clearHoldTimer()
    removeHoldListeners()
    activePointerId = null
    activeSurface = null
    // No capture was taken: the native click lands on the widget content.
  }

  /** Start the real drag: take pointer capture, attach move/up/cancel listeners. */
  function enterDrag() {
    clearHoldTimer()
    removeHoldListeners()
    if (activePointerId === null || dragging.value) return
    dragging.value = true
    const surface = activeSurface
    if (surface) {
      try {
        surface.setPointerCapture(activePointerId)
      } catch {
        // happy-dom / non-pointer environments lack setPointerCapture
      }
    }
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
    window.addEventListener('pointercancel', onPointerCancel)
    document.addEventListener('visibilitychange', onVisibilityChange)
  }

  function finishDrag(cancelled: boolean) {
    if (activePointerId === null) return
    clearHoldTimer()
    const id = activePointerId
    const surface = activeSurface
    activePointerId = null
    activeSurface = null
    dragging.value = false
    if (rafHandle != null) {
      cancelAnimationFrame(rafHandle)
      rafHandle = null
    }
    window.removeEventListener('pointermove', onPointerMove)
    window.removeEventListener('pointerup', onPointerUp)
    window.removeEventListener('pointercancel', onPointerCancel)
    document.removeEventListener('visibilitychange', onVisibilityChange)
    removeHoldListeners()
    if (!cancelled && dragMoved) {
      suppressClick = true
      opts.persist?.(x.value, y.value)
      opts.onDragEnd?.()
    }
    if (surface) {
      try {
        surface.releasePointerCapture(id)
      } catch {
        // capture may already be released after pointercancel
      }
    }
  }

  function onPointerUp(e: PointerEvent) {
    if (e.pointerId !== activePointerId) return
    finishDrag(false)
  }

  function onPointerCancel(e: PointerEvent) {
    if (e.pointerId !== activePointerId) return
    finishDrag(true)
  }

  function onPointerDown(e: PointerEvent) {
    if (e.button !== 0 || activePointerId !== null) return
    suppressClick = false
    const surface = e.currentTarget as HTMLElement
    activePointerId = e.pointerId
    activeSurface = surface
    startPointerX = e.clientX
    startPointerY = e.clientY
    startPosX = x.value
    startPosY = y.value
    dragMoved = false
    const shouldHold = typeof opts.holdToDrag === 'function' ? opts.holdToDrag() : !!opts.holdToDrag
    if (shouldHold) {
      window.addEventListener('pointermove', onHoldMove)
      window.addEventListener('pointerup', onHoldEnd)
      window.addEventListener('pointercancel', onHoldEnd)
      holdTimer = window.setTimeout(enterDrag, opts.holdDelayMs ?? HOLD_DELAY_MS)
    } else {
      enterDrag()
    }
  }

  function onSurfaceClick(e: MouseEvent) {
    if (!suppressClick) return
    suppressClick = false
    e.preventDefault()
    e.stopPropagation()
  }

  function mount() {
    if (mounted) return
    mounted = true
    const init = opts.initialPosition()
    x.value = init.x
    y.value = init.y
    reClamp()
    const el = opts.element.value
    if (el && typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(reClamp)
      resizeObserver.observe(el)
    }
    window.addEventListener('resize', reClamp)
    window.visualViewport?.addEventListener('resize', reClamp)
    window.visualViewport?.addEventListener('scroll', reClamp)
  }

  function dispose() {
    mounted = false
    clearHoldTimer()
    removeHoldListeners()
    if (rafHandle != null) {
      cancelAnimationFrame(rafHandle)
      rafHandle = null
    }
    window.removeEventListener('pointermove', onPointerMove)
    window.removeEventListener('pointerup', onPointerUp)
    window.removeEventListener('pointercancel', onPointerCancel)
    document.removeEventListener('visibilitychange', onVisibilityChange)
    resizeObserver?.disconnect()
    resizeObserver = null
    window.removeEventListener('resize', reClamp)
    window.visualViewport?.removeEventListener('resize', reClamp)
    window.visualViewport?.removeEventListener('scroll', reClamp)
  }

  if (getCurrentInstance()) {
    onMounted(mount)
    onBeforeUnmount(dispose)
  }

  return { x, y, dragging, style, onPointerDown, onSurfaceClick, reClamp, mount, dispose }
}
