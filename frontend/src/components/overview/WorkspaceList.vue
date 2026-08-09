<template>
  <div class="mc-ws-list">
    <div class="mc-ws-list-scroll">
      <button
        class="mc-ws-list-item"
        :class="{ selected: selectedId === DEFAULT_WORKSPACE_ID }"
        @click="$emit('select', DEFAULT_WORKSPACE_ID)"
        @contextmenu.prevent="openCtx($event, defaultWorkspace)"
      >
        <WorkspaceBadge
          :abbr="resolveAbbr(defaultWorkspace)"
          :color="resolveColor(defaultWorkspace)"
          :size="18"
        />
        <span class="mc-ws-name">{{ defaultWorkspace.name }}</span>
        <span v-if="defaultCount" class="mc-ws-count">{{ defaultCount }}</span>
      </button>

      <button
        v-for="ws in workspaces"
        :key="ws.id"
        class="mc-ws-list-item"
        :class="{
          selected: ws.id === selectedId,
          dragging: ws.id === draggingId,
          'drag-over-top': ws.id === dragOverId && dragOverPosition === 'before',
          'drag-over-bottom': ws.id === dragOverId && dragOverPosition === 'after',
        }"
        :data-workspace-id="ws.id"
        @mousedown="onItemMouseDown($event, ws.id)"
        @touchstart="onItemTouchStart($event, ws.id)"
        @click="onItemClick($event, ws.id)"
        @contextmenu.prevent="openCtx($event, ws)"
      >
        <span
          class="mc-ws-drag-handle"
          @mousedown.stop="onHandleMouseDown($event, ws.id)"
          @touchstart.stop="onHandleTouchStart($event, ws.id)"
        >
          <GripVertical :size="14" />
        </span>
        <WorkspaceBadge
          :remote="!!ws.connection_id"
          :abbr="resolveAbbr(ws)"
          :color="resolveColor(ws)"
          :size="18"
        />
        <span class="mc-ws-name">{{ ws.name }}</span>
        <span v-if="tabCounts[ws.id]" class="mc-ws-count">{{ tabCounts[ws.id] }}</span>
      </button>
    </div>

    <div class="mc-ws-footer">
      <button class="mc-ws-add-btn" @click="$emit('add')">
        <Plus :size="14" />
        {{ t('workspace.add') }}
      </button>
    </div>

    <ContextMenu
      :visible="ctxVisible"
      :x="ctxX"
      :y="ctxY"
      :items="ctxItems"
      @close="ctxVisible = false"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, onUnmounted } from 'vue'
import { Plus, Pencil, Trash2, GripVertical } from 'lucide-vue-next'
import { useI18n } from '../../composables/useI18n'
import { uiConfirm } from '../../composables/useConfirm'
import { DEFAULT_WORKSPACE_ID, useWorkspaces } from '../../composables/useWorkspaces'
import type { Workspace } from '../../types/workspace'
import { resolveAbbr, resolveColor } from '../../utils/workspaceIcon'
import WorkspaceBadge from '../WorkspaceBadge.vue'
import ContextMenu from '../ui/ContextMenu.vue'
import type { ContextMenuItem } from '../ui/ContextMenu.vue'

const DRAG_THRESHOLD = 5

const { t } = useI18n()
const { defaultWorkspace, deleteWorkspace, reorderWorkspaces } = useWorkspaces()

const draggingId = ref<string | null>(null)
const dragOverId = ref<string | null>(null)
const dragOverPosition = ref<'before' | 'after' | null>(null)

const props = defineProps<{
  workspaces: Workspace[]
  selectedId: string | null
  activeId: string | null
  tabCounts: Record<string, number>
  defaultCount: number
}>()

const emit = defineEmits<{
  select: [id: string | null]
  selectAll: []
  add: []
  rename: [id: string]
}>()

// Context menu
const ctxVisible = ref(false)
const ctxX = ref(0)
const ctxY = ref(0)
const ctxItems = ref<ContextMenuItem[]>([])

onUnmounted(cleanupDrag)

function openCtx(e: MouseEvent, ws: Workspace) {
  ctxX.value = e.clientX
  ctxY.value = e.clientY
  ctxItems.value = [
    {
      label: ws.id === DEFAULT_WORKSPACE_ID ? t('workspace.editDefault') : t('palette.rename'),
      icon: Pencil,
      action: () => emit('rename', ws.id),
    },
  ]
  if (ws.id !== DEFAULT_WORKSPACE_ID) {
    ctxItems.value.push({
      label: t('workspace.delete'),
      icon: Trash2,
      danger: true,
      action: async () => {
        if (!(await uiConfirm(t('workspace.confirmDelete').replace('{name}', ws.name), {
          title: t('workspace.delete'),
          confirmText: t('workspace.delete'),
          cancelText: t('filePreview.cancel'),
        }))) return
        try {
          await deleteWorkspace(ws.id)
        } catch (err) {
          console.error('Failed to delete workspace:', err)
        }
      },
    })
  }
  ctxVisible.value = true
}

// ---------------------------------------------------------------------------
// Drag-and-drop reordering
// ---------------------------------------------------------------------------

