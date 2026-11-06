<!--
  Image viewer: fit by default, Ctrl/Cmd+wheel anchored zoom, pointer drag,
  two-finger pinch, double-tap fit <-> 1:1 and keyboard controls.
  Geometry lives in `utils/imageZoom.ts`; this component wires it to the DOM.
-->
<template>
  <div
    ref="stageEl"
    class="image-preview"
    :class="{ 'is-ready': loaded, 'is-dragging': dragging }"
    :data-file-key="fileKey"
    data-testid="image-preview-stage"
    tabindex="0"
    @wheel="onWheel"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @pointercancel="onPointerCancel"
    @dblclick="onDblClick"
    @keydown="onKeyDown"
  >
    <img
      ref="imgEl"
      v-show="!loadFailed"
      class="image-preview-media"
      data-testid="image-preview-img"
      :src="src"
      :alt="alt"
      :style="imageStyle"
      draggable="false"
      @load="onImageLoad"
      @error="onImageError"
    />
    <div
      v-if="loadFailed"
      class="image-preview-error"
      data-testid="image-preview-error"
      role="alert"
    >
      {{ t('imagePreview.loadFailed') }}
    </div>
    <div
      class="image-preview-toolbar"
      role="toolbar"
      :aria-label="t('imagePreview.viewControls')"
      @pointerdown.stop
      @dblclick.stop
      @wheel.prevent.stop
    >
      <button
        type="button"
        class="image-preview-btn"
        data-testid="image-preview-zoom-out"
        :title="t('imagePreview.zoomOut')"
        :aria-label="t('imagePreview.zoomOut')"
        :disabled="!loaded"
        @click="zoomOut"
      >
        <ZoomOut />
      </button>
      <span
        class="image-preview-zoom"
        data-testid="image-preview-zoom-level"
        :title="t('imagePreview.zoomLevel')"
        >{{ percent }}%</span
      >
      <button
        type="button"
        class="image-preview-btn"
        data-testid="image-preview-zoom-in"
        :title="t('imagePreview.zoomIn')"
        :aria-label="t('imagePreview.zoomIn')"
        :disabled="!loaded"
        @click="zoomIn"
      >
        <ZoomIn />
      </button>
      <button
        type="button"
        class="image-preview-btn"
        data-testid="image-preview-fit"
        :title="t('imagePreview.fitToWindow')"
        :aria-label="t('imagePreview.fitToWindow')"
        :disabled="!loaded"
        @click="fitToWindow"
      >
        <Maximize2 />
      </button>
      <button
        type="button"
        class="image-preview-btn"
        data-testid="image-preview-actual"
        :title="t('imagePreview.actualSize')"
        :aria-label="t('imagePreview.actualSize')"
        :disabled="!loaded"
        @click="actualSize"
      >
        <Ratio />
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Maximize2, Ratio, ZoomIn, ZoomOut } from 'lucide-vue-next'
import { useI18n } from '../../composables/useI18n'
import {
  clampPan,
  clampScale,
  distance,
  fitScale,
  isValidSize,
  midpoint,
  nextZoom,
  normalizeWheelDelta,
  panBy,
  pinchTransform,
  zoomAt,
  type ImageViewMode,
  type ImageViewState,
  type Point,
  type Size,
} from '../../utils/imageZoom'

const props = withDefaults(
  defineProps<{
    src: string
    alt?: string
    fileKey?: string
  }>(),
  {
    alt: '',
    fileKey: '',
  }
)

const { t } = useI18n()

const stageEl = ref<HTMLDivElement | null>(null)
const imgEl = ref<HTMLImageElement | null>(null)
const natural = ref<Size>({ width: 0, height: 0 })
const view = ref<ImageViewState>({ scale: 1, tx: 0, ty: 0 })
const mode = ref<ImageViewMode>('fit')
const loaded = ref(false)
const loadFailed = ref(false)
const dragging = ref(false)
const hasLoadedForFile = ref(false)

const scale = computed(() => view.value.scale)
const percent = computed(() => Math.max(1, Math.round(view.value.scale * 100)))
const imageStyle = computed(() => ({
  transform: `translate(${view.value.tx}px, ${view.value.ty}px) scale(${view.value.scale})`,
}))

// --- viewport helpers -------------------------------------------------------

function viewportSize(): Size {
  const rect = stageEl.value?.getBoundingClientRect()
  return rect ? { width: rect.width, height: rect.height } : { width: 0, height: 0 }
}

