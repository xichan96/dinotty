<template>
  <div
    v-if="mobile"
    class="outline-scrim"
    :class="{ show: open }"
    aria-hidden="true"
    @click="emit('close')"
  ></div>

  <aside
    :id="panelId"
    ref="panelEl"
    class="outline-panel"
    :class="{ open, mobile, resizing, swiping }"
    :aria-hidden="open ? 'false' : 'true'"
    :inert="!open"
    :aria-label="t('outline.title')"
    :style="{ '--panel-w': `${width}px`, '--panel-drag': `${swipeOffset}px` }"
  >
    <div
      class="resize-handle"
      :title="t('outline.resizeHint')"
      @pointerdown="onResizeStart"
      @dblclick="resetWidth"
    ></div>
    <div
      class="panel-grip"
      aria-hidden="true"
      @pointerdown="onSwipeStart"
      @pointermove="onSwipeMove"
      @pointerup="onSwipeEnd"
      @pointercancel="onSwipeEnd"
    ></div>

    <header
      class="panel-head"
      @pointerdown="onSwipeStart"
      @pointermove="onSwipeMove"
      @pointerup="onSwipeEnd"
      @pointercancel="onSwipeEnd"
    >
      <span class="panel-title">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.75"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M8 6h13M8 12h13M8 18h13" />
          <path d="M3 6h.01M3 12h.01M3 18h.01" />
        </svg>
        {{ t('outline.title') }}
      </span>
      <span class="count-pill">{{ countLabel }}</span>
      <span class="panel-spacer"></span>
      <button
        type="button"
        class="icon-btn"
        :title="t('outline.expandAll')"
        :aria-label="t('outline.expandAll')"
        @click="expandAll"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.75"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="m7 6 5-4 5 4M7 18l5 4 5-4M12 2v20" />
        </svg>
      </button>
      <button
        type="button"
        class="icon-btn"
        :title="t('outline.collapseAll')"
        :aria-label="t('outline.collapseAll')"
        @click="collapseAll"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.75"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="m7 9 5 4 5-4M7 15l5-4 5 4M12 2v20" />
        </svg>
      </button>
      <button
        type="button"
        class="icon-btn panel-close"
        :title="t('outline.close')"
        :aria-label="t('outline.close')"
        @click="emit('close')"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
        >
          <path d="M18 6 6 18M6 6l12 12" />
        </svg>
      </button>
    </header>

    <div class="panel-meta">
      <span class="file-glyph">
        <FileGlyph v-if="filePath" :path="filePath" :size="12" />
        <template v-else>·</template>
      </span>
      <span class="file-name" :title="filePath">{{ fileName }}</span>
      <span class="type-pill">{{ typeLabel }}</span>
      <span v-if="source.provider === 'regex'" class="source-pill" :title="t('outline.regexHint')">
        {{ t('outline.regex') }}
      </span>
    </div>

    <div class="search-wrap">
      <svg
        class="search-icon"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.75"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <circle cx="11" cy="11" r="7" />
        <path d="m21 21-4.3-4.3" />
      </svg>
      <input
        ref="filterEl"
        v-model="query"
        type="text"
        :placeholder="placeholder"
        :aria-label="t('outline.filterAria')"
        autocomplete="off"
        spellcheck="false"
      />
      <button
        v-if="query"
        type="button"
        class="search-clear"
        :title="t('outline.clearFilter')"
        :aria-label="t('outline.clearFilter')"
        @click="clearFilter"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
        >
          <path d="M18 6 6 18M6 6l12 12" />
        </svg>
      </button>
    </div>

    <div ref="scrollEl" class="outline-scroll" @scroll.passive="onScroll">
      <div v-if="source.status === 'error'" class="panel-empty">
        <span class="empty-icon warn">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.75"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path
              d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"
            />
            <path d="M12 9v4M12 17h.01" />
          </svg>
        </span>
        <span class="empty-title">{{ t('outline.parseError') }}</span>
        <span class="empty-desc">{{ t('outline.parseErrorDesc') }}</span>
        <span v-if="errorDetail" class="empty-detail">{{ errorDetail }}</span>
        <button type="button" class="empty-action" @click="emit('retry')">
          {{ t('outline.retry') }}
        </button>
      </div>

      <div v-else-if="source.status === 'empty'" class="panel-empty">
        <span class="empty-icon">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.75"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M8 6h13M8 12h9M8 18h5" />
            <path d="m17 15 5 5M22 15l-5 5" />
          </svg>
        </span>
        <span class="empty-title">{{ emptyTitle }}</span>
        <span class="empty-desc">{{ emptyDesc }}</span>
        <button type="button" class="empty-action" @click="emit('retry')">
          {{ t('outline.rescan') }}
        </button>
      </div>

      <div v-else-if="source.loading && rows.length === 0" class="panel-empty">
        <span class="empty-desc">{{ t('outline.loading') }}</span>
      </div>

      <div v-else-if="noMatches" class="panel-empty">
        <span class="empty-icon">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.75"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <circle cx="11" cy="11" r="7" />
            <path d="m21 21-4.3-4.3" />
          </svg>
        </span>
        <span class="empty-title">{{ t('outline.noMatches') }}</span>
        <span class="empty-desc">{{ t('outline.noMatchesDesc', { query: needle }) }}</span>
        <button type="button" class="empty-action" @click="clearFilter">
          {{ t('outline.clearFilter') }}
        </button>
      </div>

      <div v-else class="outline-tree" role="tree" :aria-label="t('outline.treeLabel')">
        <div
          v-if="virtualized && topPad > 0"
          class="outline-vpad"
          :style="{ height: `${topPad}px` }"
          aria-hidden="true"
        ></div>
        <div
          v-for="row in visibleRows"
          :key="row.item.id"
          class="outline-row"
          :class="{ active: row.item.id === activeId }"
          role="treeitem"
          :aria-level="row.depth + 1"
          :aria-expanded="hasChildren(row.item) ? isExpanded(row.item) : undefined"
          :data-outline-id="row.item.id"
          tabindex="0"
          @click="onRowClick(row.item)"
          @keydown.enter.prevent="onRowClick(row.item)"
          @keydown.space.prevent="onRowClick(row.item)"
          @keydown.right.prevent="onKeyRight(row.item)"
          @keydown.left.prevent="onKeyLeft(row.item)"
        >
          <span v-if="row.depth > 0" class="guides" aria-hidden="true">
            <i v-for="guide in row.depth" :key="guide"></i>
          </span>
          <span
            v-if="hasChildren(row.item)"
            class="chev"
            :class="{ open: isExpanded(row.item) }"
            role="button"
            :aria-label="isExpanded(row.item) ? t('outline.collapse') : t('outline.expand')"
            @click.stop="toggle(row.item.id)"
            @keydown.enter.stop.prevent="toggle(row.item.id)"
            @keydown.space.stop.prevent="toggle(row.item.id)"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="m9 18 6-6-6-6" />
            </svg>
          </span>
          <span v-else class="chev-spacer"></span>
          <span class="row-icon">
            <span :class="iconClass(row.item)">{{ iconText(row.item) }}</span>
          </span>
          <span class="row-label">
            <template v-for="(part, index) in labelSegments(row.item.label)" :key="index">
              <mark v-if="part.match">{{ part.text }}</mark>
              <template v-else>{{ part.text }}</template>
            </template>
          </span>
          <span class="row-meta" :class="{ value: source.mode === 'json' }">{{
            metaFor(row.item)
          }}</span>
        </div>
        <div
          v-if="virtualized && bottomPad > 0"
          class="outline-vpad"
          :style="{ height: `${bottomPad}px` }"
          aria-hidden="true"
        ></div>
      </div>
    </div>

    <footer class="panel-foot">
      <span class="panel-hint">{{ hint }}</span>
      <span v-if="!mobile" class="width-readout">{{ t('outline.width', { width }) }}</span>
    </footer>
  </aside>

  <button
    v-if="mobile && !open"
    type="button"
    class="outline-fab"
    :aria-label="t('outline.open')"
    :title="t('outline.open')"
    @click="emit('open')"
  >
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.75"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <path d="M8 6h13M8 12h13M8 18h13" />
      <path d="M3 6h.01M3 12h.01M3 18h.01" />
    </svg>
  </button>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from '../../composables/useI18n'
