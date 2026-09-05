<template>
  <div
    ref="winEl"
    class="float-window"
    :class="{ 'is-dragging': dragging, 'is-resizing': resizing }"
    :style="winStyle"
    @pointerdown.capture="onWindowPointerDown"
  >
    <div
      class="float-titlebar"
      @pointerdown="drag.onPointerDown"
      @click.capture="drag.onSurfaceClick"
    >
      <span class="float-title" :title="plugin.manifest.name">{{ plugin.manifest.name }}</span>
      <button
        class="float-close"
        :title="t('plugin.floatWindow.close')"
        :aria-label="t('plugin.floatWindow.close')"
        @pointerdown.stop
        @click="store.close(plugin.id)"
      >
        <X :size="14" />
      </button>
    </div>
    <div class="float-body">
      <PluginView
        :plugin="plugin"
        :api="api"
        :pane-id="floatPaneId(plugin.id)"
        :workspace-id="workspaceId"
        :is-visible="true"
        :is-focused="true"
        :show-overlays="false"
      />
    </div>
    <div class="float-resize-handle" @pointerdown="resize.onHandlePointerDown" />
  </div>
</template>

<script setup lang="ts">
import { computed, inject, onBeforeUnmount, ref } from 'vue'
import { X } from 'lucide-vue-next'
import { useFloatingDrag } from '../../composables/useFloatingDrag'
import { FOCUS_ACTIVE_KEY } from '../../composables/useFocusActive'
import { subscribe } from '../../composables/useEventBridge'
import { useI18n } from '../../composables/useI18n'
import { useWindowResize } from '../../composables/useWindowResize'
import { usePluginFloatWindowsStore } from '../../stores/pluginFloatWindows'
import { floatPaneId } from '../../utils/pluginPaneId'
import type { LoadedPlugin, PluginContext } from '../../composables/usePluginLoader'
import PluginView from './PluginView.vue'

const props = defineProps<{
  plugin: LoadedPlugin
  api: PluginContext
  workspaceId: string | undefined
}>()

const { t } = useI18n()
const store = usePluginFloatWindowsStore()
const focusActive = inject(FOCUS_ACTIVE_KEY, undefined)

const winEl = ref<HTMLElement | null>(null)

const DEFAULT_W = 480
const DEFAULT_H = 360

interface WindowGeom {
  x: number
  y: number
  w: number
  h: number
}

const storageKey = computed(() => `dinotty:floating-win:${props.plugin.id}`)

function readGeom(): Partial<WindowGeom> | null {
  try {
    const raw = localStorage.getItem(storageKey.value)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    const out: Partial<WindowGeom> = {}
    if (typeof parsed?.x === 'number') out.x = parsed.x
    if (typeof parsed?.y === 'number') out.y = parsed.y
    if (typeof parsed?.w === 'number') out.w = parsed.w
    if (typeof parsed?.h === 'number') out.h = parsed.h
    return out
  } catch {
    return null
  }
}

function persistGeom(partial: Partial<WindowGeom>): void {
  try {
    const merged: WindowGeom = {
      x: drag.x.value,
      y: drag.y.value,
      w: size.value.w,
      h: size.value.h,
      ...partial,
    }
    localStorage.setItem(storageKey.value, JSON.stringify(merged))
  } catch {
    // storage unavailable (private mode): geometry just won't persist
  }
}

const saved = readGeom()
const size = ref({ w: saved?.w ?? DEFAULT_W, h: saved?.h ?? DEFAULT_H })

function isTextEditable(el: HTMLElement): boolean {
  if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') return true
  return el.isContentEditable
}

/** Give focus back to the active terminal after a title-bar drag, unless the
 *  focused element is a text editor inside the window (OverlayDragItem pattern). */
function restoreFocus() {
  const active = document.activeElement as HTMLElement | null
  if (!active || !winEl.value?.contains(active)) return
  if (isTextEditable(active)) return
  active.blur()
  focusActive?.()
}

const drag = useFloatingDrag({
  element: winEl,
  initialPosition: () =>
    saved?.x !== undefined && saved?.y !== undefined
      ? { x: saved.x, y: saved.y }
      : {
          x: (window.innerWidth - (saved?.w ?? DEFAULT_W)) / 2,
          y: (window.innerHeight - (saved?.h ?? DEFAULT_H)) / 2,
        },
  persist: (x, y) => persistGeom({ x, y }),
  onDragEnd: () => restoreFocus(),
})

const resize = useWindowResize({
  size,
  x: drag.x,
  y: drag.y,
  persist: (w, h) => persistGeom({ w, h }),
})

const dragging = drag.dragging
const resizing = resize.resizing

const winStyle = computed(() => ({
  ...drag.style.value,
  width: `${size.value.w}px`,
  height: `${size.value.h}px`,
  zIndex: store.zOf(props.plugin.id),
}))

function onWindowPointerDown() {
  store.focus(props.plugin.id)
}

const kbUnsubs = [
  subscribe('kb-open', () => {
    drag.reClamp()
    resize.clampSize()
  }),
  subscribe('kb-close', () => {
    drag.reClamp()
    resize.clampSize()
  }),
]

onBeforeUnmount(() => {
  kbUnsubs.forEach((u) => u())
})
</script>

<style scoped>
.float-window {
  position: absolute;
  top: 0;
  left: 0;
  display: flex;
  flex-direction: column;
  pointer-events: auto;
  background: var(--bg-main);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--dialog-shadow);
  overflow: hidden;
}
.float-titlebar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  flex: none;
  height: 30px;
  padding: 0 0.35rem 0 0.75rem;
  background: var(--bg-elevated);
  border-bottom: 1px solid var(--border);
  cursor: grab;
  user-select: none;
  touch-action: none;
}
.float-window.is-dragging .float-titlebar {
  cursor: grabbing;
}
.float-title {
  font-size: 12px;
  color: var(--fg-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.float-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  padding: 0;
  color: var(--fg-muted);
  background: transparent;
  border: none;
  border-radius: var(--radius);
  cursor: pointer;
}
.float-close:hover {
  color: var(--text-color);
  background: var(--bg-hover);
}
.float-body {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}
.float-resize-handle {
  position: absolute;
  right: 0;
  bottom: 0;
  width: 14px;
  height: 14px;
  cursor: nwse-resize;
  touch-action: none;
}
</style>
