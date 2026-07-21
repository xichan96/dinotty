<template>
  <div
    class="pane-header"
    :class="[direction ? `direction-${direction}` : '', { active: isActive, dragging: isDragging }]"
    @mousedown.prevent="onMouseDown"
    @touchstart.prevent="onTouchStart"
  >
    <span class="pane-header-title">{{ title }}</span>
  </div>
</template>

<script setup lang="ts">
import { ref, onBeforeUnmount } from 'vue'
import type { DropPosition } from '../../types/pane'
import { usePaneDrag, type DropZone, type DropTargetKind } from '../../composables/paneDragContext'

const props = defineProps<{
  paneId: string
  tabId: string
  title: string
  isActive: boolean
  direction?: 'horizontal' | 'vertical'
}>()

const emit = defineEmits<{
  reorder: [sourcePaneId: string, targetPaneId: string, position: DropPosition]
  'drop-on-tab': [sourceTabId: string, sourcePaneId: string, dstTabId: string, position: DropPosition]
  'drop-extract': [sourceTabId: string, sourcePaneId: string, targetIndex: number]
}>()

const drag = usePaneDrag()

const isDragging = ref(false)

let overlay: HTMLDivElement | null = null
let currentTargetId: string | null = null
let currentZone: DropZone | null = null
let currentTargetKind: DropTargetKind | null = null
let dragStarted = false
let startX = 0
let startY = 0
let isTouchDrag = false
const DRAG_THRESHOLD = 5
const HOVER_SWITCH_DELAY = 300

let hoverTimer: number | null = null
let hoverTabId: string | null = null

function getPointerPos(e: MouseEvent | TouchEvent): { clientX: number; clientY: number } {
  if ('touches' in e) {
    const t = e.touches[0]
    return { clientX: t.clientX, clientY: t.clientY }
  }
  return { clientX: e.clientX, clientY: e.clientY }
}

function onMouseDown(e: MouseEvent) {
  if (e.button !== 0) return
  startDrag(e, false)
}

function onTouchStart(e: TouchEvent) {
  if (e.touches.length !== 1) return
  startDrag(e, true)
}

function startDrag(e: MouseEvent | TouchEvent, isTouch: boolean) {
  const pos = getPointerPos(e)
  startX = pos.clientX
  startY = pos.clientY
  dragStarted = false
  isTouchDrag = isTouch

  const moveEvent = isTouch ? 'touchmove' : 'mousemove'
  const endEvent = isTouch ? 'touchend' : 'mouseup'

  window.addEventListener(
    moveEvent,
    onPointerMove as EventListener,
    { passive: !isTouch } as AddEventListenerOptions
  )
  window.addEventListener(endEvent, onPointerEnd)
  if (!isTouch) {
    document.addEventListener('keydown', onKeydown, true)
    document.addEventListener('mouseleave', onMouseLeave)
  }
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && dragStarted) {
    // Cancel drag: cleanup without emitting events
    cancelDrag()
  }
}

function onMouseLeave(_e: MouseEvent) {
  // When pointer leaves the document during drag, cancel without emit
  if (dragStarted) {
    cancelDrag()
  }
}

function cancelDrag() {
  // Reset target so onPointerEnd doesn't emit
  currentTargetId = null
  currentZone = null
  currentTargetKind = null
  drag.clearTarget()
  cleanup()
}

function ensureDragStarted() {
  if (dragStarted) return
  dragStarted = true
  isDragging.value = true

  // On touch, skip overlay to avoid blocking touch events
  if (!isTouchDrag) {
    overlay = document.createElement('div')
    overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;cursor:grabbing;'
    document.body.appendChild(overlay)
  }

  drag.startDrag({ sourcePaneId: props.paneId, sourceTabId: props.tabId })
}

function clearHoverTimer() {
  if (hoverTimer !== null) {
    window.clearTimeout(hoverTimer)
    hoverTimer = null
  }
  if (hoverTabId !== null) {
    drag.setHoverTab(null)
    hoverTabId = null
  }
}

function scheduleHoverSwitch(tabId: string) {
  if (tabId === hoverTabId) return
  clearHoverTimer()
  hoverTabId = tabId
  drag.setHoverTab(tabId)
  hoverTimer = window.setTimeout(() => {
    // Emit a synthetic focus event to switch the active tab.
    // TabBar listens for this via a global event or we can dispatch directly.
    window.dispatchEvent(
      new CustomEvent('pane-drag-hover-switch', { detail: { tabId } })
    )
  }, HOVER_SWITCH_DELAY)
}

