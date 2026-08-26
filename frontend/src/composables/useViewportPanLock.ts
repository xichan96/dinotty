import { onBeforeUnmount, onMounted, watch, type Ref } from 'vue'

export interface PanLockDeps {
  isActive: () => boolean
}

export function findScrollableAncestor(
  target: Element | null,
  root: Element,
  deltaY: number
): Element | null {
  if (typeof window === 'undefined') return null

  let current = target
  while (current) {
    const overflowY = window.getComputedStyle(current).overflowY
    const isScrollable =
      (overflowY === 'auto' || overflowY === 'scroll') &&
      current.scrollHeight - current.clientHeight > 1
    if (isScrollable) {
      const canMove =
        (deltaY > 0 && current.scrollTop > 0) ||
        (deltaY < 0 && current.scrollTop + current.clientHeight < current.scrollHeight - 1)
      // An exact boundary is intentionally not a match, so rubber-band overscroll is cancelled.
      if (canMove) return current
    }
    if (current === root) break
    current = current.parentElement
  }
  return null
}

export function useViewportPanLock(
  root: Ref<HTMLElement | null>,
  deps: PanLockDeps
): { dispose: () => void } {
  let attachedRoot: HTMLElement | null = null
  let eligible = false
  let startX = 0
  let startY = 0
  let stopWatching: (() => void) | null = null

  const touchMoveOptions: AddEventListenerOptions = { passive: false }

  function onTouchStart(event: TouchEvent) {
    eligible = event.touches.length === 1
    if (!eligible) return
    startX = event.touches[0].clientX
    startY = event.touches[0].clientY
  }

  function onTouchMove(event: TouchEvent) {
    if (!eligible || event.touches.length !== 1 || !event.cancelable || !deps.isActive()) return
    const deltaX = event.touches[0].clientX - startX
    const deltaY = event.touches[0].clientY - startY
    if (Math.abs(deltaY) <= Math.abs(deltaX)) return
    const target = event.target instanceof Element ? event.target : null
    if (attachedRoot && findScrollableAncestor(target, attachedRoot, deltaY) === null) {
      event.preventDefault()
    }
  }

  function clearGesture() {
    eligible = false
  }

  function detach() {
    if (!attachedRoot) return
    attachedRoot.removeEventListener('touchstart', onTouchStart)
    attachedRoot.removeEventListener('touchmove', onTouchMove, touchMoveOptions)
    attachedRoot.removeEventListener('touchend', clearGesture)
    attachedRoot.removeEventListener('touchcancel', clearGesture)
    attachedRoot = null
    clearGesture()
  }

  function attach(nextRoot: HTMLElement | null) {
    if (nextRoot === attachedRoot) return
    detach()
    if (!nextRoot) return
    attachedRoot = nextRoot
    attachedRoot.addEventListener('touchstart', onTouchStart, { passive: true })
    attachedRoot.addEventListener('touchmove', onTouchMove, touchMoveOptions)
    attachedRoot.addEventListener('touchend', clearGesture)
    attachedRoot.addEventListener('touchcancel', clearGesture)
  }

  function dispose() {
    stopWatching?.()
    stopWatching = null
    detach()
  }

  if (typeof window !== 'undefined') {
    onMounted(() => {
      stopWatching = watch(root, attach, { immediate: true, flush: 'post' })
    })
    onBeforeUnmount(dispose)
  }

  return { dispose }
}
