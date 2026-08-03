import { ref, type Ref } from 'vue'
import { usePaneDrag, type DropZone } from './paneDragContext'

type PaneZone = 'left' | 'right' | 'top' | 'bottom'

export interface TabDragOptions {
  drag: ReturnType<typeof usePaneDrag>
  activePaneId: Ref<string | null>
  findTabElement: (paneId: string) => HTMLElement | undefined
  onActivate: (paneId: string) => void
  onReorder: (fromId: string, toId: string) => void
  onMergeTabIntoPane: (tabId: string, paneId: string, zone: PaneZone) => void
}

export interface TabDragState {
  dragOverId: Ref<string | null>
  scrollTabIntoView: (paneId: string) => boolean
  onTabMouseDown: (e: MouseEvent, paneId: string) => void
  onTabTouchStart: (e: TouchEvent, paneId: string) => void
  onTabClick: (e: MouseEvent, paneId: string) => void
  onTabTouchEnd: (e: TouchEvent, paneId: string) => void
  cleanup: () => void
}

const DRAG_THRESHOLD = 5

export function useTabDrag(opts: TabDragOptions): TabDragState {
  const { drag, activePaneId, findTabElement, onActivate, onReorder, onMergeTabIntoPane } = opts

  const dragOverId = ref<string | null>(null)

  let dragFromId: string | null = null
  let dragStarted = false
  let startX = 0
  let startY = 0
  let isTouchDrag = false
  let suppressClick = false
  let paneTargetId: string | null = null
  let paneTargetZone: PaneZone | null = null

  function scrollTabIntoView(paneId: string): boolean {
    const el = findTabElement(paneId)
    if (!el) return false
    if (!dragStarted || dragFromId === null) {
      el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' })
    }
    return true
  }

  function getPointerPos(e: MouseEvent | TouchEvent): { clientX: number; clientY: number } {
    if ('touches' in e) {
      const t = e.touches[0]
      return { clientX: t.clientX, clientY: t.clientY }
    }
    return { clientX: e.clientX, clientY: e.clientY }
  }

  function onTabMouseDown(e: MouseEvent, paneId: string) {
    if (e.button !== 0 || e.ctrlKey) return
    suppressClick = false
    startDrag(e, paneId, false)
  }

  function onTabTouchStart(e: TouchEvent, paneId: string) {
    if (e.touches.length !== 1) return
    suppressClick = false
    startDrag(e, paneId, true)
  }

  function onTabClick(e: MouseEvent, paneId: string) {
    if (suppressClick) {
      e.preventDefault()
      e.stopPropagation()
      suppressClick = false
      return
    }
    onActivate(paneId)
  }

  function onTabTouchEnd(e: TouchEvent, paneId: string) {
    if (suppressClick) {
      suppressClick = false
      return
    }
    onActivate(paneId)
  }

  function startDrag(e: MouseEvent | TouchEvent, paneId: string, isTouch: boolean) {
    const pos = getPointerPos(e)
    startX = pos.clientX
    startY = pos.clientY
    dragStarted = false
    isTouchDrag = isTouch
    dragFromId = paneId
    paneTargetId = null
    paneTargetZone = null

    const moveEvent = isTouch ? 'touchmove' : 'mousemove'
    const endEvent = isTouch ? 'touchend' : 'mouseup'
    const cancelEvent = isTouch ? 'touchcancel' : 'pointercancel'

    window.addEventListener(
      moveEvent,
      onPointerMove as EventListener,
      { passive: !isTouch } as AddEventListenerOptions
    )
    window.addEventListener(endEvent, onPointerEnd)
    window.addEventListener(cancelEvent, onPointerEnd)
    if (!isTouch) {
      document.addEventListener('keydown', onKeydown, true)
      document.addEventListener('mouseleave', onMouseLeave)
      window.addEventListener('blur', onBlur)
      document.addEventListener('visibilitychange', onVisibilityChange)
    }
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape' && dragStarted) {
      cancelDrag()
    }
  }

  function onMouseLeave(_e: MouseEvent) {
    if (dragStarted) {
      cancelDrag()
    }
  }

  function onBlur() {
    if (dragStarted) {
      cancelDrag()
    }
  }

  function onVisibilityChange() {
    if (dragStarted && document.visibilityState === 'hidden') {
      cancelDrag()
    }
  }

  function cancelDrag() {
    paneTargetId = null
    paneTargetZone = null
    dragOverId.value = null
    drag.clearTarget()
    cleanup()
  }

  function computePaneZone(
    rect: DOMRect,
    clientX: number,
    clientY: number
  ): PaneZone {
    const relX = (clientX - rect.left) / rect.width
    const relY = (clientY - rect.top) / rect.height
    if (relY < 0.25) return 'top'
    if (relY > 0.75) return 'bottom'
    if (relX < 0.25) return 'left'
    if (relX > 0.75) return 'right'
    const distTop = relY
    const distBottom = 1 - relY
    const distLeft = relX
    const distRight = 1 - relX
    const minDist = Math.min(distTop, distBottom, distLeft, distRight)
    if (minDist === distTop) return 'top'
    if (minDist === distBottom) return 'bottom'
    if (minDist === distLeft) return 'left'
    return 'right'
  }

  function onPointerMove(e: MouseEvent | TouchEvent) {
    // Self-heal: if the button was released but mouseup was lost, cancel on the next move.
    if (!isTouchDrag && 'buttons' in e && (e as MouseEvent).buttons === 0) {
      cancelDrag()
      return
    }
    const pos = getPointerPos(e)
    if (!dragStarted) {
      if (
        Math.abs(pos.clientX - startX) < DRAG_THRESHOLD &&
        Math.abs(pos.clientY - startY) < DRAG_THRESHOLD
      ) {
        return
      }
      dragStarted = true
      if (isTouchDrag) {
        e.preventDefault()
      }
      drag.startDrag({ sourcePaneId: dragFromId!, sourceTabId: dragFromId!, wholeTab: true })
    } else if (isTouchDrag) {
      e.preventDefault()
    }

    paneTargetId = null
    paneTargetZone = null
    let tabTargetId: string | null = null

    const elements = document.elementsFromPoint(pos.clientX, pos.clientY)
    for (const el of elements) {
      const htmlEl = el as HTMLElement
      if (!paneTargetId) {
        const leaf = htmlEl.closest('.split-leaf[data-pane-id]') as HTMLElement | null
        if (leaf) {
          const leafPaneId = leaf.dataset.paneId
          if (leafPaneId) {
            if (dragFromId !== activePaneId.value) {
              const rect = leaf.getBoundingClientRect()
              paneTargetId = leafPaneId
              paneTargetZone = computePaneZone(rect, pos.clientX, pos.clientY)
            }
          }
        }
      }
      if (!tabTargetId) {
        const tabEl = htmlEl.closest('.tab[data-pane-id]') as HTMLElement | null
        if (tabEl) {
          const pid = tabEl.dataset.paneId
          if (pid && pid !== dragFromId) {
            tabTargetId = pid
          }
        }
      }
      if (paneTargetId && tabTargetId) break
    }

    if (paneTargetId && paneTargetZone) {
      dragOverId.value = null
      drag.setTarget(paneTargetId, paneTargetZone as DropZone, 'pane')
    } else {
      drag.clearTarget()
      dragOverId.value = tabTargetId
    }
  }

  function onPointerEnd() {
    if (dragStarted && dragFromId) {
      if (paneTargetId && paneTargetZone) {
        suppressClick = true
        onMergeTabIntoPane(dragFromId, paneTargetId, paneTargetZone)
      } else if (dragOverId.value && dragFromId !== dragOverId.value) {
        suppressClick = true
        onReorder(dragFromId, dragOverId.value)
      }
    }

    cleanup()
  }

  function cleanup() {
    dragStarted = false
    dragFromId = null
    dragOverId.value = null
    paneTargetId = null
    paneTargetZone = null

    window.removeEventListener('mousemove', onPointerMove as EventListener)
    window.removeEventListener('mouseup', onPointerEnd)
    window.removeEventListener('touchmove', onPointerMove as EventListener)
    window.removeEventListener('touchend', onPointerEnd)
    window.removeEventListener('pointercancel', onPointerEnd)
    window.removeEventListener('touchcancel', onPointerEnd)
    document.removeEventListener('keydown', onKeydown, true)
    document.removeEventListener('mouseleave', onMouseLeave)
    window.removeEventListener('blur', onBlur)
    document.removeEventListener('visibilitychange', onVisibilityChange)

    drag.endDrag()
  }

  return {
    dragOverId,
    scrollTabIntoView,
    onTabMouseDown,
    onTabTouchStart,
    onTabClick,
    onTabTouchEnd,
    cleanup,
  }
}