/** Client coordinates -> viewport-centre-relative focal point. */
function focalPoint(clientX: number, clientY: number): Point {
  const rect = stageEl.value?.getBoundingClientRect()
  if (!rect) return { x: 0, y: 0 }
  return {
    x: clientX - rect.left - rect.width / 2,
    y: clientY - rect.top - rect.height / 2,
  }
}

// --- view changes -----------------------------------------------------------

function fitToWindow(): void {
  const viewport = viewportSize()
  const nextScale = fitScale(natural.value, viewport, 0, false)
  view.value = clampPan({ scale: nextScale, tx: 0, ty: 0 }, natural.value, viewport)
  mode.value = 'fit'
}

function actualSize(): void {
  const viewport = viewportSize()
  view.value = clampPan({ scale: 1, tx: 0, ty: 0 }, natural.value, viewport)
  mode.value = 'actual'
}

function zoomTo(nextScale: number, focal: Point = { x: 0, y: 0 }): void {
  if (!loaded.value) return
  const viewport = viewportSize()
  view.value = zoomAt(view.value, focal, nextScale, natural.value, viewport)
  mode.value = 'manual'
}

function zoomIn(): void {
  zoomTo(nextZoom(scale.value, 1))
}

function zoomOut(): void {
  zoomTo(nextZoom(scale.value, -1))
}

function toggleZoom(): void {
  if (mode.value === 'fit') actualSize()
  else fitToWindow()
}

function resetView(): void {
  fitToWindow()
}

// --- image loading ----------------------------------------------------------

function onImageLoad(): void {
  const img = imgEl.value
  if (!img) return

  natural.value = { width: img.naturalWidth, height: img.naturalHeight }
  loaded.value = isValidSize(natural.value)
  loadFailed.value = false
  dragging.value = false

  const firstLoad = !hasLoadedForFile.value
  hasLoadedForFile.value = true
  if (!loaded.value) return

  if (firstLoad || mode.value === 'fit') {
    fitToWindow()
  } else {
    // Same fileKey, new pixels (live SVG preview): keep zoom and offset.
    view.value = clampPan(view.value, natural.value, viewportSize())
  }
}

function onImageError(): void {
  loadFailed.value = true
  loaded.value = false
  dragging.value = false
  pointers.clear()
  pointerStarts.clear()
  dragStart = null
}

watch(
  () => props.src,
  () => {
    // A new source for the same fileKey must not reset the user's zoom;
    // the load handler re-fits only when the current mode is `fit`.
    loadFailed.value = false
  }
)

watch(
  () => props.fileKey,
  () => {
    // Only a different file resets the view. If the source did not actually
    // change, no `load` event will fire, so re-apply the dimensions we know.
    hasLoadedForFile.value = false
    loaded.value = false
    loadFailed.value = false
    dragging.value = false
    view.value = { scale: 1, tx: 0, ty: 0 }
    mode.value = 'fit'
    pointers.clear()
    pointerStarts.clear()
    dragStart = null
    lastTap = null
    void nextTick(() => {
      const img = imgEl.value
      if (img?.complete && img.naturalWidth > 0) onImageLoad()
    })
  }
)

// --- resize -----------------------------------------------------------------

let resizeObserver: ResizeObserver | null = null

function handleResize(): void {
  const viewport = viewportSize()
  if (!isValidSize(viewport)) return
  if (mode.value === 'fit') fitToWindow()
  else view.value = clampPan(view.value, natural.value, viewport)
}

onMounted(() => {
  const stage = stageEl.value
  if (!stage || typeof ResizeObserver === 'undefined') return
  resizeObserver = new ResizeObserver(handleResize)
  resizeObserver.observe(stage)
})

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  resizeObserver = null
})

// --- wheel ------------------------------------------------------------------

const WHEEL_ZOOM_SENSITIVITY = 0.002

function onWheel(event: WheelEvent): void {
  const viewport = viewportSize()

  if (event.ctrlKey || event.metaKey) {
    // Always swallow the browser's page zoom, even before the image loads.
    event.preventDefault()
    if (!loaded.value) return
    const delta = normalizeWheelDelta(event.deltaY, event.deltaMode, viewport.height)
    if (delta === 0) return
    const factor = Math.exp(-delta * WHEEL_ZOOM_SENSITIVITY)
    zoomTo(clampScale(scale.value * factor), focalPoint(event.clientX, event.clientY))
    return
  }

  // Plain wheel pans only after zooming in; at fit it is left to the page.
  if (mode.value === 'fit' || !loaded.value) return
  const dy = normalizeWheelDelta(event.deltaY, event.deltaMode, viewport.height)
  const dx = normalizeWheelDelta(event.deltaX, event.deltaMode, viewport.width)
  if (dx === 0 && dy === 0) return
  event.preventDefault()
  view.value = panBy(view.value, -dx, -dy, natural.value, viewport)
}