function onPointerMove(e: MouseEvent | TouchEvent) {
  const pos = getPointerPos(e)
  if (!dragStarted) {
    if (
      Math.abs(pos.clientX - startX) < DRAG_THRESHOLD &&
      Math.abs(pos.clientY - startY) < DRAG_THRESHOLD
    ) {
      return
    }
    ensureDragStarted()
  }

  const elements = document.elementsFromPoint(pos.clientX, pos.clientY)

  // 1. Try pane target (same tab)
  let paneTarget: HTMLElement | null = null
  let tabLabelTarget: HTMLElement | null = null
  let tabBarBlank = false

  for (const el of elements) {
    const htmlEl = el as HTMLElement
    if (htmlEl === overlay) continue

    if (!paneTarget) {
      const leaf = htmlEl.closest('.split-leaf[data-pane-id]') as HTMLElement | null
      if (leaf) {
        const paneId = leaf.dataset.paneId
        if (paneId && paneId !== props.paneId) {
          paneTarget = leaf
        }
      }
    }

    if (!tabLabelTarget) {
      const tabEl = htmlEl.closest('.tab[data-tab-id]') as HTMLElement | null
      if (tabEl) {
        const tabId = tabEl.dataset.tabId
        // Skip the source tab's label (Mode B within same tab doesn't make sense)
        if (tabId && tabId !== props.tabId) {
          tabLabelTarget = tabEl
        }
      }
    }

    if (!tabBarBlank && !tabLabelTarget) {
      // Only treat the empty space inside #tabs-list as a tab-blank drop
      // target. Hovering over the + button or action buttons must NOT
      // trigger extract, since those are siblings of #tabs-list, not
      // children of the tabs row.
      const tabsList = htmlEl.closest('#tabs-list') as HTMLElement | null
      if (tabsList) {
        tabBarBlank = true
      }
    }
  }

  // Priority: pane > tab-label > tab-blank
  if (paneTarget) {
    clearHoverTimer()
    const targetId = paneTarget.dataset.paneId!
    const rect = paneTarget.getBoundingClientRect()
    const relX = (pos.clientX - rect.left) / rect.width
    const relY = (pos.clientY - rect.top) / rect.height

    let zone: DropPosition
    if (relY < 0.25) zone = 'top'
    else if (relY > 0.75) zone = 'bottom'
    else if (relX < 0.25) zone = 'left'
    else if (relX > 0.75) zone = 'right'
    else {
      const distTop = relY
      const distBottom = 1 - relY
      const distLeft = relX
      const distRight = 1 - relX
      const minDist = Math.min(distTop, distBottom, distLeft, distRight)
      if (minDist === distTop) zone = 'top'
      else if (minDist === distBottom) zone = 'bottom'
      else if (minDist === distLeft) zone = 'left'
      else zone = 'right'
    }

    currentTargetId = targetId
    currentZone = zone
    currentTargetKind = 'pane'
    drag.setTarget(targetId, zone, 'pane')
  } else if (tabLabelTarget) {
    // Schedule hover switch to that tab (300ms delay)
    const tabId = tabLabelTarget.dataset.tabId!
    scheduleHoverSwitch(tabId)

    // Determine position based on cursor X relative to tab center
    const rect = tabLabelTarget.getBoundingClientRect()
    const relX = (pos.clientX - rect.left) / rect.width
    const zone: DropPosition = relX < 0.5 ? 'left' : 'right'

    currentTargetId = tabId
    currentZone = zone
    currentTargetKind = 'tab-label'
    drag.setTarget(tabId, zone, 'tab-label')
  } else if (tabBarBlank) {
    clearHoverTimer()
    currentTargetId = 'tab-bar-blank'
    currentZone = 'center'
    currentTargetKind = 'tab-blank'
    drag.setTarget('tab-bar-blank', 'center', 'tab-blank')
  } else {
    clearHoverTimer()
    currentTargetId = null
    currentZone = null
    currentTargetKind = null
    drag.clearTarget()
  }
}

function onPointerEnd() {
  if (dragStarted) {
    if (currentTargetId && currentZone && currentTargetKind) {
      if (currentTargetKind === 'pane') {
        emit('reorder', props.paneId, currentTargetId, currentZone as DropPosition)
      } else if (currentTargetKind === 'tab-label' && currentTargetId !== 'tab-bar-blank') {
        emit(
          'drop-on-tab',
          props.tabId,
          props.paneId,
          currentTargetId,
          currentZone as DropPosition
        )
      } else if (currentTargetKind === 'tab-blank') {
        // Extract: compute target index (end of tab bar for now)
        emit('drop-extract', props.tabId, props.paneId, -1)
      }
    }
  }

  cleanup()
}

function cleanup() {
  clearHoverTimer()
  isDragging.value = false
  dragStarted = false
  currentTargetId = null
  currentZone = null
  currentTargetKind = null

  overlay?.remove()
  overlay = null

  drag.endDrag()

  window.removeEventListener('mousemove', onPointerMove as EventListener)
  window.removeEventListener('mouseup', onPointerEnd)
  window.removeEventListener('touchmove', onPointerMove as EventListener)
  window.removeEventListener('touchend', onPointerEnd)
  document.removeEventListener('keydown', onKeydown, true)
  document.removeEventListener('mouseleave', onMouseLeave)
}

onBeforeUnmount(() => {
  cleanup()
})
</script>

<style scoped>
.pane-header {
  display: flex;
  align-items: center;
  height: 26px;
  padding: 0 8px;
  background: var(--bg-secondary, var(--bg-surface));
  border-bottom: 1px solid var(--border-color, var(--border));
  cursor: grab;
  user-select: none;
  flex-shrink: 0;
  position: relative;
  transition: background 0.15s;
}

.pane-header.direction-vertical {
  padding: 8px 8px;
  height: auto;
}

.pane-header:active {
  cursor: grabbing;
}

.pane-header.active {
  background: var(--bg-tertiary, var(--bg-hover));
}

.pane-header.dragging {
  opacity: 0.5;
}

.pane-header-title {
  font-size: 11px;
  color: var(--text-secondary, #aaa);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pane-header.active .pane-header-title {
  color: var(--text-primary, #fff);
}
</style>