let dragFromId: string | null = null
let dragStarted = false
let startX = 0
let startY = 0
let isTouchDrag = false
let suppressNextClick = false

function canDrag(): boolean {
  return props.workspaces.length > 1
}

function getPointerPos(e: MouseEvent | TouchEvent): { clientX: number; clientY: number } {
  if ('touches' in e) {
    const t = e.touches[0]
    return { clientX: t.clientX, clientY: t.clientY }
  }
  return { clientX: e.clientX, clientY: e.clientY }
}

function onItemMouseDown(e: MouseEvent, id: string) {
  if (e.button !== 0 || e.ctrlKey) return
  startDrag(e, id, false)
}

function onItemTouchStart(e: TouchEvent, id: string) {
  if (e.touches.length !== 1) return
  startDrag(e, id, true)
}

function onHandleMouseDown(e: MouseEvent, id: string) {
  if (e.button !== 0 || e.ctrlKey) return
  // Handle already stopped propagation, but we still want to start drag.
  startDrag(e, id, false)
}

function onHandleTouchStart(e: TouchEvent, id: string) {
  if (e.touches.length !== 1) return
  startDrag(e, id, true)
}

function startDrag(e: MouseEvent | TouchEvent, id: string, isTouch: boolean) {
  if (!canDrag()) return
  const pos = getPointerPos(e)
  startX = pos.clientX
  startY = pos.clientY
  dragStarted = false
  isTouchDrag = isTouch
  dragFromId = id
  suppressNextClick = false
  document.body.style.userSelect = 'none'

  const moveEvent = isTouch ? 'touchmove' : 'mousemove'
  const endEvent = isTouch ? 'touchend' : 'mouseup'
  const cancelEvent = isTouch ? 'touchcancel' : 'pointercancel'

  window.addEventListener(moveEvent, onPointerMove as EventListener, { passive: !isTouch })
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
    e.preventDefault()
    cancelDrag()
  }
}

function onMouseLeave() {
  if (dragStarted) cancelDrag()
}

function onBlur() {
  if (dragStarted) cancelDrag()
}

function onVisibilityChange() {
  if (dragStarted && document.visibilityState === 'hidden') cancelDrag()
}

function cancelDrag() {
  cleanupDrag()
}

function onPointerMove(e: MouseEvent | TouchEvent) {
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
    draggingId.value = dragFromId
    suppressNextClick = true
    if (isTouchDrag) {
      e.preventDefault()
    }
  } else if (isTouchDrag) {
    e.preventDefault()
  }

  updateDragTarget(pos.clientX, pos.clientY)
}

function updateDragTarget(clientX: number, clientY: number) {
  dragOverId.value = null
  dragOverPosition.value = null

  const elements = document.elementsFromPoint(clientX, clientY)
  for (const el of elements) {
    const item = (el as HTMLElement).closest('.mc-ws-list-item[data-workspace-id]') as HTMLElement | null
    if (!item) continue
    const id = item.dataset.workspaceId
    if (!id || id === DEFAULT_WORKSPACE_ID || id === dragFromId) continue

    const rect = item.getBoundingClientRect()
    const midpoint = rect.top + rect.height / 2
    dragOverId.value = id
    dragOverPosition.value = clientY < midpoint ? 'before' : 'after'
    break
  }
}

function onPointerEnd() {
  if (dragStarted && dragFromId && dragOverId.value && dragOverPosition.value) {
    const fromId = dragFromId
    const toId = dragOverId.value
    const position = dragOverPosition.value
    if (fromId !== toId) {
      const ids = computeNewOrder(fromId, toId, position)
      if (ids && !isSameOrder(ids)) {
        void reorderWorkspaces(ids)
      }
    }
  }
  cleanupDrag()
}

function computeNewOrder(fromId: string, toId: string, position: 'before' | 'after'): string[] {
  const currentIds = props.workspaces.map((w) => w.id)
  const fromIdx = currentIds.indexOf(fromId)
  const toIdx = currentIds.indexOf(toId)
  if (fromIdx === -1 || toIdx === -1) return []

  const ids = [...currentIds]
  ids.splice(fromIdx, 1)

  // After removing the dragged item, the target index shifts if the dragged
  // item was before the target.
  const toIdxInNew = toIdx - (fromIdx < toIdx ? 1 : 0)
  const targetIdx = position === 'before' ? toIdxInNew : toIdxInNew + 1
  const clampedIdx = Math.max(0, Math.min(targetIdx, ids.length))
  ids.splice(clampedIdx, 0, fromId)
  return ids
}

function isSameOrder(ids: string[]): boolean {
  const current = props.workspaces.map((w) => w.id)
  if (current.length !== ids.length) return false
  return current.every((id, i) => id === ids[i])
}

function cleanupDrag() {
  dragStarted = false
  dragFromId = null
  draggingId.value = null
  dragOverId.value = null
  dragOverPosition.value = null
  document.body.style.userSelect = ''

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
}

function onItemClick(e: MouseEvent, id: string) {
  if (suppressNextClick) {
    e.preventDefault()
    e.stopPropagation()
    suppressNextClick = false
    return
  }
  emit('select', id)
}
</script>