import FileGlyph from './FileGlyph.vue'
import type { OutlineItem, OutlineMode, OutlineSource } from '../../types/outline'
import {
  defaultExpandedIds,
  expandableIds,
  findOutlineEntry,
  outlineRows,
} from '../../utils/outlineTree'
import { shouldCloseOnSwipe } from '../../utils/outlineSwipe'
import {
  OUTLINE_ROW_HEIGHT,
  OUTLINE_ROW_HEIGHT_MOBILE,
  OUTLINE_VIRTUALIZE_THRESHOLD,
  virtualWindow,
} from '../../utils/outlineVirtual'

const props = withDefaults(
  defineProps<{
    open: boolean
    mobile: boolean
    source: OutlineSource
    mode: Exclude<OutlineMode, 'none'>
    activeId?: string
    filePath?: string
    languageLabel?: string
    panelId?: string
  }>(),
  {
    activeId: '',
    filePath: '',
    languageLabel: '',
    panelId: 'outline-panel',
  }
)

const emit = defineEmits<{
  close: []
  open: []
  reveal: [item: OutlineItem]
  retry: []
  'update:activeId': [id: string]
}>()

const { t } = useI18n()

const MIN_WIDTH = 220
const MAX_WIDTH = 480
const DEFAULT_WIDTH = 300
const WIDTH_KEY = 'dinotty.outline.width'

