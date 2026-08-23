<template>
  <div
    ref="itemEl"
    class="overlay-item"
    :style="style"
    @click="onItemClick"
    @pointerdown="onItemPointerDown"
    @click.capture="onItemClickCapture"
    @contextmenu.prevent="openContextMenu"
  >
    <div class="overlay-stack">
      <!-- No visible bar: the widget itself is the drag surface.
           whole/reposition = immediate drag, grip-without-handle = strict hold-to-drag,
           passive = pointer-events:none passthrough (reposition temporarily lifts it). -->
      <div
        class="overlay-widget"
        :class="{
          'is-passive': isPassive,
          'is-draggable': isWhole || isRepositioning,
          'is-hold': isHoldSurface,
          'is-repositioning': isRepositioning,
          'is-dragging': dragging,
        }"
      >
        <component :is="overlay.component" v-if="!hasError" :api="api" :dragging="dragging" />
      </div>
    </div>
    <ContextMenu
      :visible="!!menu"
      :x="menu?.x ?? 0"
      :y="menu?.y ?? 0"
      :items="menuItems"
      @close="menu = null"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, inject, onBeforeUnmount, onErrorCaptured, onMounted, ref } from 'vue'
import { X } from 'lucide-vue-next'
import { useFloatingDrag } from '../../composables/useFloatingDrag'
import { FOCUS_ACTIVE_KEY } from '../../composables/useFocusActive'
import { subscribe } from '../../composables/useEventBridge'
import { useI18n } from '../../composables/useI18n'
import { usePluginOverlaysStore } from '../../stores/pluginOverlays'
import type { PluginContext } from '../../composables/usePluginLoader'
import type { RegisteredOverlay } from '../../stores/pluginOverlays'
import ContextMenu, { type ContextMenuItem } from '../ui/ContextMenu.vue'

const props = defineProps<{
  overlay: RegisteredOverlay
  api: PluginContext
}>()

const emit = defineEmits<{ (e: 'reportError', id: string, err?: unknown): void }>()

const itemEl = ref<HTMLElement | null>(null)
const hasError = ref(false)
const hasHandle = ref(false)
const menu = ref<{ x: number; y: number } | null>(null)
const focusActive = inject(FOCUS_ACTIVE_KEY, undefined)
const { t } = useI18n()
const overlayStore = usePluginOverlaysStore()

const interactive = computed(() => props.overlay.interactive ?? true)
const dragHandle = computed(() => props.overlay.dragHandle ?? 'whole')
const isWhole = computed(() => interactive.value && dragHandle.value === 'whole')
const isPassive = computed(() => !interactive.value && !isRepositioning.value)
/** Reposition mode (plugin tab "Adjust position"): the whole widget is immediately
 *  draggable even for passive overlays, which stay pointer-events:none otherwise. */
const isRepositioning = computed(() => overlayStore.repositionId === props.overlay.id)
/** Grip-mode widget with no [data-drag-handle] of its own: the whole widget becomes
 *  a strict hold-to-drag surface so content gestures (scroll/buttons) keep working. */
const isHoldSurface = computed(
  () => interactive.value && !hasHandle.value && !isWhole.value && !isRepositioning.value
)

const posKey = computed(() => `dinotty:overlay-pos:${props.overlay.pluginId}:${props.overlay.id}`)

function readPosition(): { x: number; y: number } | null {
  try {
    const raw = localStorage.getItem(posKey.value)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (typeof parsed?.x === 'number' && typeof parsed?.y === 'number') return parsed
    return null
  } catch {
    return null
  }
}

function persistPosition(x: number, y: number) {
  try {
    localStorage.setItem(posKey.value, JSON.stringify({ x, y }))
  } catch {
    // storage unavailable (private mode): positions just won't persist
  }
}

function resolveInitialPosition(): { x: number; y: number } {
  const saved = readPosition()
  if (saved) return saved
  const dp = props.overlay.defaultPosition
  if (dp && typeof dp === 'object') return { x: dp.x, y: dp.y }
  const anchor = (dp as string) ?? 'bottom-right'
  // Corner anchors map to outside-viewport coords; the first reClamp pulls the
  // widget into the safe area with the correct margin.
  switch (anchor) {
    case 'top-left':
      return { x: 0, y: 0 }
    case 'top-right':
      return { x: window.innerWidth, y: 0 }
    case 'bottom-left':
      return { x: 0, y: window.innerHeight }
    default:
      return { x: window.innerWidth, y: window.innerHeight }
  }
}