// --- pointers ---------------------------------------------------------------

const pointers = new Map<number, Point>()
const pointerStarts = new Map<number, Point>()
let dragStart: Point | null = null
let dragStartState: ImageViewState = { scale: 1, tx: 0, ty: 0 }
let pinchBase: ImageViewState = { scale: 1, tx: 0, ty: 0 }
let pinchStartMid: Point = { x: 0, y: 0 }
let pinchStartDist = 0
let gestureHadMultiple = false
let lastTap: { time: number; x: number; y: number } | null = null
let lastTouchEndAt = Number.NEGATIVE_INFINITY

const DOUBLE_TAP_MS = 300
const DOUBLE_TAP_DISTANCE = 24
const TAP_SLOP = 8
const KEY_PAN_STEP = 40

function capturePointer(event: PointerEvent): void {
  const target = stageEl.value
  if (!target || typeof target.setPointerCapture !== 'function') return
  try {
    target.setPointerCapture(event.pointerId)
  } catch {
    // Unsupported or the pointer already ended; dragging still works without it.
  }
}

function releasePointer(event: PointerEvent): void {
  const target = stageEl.value
  if (!target || typeof target.releasePointerCapture !== 'function') return
  try {
    target.releasePointerCapture(event.pointerId)
  } catch {
    // The capture may already be gone after pointercancel.
  }
}

function pinchGeometry(): { mid: Point; dist: number } | null {
  const points = Array.from(pointers.values())
  if (points.length < 2) return null
  const clientMid = midpoint(points[0], points[1])
  return {
    mid: focalPoint(clientMid.x, clientMid.y),
    dist: distance(points[0], points[1]),
  }
}

function startPinch(): void {
  const pinch = pinchGeometry()
  if (!pinch) return
  pinchBase = { ...view.value }
  pinchStartMid = pinch.mid
  pinchStartDist = pinch.dist
  dragging.value = false
}

function onPointerDown(event: PointerEvent): void {
  if (!loaded.value) return
  if (event.pointerType === 'mouse' && event.button !== 0) return

  stageEl.value?.focus({ preventScroll: true })
  capturePointer(event)

  const point = { x: event.clientX, y: event.clientY }
  pointers.set(event.pointerId, point)
  pointerStarts.set(event.pointerId, point)

  if (pointers.size === 1) {
    dragStart = point
    dragStartState = { ...view.value }
    gestureHadMultiple = false
  } else if (pointers.size === 2) {
    gestureHadMultiple = true
    dragStart = null
    startPinch()
  }
}

function onPointerMove(event: PointerEvent): void {
  if (!pointers.has(event.pointerId)) return
  pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })

  if (pointers.size >= 2) {
    const pinch = pinchGeometry()
    if (!pinch) return
    view.value = pinchTransform(
      pinchBase,
      pinchStartMid,
      pinchStartDist,
      pinch.mid,
      pinch.dist,
      natural.value,
      viewportSize()
    )
    mode.value = 'manual'
    return
  }

  if (!dragStart) return
  const point = pointers.get(event.pointerId)
  if (!point) return
  const dx = point.x - dragStart.x
  const dy = point.y - dragStart.y
  if (Math.abs(dx) > 1 || Math.abs(dy) > 1) dragging.value = true
  view.value = panBy(dragStartState, dx, dy, natural.value, viewportSize())
}

function finishPointer(event: PointerEvent, allowTap: boolean): void {
  if (!pointers.has(event.pointerId)) return
  const start = pointerStarts.get(event.pointerId)
  const end = { x: event.clientX, y: event.clientY }
  const wasSingle = pointers.size === 1

  pointers.delete(event.pointerId)
  pointerStarts.delete(event.pointerId)
  releasePointer(event)

  if (event.pointerType === 'touch') {
    if (allowTap && start && wasSingle && !gestureHadMultiple && distance(start, end) <= TAP_SLOP) {
      registerTouchTap(end)
    }
    if (pointers.size === 0) lastTouchEndAt = Date.now()
  }

  if (pointers.size === 1) {
    // Re-anchor so the remaining finger continues without a jump.
    const remaining = pointers.values().next().value
    dragStart = remaining ? { ...remaining } : null
    dragStartState = { ...view.value }
    pinchBase = { ...view.value }
    pinchStartDist = 0
    dragging.value = false
  } else if (pointers.size === 0) {
    dragStart = null
    dragging.value = false
    pinchStartDist = 0
  }
}

function onPointerUp(event: PointerEvent): void {
  finishPointer(event, true)
}