const panelEl = ref<HTMLElement | null>(null)
const scrollEl = ref<HTMLElement | null>(null)
const filterEl = ref<HTMLInputElement | null>(null)
const query = ref('')
const resizing = ref(false)
const width = ref(loadWidth())

const expanded = ref<Set<string>>(new Set())
let expansionReady = false

let scrollFrame: number | null = null
let resizeObserver: ResizeObserver | null = null
let swipeState: { pointerId: number; startY: number; startTime: number; dy: number } | null = null

const needle = computed(() => query.value.trim())
const stats = computed(() => outlineRows(props.source.items, expanded.value, query.value))
const rows = computed(() => stats.value.rows)

const scrollTop = ref(0)
const viewportHeight = ref(0)
const swipeOffset = ref(0)
const swiping = ref(false)

const virtualized = computed(() => rows.value.length > OUTLINE_VIRTUALIZE_THRESHOLD)
const rowHeight = computed(() =>
  props.mobile ? OUTLINE_ROW_HEIGHT_MOBILE : OUTLINE_ROW_HEIGHT
)
const windowState = computed(() =>
  virtualWindow(
    rows.value.length,
    scrollTop.value,
    viewportHeight.value,
    rowHeight.value
  )
)
const visibleRows = computed(() => {
  if (!virtualized.value) return rows.value
  return rows.value.slice(windowState.value.start, windowState.value.end)
})
const topPad = computed(() => (virtualized.value ? windowState.value.topPad : 0))
const bottomPad = computed(() => (virtualized.value ? windowState.value.bottomPad : 0))

const noMatches = computed(
  () => props.source.status === 'ok' && needle.value.length > 0 && stats.value.matches === 0
)

const countLabel = computed(() => {
  if (props.source.status === 'error') return '!'
  if (props.source.status === 'empty') return '0'
  if (needle.value) return `${stats.value.matches}/${stats.value.total}`
  return String(stats.value.total)
})

const errorDetail = computed(() => {
  const line = props.source.errorLine
  const message = props.source.message ?? ''
  if (!line) return message
  return message ? t('outline.errorLine', { line, message }) : t('outline.errorLineOnly', { line })
})

const placeholder = computed(() => {
  if (props.mode === 'markdown') return t('outline.filterHeadings')
  if (props.mode === 'json') return t('outline.filterKeys')
  return t('outline.filterSymbols')
})

const emptyTitle = computed(() => {
  if (props.mode === 'markdown') return t('outline.emptyHeadings')
  if (props.mode === 'json') return t('outline.emptyKeys')
  return t('outline.emptySymbols')
})

const emptyDesc = computed(() => {
  if (props.mode === 'markdown') return t('outline.emptyHeadingsDesc')
  if (props.mode === 'json') return t('outline.emptyKeysDesc')
  return t('outline.emptySymbolsDesc')
})

const fileName = computed(() => props.filePath.split('/').pop() || props.filePath)
const typeLabel = computed(() => {
  if (props.languageLabel) return props.languageLabel
  if (props.mode === 'markdown') return t('outline.typeMarkdown')
  if (props.mode === 'json') return t('outline.typeJson')
  return t('outline.typeCode')
})
const hint = computed(() => (props.mobile ? t('outline.closeHintMobile') : t('outline.closeHint')))

watch(
  () => props.filePath,
  () => {
    expansionReady = false
    expanded.value = new Set()
  },
  { immediate: true }
)

watch(
  () => props.source.items,
  (items) => {
    if (expansionReady || items.length === 0) return
    expansionReady = true
    expanded.value = defaultExpandedIds(items)
  },
  { immediate: true }
)

// Do not leave focus inside an aria-hidden/inert subtree; reset swipe state.
watch(
  () => props.open,
  (open) => {
    if (open) {
      void nextTick(syncScrollMetrics)
      return
    }
    swipeOffset.value = 0
    swiping.value = false
    swipeState = null
    const active = document.activeElement
    if (active instanceof HTMLElement && panelEl.value?.contains(active)) active.blur()
  }
)

// Rows, expansion and filtering all change the total height; re-measure after
// the DOM settles so the window never straddles a stale scroll position.
watch(
  [rows, () => props.mobile],
  () => {
    void nextTick(syncScrollMetrics)
  }
)

// A spy hit inside a manually collapsed branch must stay visible, and a
// virtualized row outside the window must be scrolled into view.
watch(
  () => props.activeId,
  (id) => {
    if (!id) return
    const entry = findOutlineEntry(props.source.items, id)
    if (entry && entry.parents.length > 0) {
      const missing = entry.parents.filter((parent) => !expanded.value.has(parent))
      if (missing.length > 0) {
        const next = new Set(expanded.value)
        for (const parent of missing) next.add(parent)
        expanded.value = next
      }
    }
    void ensureActiveRowVisible(id)
  }
)

function loadWidth(): number {
  try {
    const stored = Number(localStorage.getItem(WIDTH_KEY))
    if (Number.isFinite(stored) && stored > 0) return clampWidth(stored)
  } catch {
    // Storage can be unavailable in private or test contexts.
  }
  return DEFAULT_WIDTH
}