function isTextEditable(el: HTMLElement): boolean {
  if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') return true
  return el.isContentEditable
}

/** R4 focus restore: give focus back to the active terminal after interacting
 *  with the overlay, unless the focused element is a text editor inside it. */
function restoreFocus() {
  const active = document.activeElement as HTMLElement | null
  if (!active || !itemEl.value?.contains(active)) return
  if (isTextEditable(active)) return
  active.blur()
  focusActive?.()
}

function onItemClick() {
  restoreFocus()
}

// --- drag delegation -----------------------------------------------------
// whole / reposition: any pointerdown on the widget drags (immediately).
// grip with a handle: only pointerdown on the widget's own [data-drag-handle]
//   header drags, so content buttons/scrolling keep their native gestures.
// grip without a handle: the whole widget is a strict hold-to-drag surface.
// passive (normal): pointer-events:none, never reaches here.
function onItemPointerDown(e: PointerEvent) {
  if (isWhole.value || isRepositioning.value) {
    onPointerDown(e)
    return
  }
  if (!interactive.value) return
  const target = e.target as HTMLElement
  if (target.closest('[data-drag-handle]') || !hasHandle.value) onPointerDown(e)
}

function onItemClickCapture(e: MouseEvent) {
  const target = e.target as HTMLElement
  if (
    isWhole.value ||
    isRepositioning.value ||
    (interactive.value && target.closest('[data-drag-handle]')) ||
    isHoldSurface.value
  ) {
    onSurfaceClick(e)
  }
}

function openContextMenu(e: MouseEvent) {
  menu.value = { x: e.clientX, y: e.clientY }
}

const menuItems = computed<ContextMenuItem[]>(() => [
  {
    label: t('overlay.close'),
    icon: X,
    action: () => overlayStore.hideOverlay(props.overlay.id),
  },
])

const drag = useFloatingDrag({
  element: itemEl,
  initialPosition: resolveInitialPosition,
  persist: persistPosition,
  holdToDrag: () => isHoldSurface.value,
  onDragEnd: () => {
    restoreFocus()
    if (isRepositioning.value) overlayStore.setReposition(null)
  },
})
const { style, dragging, onPointerDown, onSurfaceClick } = drag

// Track whether the grip-mode widget declares its own drag header. Without one,
// the whole widget becomes a strict hold-to-drag surface (isHoldSurface).
function scanHandle() {
  hasHandle.value = !!itemEl.value?.querySelector('.overlay-widget [data-drag-handle]')
}

let handleObserver: MutationObserver | null = null

onMounted(() => {
  scanHandle()
  const widgetEl = itemEl.value?.querySelector('.overlay-widget')
  if (widgetEl && typeof MutationObserver !== 'undefined') {
    handleObserver = new MutationObserver(scanHandle)
    handleObserver.observe(widgetEl, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['data-drag-handle'],
    })
  }
})

onErrorCaptured((err: any) => {
  hasError.value = true
  emit('reportError', props.overlay.id, err)
  return false // prevent propagation to the app root
})

const kbUnsubs = [
  subscribe('kb-open', () => drag.reClamp()),
  subscribe('kb-close', () => drag.reClamp()),
]

onBeforeUnmount(() => {
  handleObserver?.disconnect()
  handleObserver = null
  kbUnsubs.forEach((u) => u())
  drag.dispose()
})
</script>

<style scoped>
.overlay-item {
  position: absolute;
  top: 0;
  left: 0;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  pointer-events: none;
}
.overlay-stack {
  display: flex;
  flex-direction: column;
  width: max-content;
}
.overlay-widget {
  pointer-events: auto;
}
.overlay-widget.is-passive {
  pointer-events: none;
}
.overlay-widget.is-draggable {
  touch-action: none;
  cursor: grab;
}
.overlay-widget.is-hold {
  cursor: grab;
}
.overlay-widget.is-draggable.is-dragging,
.overlay-widget.is-hold.is-dragging {
  cursor: grabbing;
}
.overlay-widget.is-repositioning {
  pointer-events: auto;
  touch-action: none;
  cursor: move;
  outline: 1px dashed var(--accent, #8a8a8a);
  outline-offset: 2px;
  border-radius: var(--radius, 8px);
}
</style>
