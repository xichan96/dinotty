import { getCurrentInstance, onBeforeUnmount, onMounted, ref, type Ref } from 'vue'

const DEFAULT_MIN = { w: 380, h: 300 }

export interface WindowResizeOptions {
  /** Window size, mutated (clamped) in place. */
  size: Ref<{ w: number; h: number }>
  /** Window position — bounds w by vw - x. */
  x: Ref<number>
  /** Window position — bounds h by vh - y - safeBottom. */
  y: Ref<number>
  minSize?: { w: number; h: number }
  /** Bottom safe margin; default = status bar + max(--mkb-height, --sys-kb-height)
   *  (same as useFloatingDrag). */
  safeBottom?: () => number
  /** Called when a resize settles, with the final clamped size. */
  persist?: (w: number, h: number) => void
}

export interface WindowResize {
  resizing: Ref<boolean>
  /** Bind to pointerdown on the corner handle. Left-button only; pointer capture. */
  onHandlePointerDown: (e: PointerEvent) => void
  /** Clamp w/h into [min, viewport-bound]. Call on mount and on window resize. */
  clampSize: () => void
  dispose: () => void
}

/** StatusBar.vue `.status-bar` height — mirrors useFloatingDrag's safe bottom. */
const STATUSBAR_HEIGHT = 24

function defaultSafeBottom(): number {
  if (typeof document === 'undefined') return STATUSBAR_HEIGHT
  const cs = getComputedStyle(document.documentElement)
  const mkb = parseFloat(cs.getPropertyValue('--mkb-height')) || 0
  const sysKb = parseFloat(cs.getPropertyValue('--sys-kb-height')) || 0
  return STATUSBAR_HEIGHT + Math.max(mkb, sysKb)
}

export function useWindowResize(opts: WindowResizeOptions): WindowResize {
  const min = opts.minSize ?? DEFAULT_MIN
  const resizing = ref(false)

  let activePointerId: number | null = null
  let activeSurface: HTMLElement | null = null
  let startPointerX = 0
  let startPointerY = 0
  let startW = 0
  let startH = 0
  let resizeMoved = false
  let pendingW = 0
  let pendingH = 0
  let rafHandle: number | null = null
  let mounted = false

  function clampW(w: number): number {
    const maxW = Math.max(min.w, window.innerWidth - opts.x.value)
    return Math.min(Math.max(w, min.w), maxW)
  }

  function clampH(h: number): number {
    const sb = opts.safeBottom ? opts.safeBottom() : defaultSafeBottom()
    const maxH = Math.max(min.h, window.innerHeight - opts.y.value - sb)
    return Math.min(Math.max(h, min.h), maxH)
  }

  function clampSize() {
    opts.size.value = { w: clampW(opts.size.value.w), h: clampH(opts.size.value.h) }
  }

  function onPointerMove(e: PointerEvent) {
    if (e.pointerId !== activePointerId) return
    pendingW = startW + (e.clientX - startPointerX)
    pendingH = startH + (e.clientY - startPointerY)
    resizeMoved = true
    if (rafHandle == null) {
      rafHandle = requestAnimationFrame(() => {
        rafHandle = null
        opts.size.value = { w: clampW(pendingW), h: clampH(pendingH) }
      })
    }
  }

  function onVisibilityChange() {
    if (document.hidden && resizing.value) finishResize(true)
  }

  function finishResize(cancelled: boolean) {
    if (activePointerId === null) return
    const id = activePointerId
    const surface = activeSurface
    activePointerId = null
    activeSurface = null
    resizing.value = false
    if (rafHandle != null) {
      cancelAnimationFrame(rafHandle)
      rafHandle = null
    }
    window.removeEventListener('pointermove', onPointerMove)
    window.removeEventListener('pointerup', onPointerUp)
    window.removeEventListener('pointercancel', onPointerCancel)
    document.removeEventListener('visibilitychange', onVisibilityChange)
    if (!cancelled && resizeMoved) {
      opts.persist?.(opts.size.value.w, opts.size.value.h)
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
    finishResize(false)
  }

  function onPointerCancel(e: PointerEvent) {
    if (e.pointerId !== activePointerId) return
    finishResize(true)
  }

  function onHandlePointerDown(e: PointerEvent) {
    if (e.button !== 0 || activePointerId !== null) return
    const surface = e.currentTarget as HTMLElement
    activePointerId = e.pointerId
    activeSurface = surface
    startPointerX = e.clientX
    startPointerY = e.clientY
    startW = opts.size.value.w
    startH = opts.size.value.h
    resizeMoved = false
    resizing.value = true
    try {
      surface.setPointerCapture(activePointerId)
    } catch {
      // happy-dom / non-pointer environments lack setPointerCapture
    }
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
    window.addEventListener('pointercancel', onPointerCancel)
    document.addEventListener('visibilitychange', onVisibilityChange)
  }

  function mount() {
    if (mounted) return
    mounted = true
    clampSize()
    window.addEventListener('resize', clampSize)
  }

  function dispose() {
    mounted = false
    if (rafHandle != null) {
      cancelAnimationFrame(rafHandle)
      rafHandle = null
    }
    window.removeEventListener('pointermove', onPointerMove)
    window.removeEventListener('pointerup', onPointerUp)
    window.removeEventListener('pointercancel', onPointerCancel)
    document.removeEventListener('visibilitychange', onVisibilityChange)
    window.removeEventListener('resize', clampSize)
  }

  if (getCurrentInstance()) {
    onMounted(mount)
    onBeforeUnmount(dispose)
  }

  return { resizing, onHandlePointerDown, clampSize, dispose }
}