function clampWidth(value: number, max = MAX_WIDTH): number {
  return Math.min(Math.max(MIN_WIDTH, Math.round(value)), Math.max(MIN_WIDTH, max))
}

function persistWidth(): void {
  try {
    localStorage.setItem(WIDTH_KEY, String(width.value))
  } catch {
    // Ignore storage failures; the in-memory width still applies.
  }
}

function onResizeStart(event: PointerEvent): void {
  if (props.mobile) return
  event.preventDefault()
  resizing.value = true
  document.body.classList.add('outline-resizing')
}

function onPointerMove(event: PointerEvent): void {
  if (!resizing.value) return
  const parent = panelEl.value?.parentElement
  const rect = parent?.getBoundingClientRect()
  const right = rect?.right ?? window.innerWidth
  const max = Math.min(MAX_WIDTH, (rect?.width ?? window.innerWidth) - 64)
  width.value = clampWidth(right - event.clientX, max)
}

function endResize(): void {
  if (!resizing.value) return
  resizing.value = false
  document.body.classList.remove('outline-resizing')
  persistWidth()
}

function resetWidth(): void {
  width.value = DEFAULT_WIDTH
  persistWidth()
}

function isExpanded(item: OutlineItem): boolean {
  return needle.value.length > 0 || expanded.value.has(item.id)
}

function hasChildren(item: OutlineItem): boolean {
  return !!item.children && item.children.length > 0
}

function toggle(id: string): void {
  const next = new Set(expanded.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  expanded.value = next
}

function expandAll(): void {
  expanded.value = new Set(expandableIds(props.source.items))
}

function collapseAll(): void {
  expanded.value = new Set()
}

function onKeyRight(item: OutlineItem): void {
  if (!hasChildren(item) || expanded.value.has(item.id)) return
  toggle(item.id)
}

function onKeyLeft(item: OutlineItem): void {
  if (!hasChildren(item) || !expanded.value.has(item.id)) return
  toggle(item.id)
}

function clearFilter(): void {
  query.value = ''
  filterEl.value?.focus()
}

function onRowClick(item: OutlineItem): void {
  emit('update:activeId', item.id)
  emit('reveal', item)
  void ensureRowVisible(item)
}

function syncScrollMetrics(): void {
  const element = scrollEl.value
  if (!element) return
  scrollTop.value = element.scrollTop
  viewportHeight.value = element.clientHeight
}

function measureViewport(): void {
  viewportHeight.value = scrollEl.value?.clientHeight ?? 0
}

function onScroll(): void {
  if (!virtualized.value || scrollFrame !== null) return
  scrollFrame = requestAnimationFrame(() => {
    scrollFrame = null
    if (scrollEl.value) scrollTop.value = scrollEl.value.scrollTop
  })
}

/** Move the scroll position so a row index is inside the rendered window. */
function scrollIndexIntoView(index: number): void {
  if (!virtualized.value || index < 0) return
  const element = scrollEl.value
  const height = viewportHeight.value || element?.clientHeight || 0
  const top = index * rowHeight.value
  const bottom = top + rowHeight.value
  const current = element?.scrollTop ?? scrollTop.value
  if (top >= current && bottom <= current + height) return
  if (element) element.scrollTop = top
  scrollTop.value = top
}

async function ensureRowVisible(item: OutlineItem): Promise<void> {
  const index = rows.value.findIndex((row) => row.item.id === item.id)
  scrollIndexIntoView(index)
  await nextTick()
  const target = Array.from(
    scrollEl.value?.querySelectorAll<HTMLElement>('[data-outline-id]') ?? []
  ).find((element) => element.dataset.outlineId === item.id)
  if (target && typeof target.scrollIntoView === 'function') {
    target.scrollIntoView({ block: 'nearest' })
  }
}

async function ensureActiveRowVisible(id: string): Promise<void> {
  await nextTick()
  const row = rows.value.find((entry) => entry.item.id === id)
  if (row) await ensureRowVisible(row.item)
}

/* ── Mobile swipe-to-close ─────────────────────────────────────────────── */

function isInteractiveTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false
  return !!target.closest('button, input, a, [role="button"]')
}

function onSwipeStart(event: PointerEvent): void {
  if (!props.mobile || !props.open) return
  if (event.button !== 0 || isInteractiveTarget(event.target)) return
  swipeState = {
    pointerId: event.pointerId,
    startY: event.clientY,
    startTime: performance.now(),
    dy: 0,
  }
  swiping.value = true
  swipeOffset.value = 0
  event.preventDefault()
  try {
    ;(event.currentTarget as HTMLElement | null)?.setPointerCapture(event.pointerId)
  } catch {
    // Pointer capture is an optimization; the handlers still work without it.
  }
}