function onPointerCancel(event: PointerEvent): void {
  finishPointer(event, false)
}

function registerTouchTap(point: Point): void {
  const now = Date.now()
  if (
    lastTap &&
    now - lastTap.time <= DOUBLE_TAP_MS &&
    distance(lastTap, point) <= DOUBLE_TAP_DISTANCE
  ) {
    lastTap = null
    toggleZoom()
    return
  }
  lastTap = { time: now, x: point.x, y: point.y }
}

function onDblClick(): void {
  // Mobile browsers can synthesise dblclick after our own touch detection.
  if (Date.now() - lastTouchEndAt < 500) return
  if (!loaded.value) return
  toggleZoom()
}

// --- keyboard ---------------------------------------------------------------

function onKeyDown(event: KeyboardEvent): void {
  if (!loaded.value) return
  if (event.ctrlKey || event.metaKey || event.altKey) return

  switch (event.key) {
    case '+':
    case '=':
      event.preventDefault()
      zoomIn()
      break
    case '-':
    case '_':
      event.preventDefault()
      zoomOut()
      break
    case '0':
      event.preventDefault()
      fitToWindow()
      break
    case '1':
      event.preventDefault()
      actualSize()
      break
    case 'ArrowLeft':
      event.preventDefault()
      view.value = panBy(view.value, -KEY_PAN_STEP, 0, natural.value, viewportSize())
      break
    case 'ArrowRight':
      event.preventDefault()
      view.value = panBy(view.value, KEY_PAN_STEP, 0, natural.value, viewportSize())
      break
    case 'ArrowUp':
      event.preventDefault()
      view.value = panBy(view.value, 0, -KEY_PAN_STEP, natural.value, viewportSize())
      break
    case 'ArrowDown':
      event.preventDefault()
      view.value = panBy(view.value, 0, KEY_PAN_STEP, natural.value, viewportSize())
      break
    default:
      break
  }
}

defineExpose({
  scale,
  mode,
  fitToWindow,
  actualSize,
  zoomIn,
  zoomOut,
  resetView,
})
</script>

<style scoped>
.image-preview {
  position: relative;
  display: flex;
  flex: 1 1 0;
  min-width: 0;
  min-height: 0;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  background: var(--bg-surface, #141414);
  touch-action: none;
  user-select: none;
  -webkit-user-select: none;
  outline: none;
}

.image-preview.is-ready {
  cursor: grab;
}

.image-preview.is-dragging {
  cursor: grabbing;
}

.image-preview:focus-visible {
  outline: 1px solid var(--border-focus, #8a8a8a);
  outline-offset: -1px;
}

.image-preview-media {
  display: block;
  max-width: none;
  max-height: none;
  pointer-events: none;
  user-select: none;
  -webkit-user-select: none;
  -webkit-user-drag: none;
  will-change: transform;
}

.image-preview-error {
  max-width: 80%;
  padding: 12px 16px;
  color: var(--fg-muted, #888);
  font-family: var(--font-sans, sans-serif);
  font-size: clamp(12px, 2.6vmin, 16px);
  text-align: center;
}

.image-preview-toolbar {
  position: absolute;
  top: 8px;
  right: 8px;
  z-index: 2;
  display: flex;
  align-items: center;
  gap: 2px;
  max-width: calc(100% - 16px);
  padding: 3px;
  border: 1px solid var(--border, #444);
  border-radius: 6px;
  background: color-mix(in srgb, var(--tab-bg, #222) 92%, transparent);
  backdrop-filter: blur(6px);
}

.image-preview-btn {
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--fg-muted, #888);
  cursor: pointer;
  flex: 0 0 auto;
}

.image-preview-btn:hover:not(:disabled) {
  background: var(--bg-hover, #333);
  color: var(--fg-bright, #eee);
}

.image-preview-btn:disabled {
  opacity: 0.4;
  cursor: default;
}

.image-preview-btn:focus-visible {
  outline: 1px solid var(--border-focus, #8a8a8a);
  outline-offset: -1px;
}

.image-preview-btn svg {
  width: 14px;
  height: 14px;
}

.image-preview-zoom {
  min-width: 44px;
  padding: 0 2px;
  color: var(--fg-muted, #888);
  font-family: var(--font-sans, sans-serif);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  text-align: center;
  flex: 0 0 auto;
}

@media (max-width: 480px) {
  .image-preview-toolbar {
    top: 4px;
    right: 4px;
    gap: 0;
  }

  .image-preview-zoom {
    min-width: 36px;
    font-size: 11px;
  }

  .image-preview-btn {
    width: 24px;
    height: 24px;
  }
}
</style>