function onSwipeMove(event: PointerEvent): void {
  if (!swipeState || event.pointerId !== swipeState.pointerId) return
  const dy = Math.max(0, event.clientY - swipeState.startY)
  swipeState.dy = dy
  swipeOffset.value = dy
  if (dy > 0) event.preventDefault()
}

function onSwipeEnd(event: PointerEvent): void {
  if (!swipeState || event.pointerId !== swipeState.pointerId) return
  const state = swipeState
  swipeState = null
  swiping.value = false

  const surface = event.currentTarget as HTMLElement | null
  try {
    if (surface?.hasPointerCapture?.(event.pointerId)) {
      surface.releasePointerCapture(event.pointerId)
    }
  } catch {
    // Already released.
  }

  const elapsed = Math.max(1, performance.now() - state.startTime)
  if (shouldCloseOnSwipe(state.dy, state.dy / elapsed)) {
    // Keep the dragged offset until the `open` watcher resets it, so the
    // sheet animates out from where the finger left it.
    emit('close')
    return
  }
  swipeOffset.value = 0
}

function iconText(item: OutlineItem): string {
  if (item.kind === 'heading') return `H${item.level ?? 1}`
  switch (item.kind) {
    case 'interface':
      return '<>'
    case 'class':
      return 'C'
    case 'function':
    case 'method':
      return 'ƒ'
    case 'property':
      return '•'
    case 'const':
      return 'c'
    case 'type':
      return 'T'
    case 'object':
      return '{}'
    case 'array':
      return '[]'
    default:
      return '·'
  }
}

function iconClass(item: OutlineItem): string {
  if (item.kind === 'heading') return 'hbadge'
  if (item.kind === 'function' || item.kind === 'method') return 'kind-fn'
  if (item.kind === 'object' || item.kind === 'property') return `kind-${item.kind}`
  if (item.kind === 'array') return 'kind-array'
  if (item.kind === 'scalar') return 'kind-leaf'
  return `kind-${item.kind}`
}

interface LabelSegment {
  text: string
  match: boolean
}

function labelSegments(label: string): LabelSegment[] {
  const value = needle.value
  if (!value) return [{ text: label, match: false }]
  const lower = label.toLowerCase()
  const target = value.toLowerCase()
  const parts: LabelSegment[] = []
  let cursor = 0
  let at = lower.indexOf(target)
  while (at >= 0) {
    if (at > cursor) parts.push({ text: label.slice(cursor, at), match: false })
    parts.push({ text: label.slice(at, at + target.length), match: true })
    cursor = at + target.length
    at = lower.indexOf(target, cursor)
  }
  if (cursor < label.length) parts.push({ text: label.slice(cursor), match: false })
  return parts
}

function metaFor(item: OutlineItem): string {
  if (props.source.mode === 'json') return item.value ?? ''
  return String(item.line)
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable
}

function onKeydown(event: KeyboardEvent): void {
  if (!props.open) return
  if (event.key === 'Escape') {
    event.preventDefault()
    if (document.activeElement === filterEl.value) filterEl.value?.blur()
    emit('close')
    return
  }
  if (event.key === '/' && !isTypingTarget(event.target)) {
    event.preventDefault()
    filterEl.value?.focus()
    filterEl.value?.select()
  }
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
  window.addEventListener('pointermove', onPointerMove)
  window.addEventListener('pointerup', endResize)
  window.addEventListener('pointercancel', endResize)
  window.addEventListener('resize', measureViewport)
  measureViewport()
  if (scrollEl.value && typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(measureViewport)
    resizeObserver.observe(scrollEl.value)
  }
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  window.removeEventListener('pointermove', onPointerMove)
  window.removeEventListener('pointerup', endResize)
  window.removeEventListener('pointercancel', endResize)
  window.removeEventListener('resize', measureViewport)
  resizeObserver?.disconnect()
  resizeObserver = null
  if (scrollFrame !== null) {
    cancelAnimationFrame(scrollFrame)
    scrollFrame = null
  }
  document.body.classList.remove('outline-resizing')
})
</script>

<style scoped>
.outline-panel {
  position: absolute;
  /* Start below FilePreviewContent's editor chrome (tabs + outline + save)
     so opening the outline never hides the toolbar that closes it. */
  top: 37px;
  right: 0;
  bottom: 0;
  z-index: 40;
  width: var(--panel-w, 300px);
  max-width: calc(100% - 64px);
  display: flex;
  flex-direction: column;
  background: var(--bg-surface, #252526);
  border-left: 1px solid var(--border, #3c3c3c);
  box-shadow:
    -18px 0 44px rgba(0, 0, 0, 0.46),
    -1px 0 0 rgba(255, 255, 255, 0.035),
    inset 1px 0 0 rgba(255, 255, 255, 0.025);
  transform: translateX(calc(100% + 26px));
  opacity: 0;
  visibility: hidden;
  transition:
    transform 0.18s cubic-bezier(0.2, 0, 0, 1),
    opacity 0.18s ease,
    visibility 0s linear 0.18s;
}

.outline-panel.open {
  transform: translateX(0);
  opacity: 1;
  visibility: visible;
  transition:
    transform 0.18s cubic-bezier(0.2, 0, 0, 1),
    opacity 0.18s ease,
    visibility 0s;
}

.outline-panel::before {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  left: -22px;
  width: 22px;
  pointer-events: none;
  background: linear-gradient(to right, rgba(0, 0, 0, 0), rgba(0, 0, 0, 0.22));
}

.outline-panel.resizing,
.outline-panel.swiping {
  transition: none;
  user-select: none;
}

.resize-handle {
  position: absolute;
  top: 0;
  bottom: 0;
  left: -4px;
  width: 8px;
  z-index: 3;
  cursor: col-resize;
  touch-action: none;
}

.resize-handle::after {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  left: 3px;
  width: 2px;
  background: transparent;
  transition: background 0.12s;
}

.resize-handle:hover::after,
.outline-panel.resizing .resize-handle::after {
  background: var(--accent, #8a8a8a);
}

.panel-grip {
  display: none;
}

.panel-head {
  flex: 0 0 auto;
  height: 38px;
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 0 7px 0 12px;
  border-bottom: 1px solid var(--divider, #2d2d2d);
}

.panel-title {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--fg-bright, #d0d0d0);
  font-size: 11.5px;
  font-weight: 600;
  letter-spacing: 0.03em;
  white-space: nowrap;
}

.panel-title svg {
  width: 13px;
  height: 13px;
  color: var(--fg-muted, #858585);
}

.count-pill {
  min-width: 20px;
  height: 16px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0 5px;
  border-radius: 999px;
  background: var(--bg-hover, #2a2a2c);
  color: var(--fg-muted, #858585);
  font-family: var(--font-mono, monospace);
  font-size: 9px;
  font-variant-numeric: tabular-nums;
}

.panel-spacer {
  flex: 1;
}

.icon-btn {
  width: 24px;
  height: 24px;
  display: grid;
  place-items: center;
  border: none;
  background: none;
  border-radius: var(--radius, 4px);
  color: var(--fg-muted, #858585);
  cursor: pointer;
  flex: 0 0 auto;
}

.icon-btn:hover {
  background: var(--bg-hover, #2a2a2c);
  color: var(--fg-bright, #d0d0d0);
}

.icon-btn:focus-visible {
  outline: 1px solid var(--border-focus, #8a8a8a);
  outline-offset: -1px;
}

.icon-btn svg {
  width: 13px;
  height: 13px;
}

.panel-close {
  margin-left: 1px;
}

.panel-meta {
  flex: 0 0 auto;
  height: 27px;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 12px;
  border-bottom: 1px solid var(--divider, #2d2d2d);
  background: rgba(24, 24, 24, 0.35);
}

.file-glyph {
  width: 17px;
  height: 15px;
  display: grid;
  place-items: center;
  border: 1px solid var(--border, #3c3c3c);
  border-radius: 3px;
  background: var(--bg-hover, #2a2a2c);
  color: var(--fg-muted, #858585);
  font-family: var(--font-mono, monospace);
  font-size: 7px;
  font-weight: 600;
  flex: 0 0 auto;
  overflow: hidden;
}

.file-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--fg-muted, #858585);
  font-size: 10.5px;
}

.type-pill,
.source-pill {
  flex: 0 0 auto;
  border: 1px solid var(--border, #3c3c3c);
  border-radius: 999px;
  padding: 0 6px;
  color: var(--fg-muted, #858585);
  font-size: 9px;
  letter-spacing: 0.03em;
  white-space: nowrap;
}

.type-pill {
  margin-left: auto;
}

.source-pill {
  color: var(--color-yellow, #d7ba7d);
  border-color: transparent;
  padding-right: 0;
}

.search-wrap {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 8px 8px 6px;
  height: 30px;
  padding: 0 7px;
  border: 1px solid var(--border, #3c3c3c);
  border-radius: var(--radius, 4px);
  background: var(--bg-input, #2a2a2c);
  transition:
    border-color 0.12s,
    box-shadow 0.12s;
}

.search-wrap:focus-within {
  border-color: var(--border-focus, #8a8a8a);
  box-shadow: 0 0 0 1px rgba(138, 138, 138, 0.18);
}

.search-icon {
  width: 13px;
  height: 13px;
  color: var(--fg-muted, #858585);
  flex: 0 0 auto;
}

.search-wrap input {
  flex: 1;
  min-width: 0;
  height: 100%;
  border: 0;
  outline: 0;
  background: transparent;
  color: var(--fg-bright, #d0d0d0);
  font-family: inherit;
  font-size: 11.5px;
}

.search-wrap input::placeholder {
  color: #6f6f6f;
}

.search-clear {
  width: 18px;
  height: 18px;
  display: grid;
  place-items: center;
  border: none;
  border-radius: 3px;
  background: none;
  color: var(--fg-muted, #858585);
  cursor: pointer;
  flex: 0 0 auto;
}

.search-clear:hover {
  background: var(--bg-hover, #2a2a2c);
  color: var(--fg-bright, #d0d0d0);
}

.search-clear svg {
  width: 11px;
  height: 11px;
}

.outline-scroll {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
  overscroll-behavior: contain;
  padding: 1px 0 8px;
  scrollbar-width: thin;
  scrollbar-color: var(--scrollbar-thumb, #4a4a4a) transparent;
}

.outline-tree {
  display: flex;
  flex-direction: column;
  min-height: 100%;
}

/* Exact-height spacer that stands in for rows outside the virtual window. */
.outline-vpad {
  flex: 0 0 auto;
  pointer-events: none;
}

.outline-row {
  display: flex;
  align-items: center;
  width: 100%;
  height: 26px;
  padding: 0 8px 0 5px;
  color: var(--fg, #cccccc);
  font-size: 12px;
  text-align: left;
  white-space: nowrap;
  position: relative;
  flex: 0 0 auto;
  cursor: default;
  outline: none;
}

.outline-row:hover {
  background: var(--bg-hover, #2a2a2c);
  color: var(--fg-bright, #d0d0d0);
}

.outline-row:focus-visible {
  outline: 1px solid var(--border-focus, #8a8a8a);
  outline-offset: -1px;
}

.outline-row.active {
  background: var(--palette-select, #2a2d2e);
  color: var(--fg-bright, #d0d0d0);
}

.outline-row.active::before {
  content: '';
  position: absolute;
  left: 0;
  top: 3px;
  bottom: 3px;
  width: 2px;
  border-radius: 0 1px 1px 0;
  background: var(--accent, #8a8a8a);
}

.guides {
  display: flex;
  align-self: stretch;
  flex: 0 0 auto;
  pointer-events: none;
}

.guides i {
  width: 12px;
  height: 100%;
  flex: 0 0 12px;
  background-image: linear-gradient(
    to right,
    transparent 5px,
    rgba(255, 255, 255, 0.065) 5px,
    rgba(255, 255, 255, 0.065) 6px,
    transparent 6px
  );
}

.chev {
  width: 15px;
  height: 15px;
  display: grid;
  place-items: center;
  border-radius: 3px;
  color: var(--fg-muted, #858585);
  flex: 0 0 15px;
  margin-right: 1px;
  cursor: pointer;
}

.chev:hover {
  background: var(--bg-surface-hover, #333333);
  color: var(--fg-bright, #d0d0d0);
}

.chev svg {
  width: 11px;
  height: 11px;
  transition: transform 0.12s ease;
}

.chev.open svg {
  transform: rotate(90deg);
}

.chev-spacer {
  width: 15px;
  height: 15px;
  flex: 0 0 15px;
  margin-right: 1px;
}

.row-icon {
  width: 16px;
  height: 16px;
  display: grid;
  place-items: center;
  flex: 0 0 16px;
  margin-right: 5px;
  font-family: var(--font-mono, monospace);
  font-size: 9px;
  line-height: 1;
}

.hbadge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 13px;
  padding: 0 3px;
  border: 1px solid var(--border-hover, #555555);
  border-radius: 2px;
  color: var(--fg-muted, #858585);
  font-size: 7.5px;
  letter-spacing: 0.02em;
  font-weight: 500;
}

.outline-row.active .hbadge {
  border-color: #6f6f6f;
  color: var(--fg-bright, #d0d0d0);
}

.kind-interface,
.kind-type {
  color: var(--color-cyan, #4ec9b0);
}

.kind-class,
.kind-const,
.kind-array {
  color: var(--color-yellow, #d7ba7d);
}

.kind-fn {
  color: var(--color-magenta, #c586c0);
  font-size: 11px;
  font-style: italic;
}

.kind-property,
.kind-object {
  color: var(--color-blue, #569cd6);
  font-size: 12px;
}

.kind-leaf {
  color: #9a9a9a;
  font-size: 12px;
}

.row-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.row-label mark {
  background: rgba(215, 186, 125, 0.24);
  color: #efdfbb;
  border-radius: 2px;
  padding: 0 1px;
}

.row-meta {
  margin-left: auto;
  padding-left: 8px;
  color: #6f6f6f;
  font-family: var(--font-mono, monospace);
  font-size: 9.5px;
  font-variant-numeric: tabular-nums;
  flex: 0 0 auto;
  white-space: nowrap;
}

.outline-row.active .row-meta {
  color: var(--fg-muted, #858585);
}

.row-meta.value {
  max-width: 92px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.panel-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 7px;
  min-height: 100%;
  padding: 40px 22px;
  text-align: center;
}

.empty-icon {
  width: 36px;
  height: 36px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  background: var(--bg-hover, #2a2a2c);
  border: 1px solid var(--border, #3c3c3c);
  color: var(--fg-muted, #858585);
  margin-bottom: 2px;
}

.empty-icon svg {
  width: 17px;
  height: 17px;
}

.empty-icon.warn {
  color: var(--color-yellow, #d7ba7d);
}

.empty-title {
  color: var(--fg-bright, #d0d0d0);
  font-size: 12px;
  font-weight: 600;
}

.empty-desc {
  max-width: 220px;
  color: var(--fg-muted, #858585);
  font-size: 11px;
  line-height: 1.5;
}

.empty-detail {
  font-family: var(--font-mono, monospace);
  font-size: 9.5px;
  color: var(--color-red, #f44747);
  opacity: 0.85;
  max-width: 230px;
  overflow-wrap: anywhere;
}

.empty-action {
  margin-top: 5px;
  height: 24px;
  padding: 0 10px;
  border: 1px solid var(--border, #3c3c3c);
  border-radius: var(--radius, 4px);
  background: var(--bg-hover, #2a2a2c);
  color: var(--fg, #cccccc);
  font-size: 10.5px;
  cursor: pointer;
}

.empty-action:hover {
  border-color: var(--border-hover, #555555);
  background: var(--bg-surface-hover, #333333);
  color: var(--fg-bright, #d0d0d0);
}

.panel-foot {
  flex: 0 0 auto;
  height: 26px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 11px;
  border-top: 1px solid var(--divider, #2d2d2d);
  color: #6f6f6f;
  font-size: 9.5px;
  white-space: nowrap;
  overflow: hidden;
}

.panel-hint {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.width-readout {
  margin-left: auto;
  color: var(--fg-muted, #858585);
  font-family: var(--font-mono, monospace);
  font-variant-numeric: tabular-nums;
}

.outline-scrim {
  position: absolute;
  inset: 0;
  z-index: 30;
  background: rgba(0, 0, 0, 0.45);
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.18s ease;
}

.outline-scrim.show {
  opacity: 1;
  pointer-events: auto;
}

.outline-fab {
  position: absolute;
  right: 16px;
  bottom: 16px;
  z-index: 25;
  width: 46px;
  height: 46px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  border: 1px solid var(--border-hover, #555555);
  background: var(--bg-surface, #252526);
  color: var(--fg, #cccccc);
  cursor: pointer;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
  transition:
    background 0.12s,
    opacity 0.16s;
}

.outline-fab:hover {
  background: var(--bg-surface-hover, #333333);
  color: var(--fg-bright, #d0d0d0);
}

.outline-fab svg {
  width: 20px;
  height: 20px;
}

/* ── Mobile bottom sheet ─────────────────────────────────────────────────── */
.outline-panel.mobile {
  top: auto;
  left: 0;
  right: 0;
  bottom: 0;
  width: auto !important;
  max-width: none;
  height: 72%;
  border-left: 0;
  border-top: 1px solid var(--border, #3c3c3c);
  border-radius: 16px 16px 0 0;
  background: var(--bg-surface, #252526);
  box-shadow: 0 -18px 44px rgba(0, 0, 0, 0.5);
  transform: translateY(104%);
  opacity: 1;
  visibility: visible;
  transition:
    transform 0.22s cubic-bezier(0.2, 0, 0, 1),
    visibility 0s linear 0.22s;
}

.outline-panel.mobile::before {
  display: none;
}

.outline-panel.mobile.open {
  transform: translateY(var(--panel-drag, 0px));
  visibility: visible;
  transition: transform 0.22s cubic-bezier(0.2, 0, 0, 1);
}

.outline-panel.mobile .panel-grip,
.outline-panel.mobile .panel-head {
  touch-action: none;
}

/* Beat `.outline-panel.mobile.open`'s transition while a drag is live. */
.outline-panel.mobile.swiping {
  transition: none;
}

.outline-panel.mobile .resize-handle {
  display: none;
}

.outline-panel.mobile .panel-grip {
  display: block;
  width: 34px;
  height: 4px;
  margin: 7px auto 3px;
  border-radius: 999px;
  background: #4a4a4a;
  flex: 0 0 auto;
}

.outline-panel.mobile .panel-head {
  height: 34px;
  border-bottom: 0;
}

.outline-panel.mobile .panel-meta {
  background: transparent;
}

.outline-panel.mobile .outline-row {
  height: 32px;
  font-size: 12.5px;
}

.outline-panel.mobile .search-wrap {
  height: 34px;
  margin: 8px 10px;
}

.outline-panel.mobile .panel-foot {
  height: 28px;
}

@media (prefers-reduced-motion: reduce) {
  .outline-panel,
  .outline-panel.open,
  .outline-panel.mobile,
  .outline-panel.mobile.open,
  .outline-scrim,
  .chev svg {
    transition: none !important;
    animation: none !important;
  }
}
</style>

<style>
body.outline-resizing,
body.outline-resizing * {
  cursor: col-resize !important;
  user-select: none !important;
}
</style>
