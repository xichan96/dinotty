<template>
  <div
    class="editor-tab-bar"
    :class="{ 'strip-drop': stripDrop }"
    @dragover.prevent="onStripDragOver"
    @dragleave="onStripDragLeave"
    @drop.prevent="onStripDrop"
  >
    <div
      ref="tabsEl"
      class="editor-tabs"
      :class="{ 'fade-left': fadeLeft, 'fade-right': fadeRight }"
      @wheel="onWheel"
      @scroll="updateFade"
    >
      <div
        v-for="tab in tabs"
        :key="tab.id"
        class="editor-tab"
        :class="{
          active: tab.id === activeTabId,
          preview: tab.preview,
          dirty: isDirty(tab),
          dragging: draggingTabId === tab.id,
          'drop-before': dropTarget?.tabId === tab.id && !dropTarget.after,
          'drop-after': dropTarget?.tabId === tab.id && dropTarget.after,
        }"
        role="tab"
        :aria-selected="tab.id === activeTabId"
        :title="tab.filePath"
        draggable="true"
        @click="$emit('activate', tab.id)"
        @dblclick="$emit('pin', tab.id)"
        @auxclick.prevent="onAuxClick($event, tab.id)"
        @contextmenu.prevent="openMenu($event, tab)"
        @dragstart="onTabDragStart($event, tab)"
        @dragend="onTabDragEnd"
        @dragover.stop.prevent="onTabDragOver($event, tab)"
        @dragleave.stop="onTabDragLeave(tab.id)"
        @drop.stop.prevent="onTabDrop($event, tab)"
      >
        <FileGlyph :path="tab.filePath" :size="15" />
        <span class="tab-name">{{ baseName(tab.filePath) }}</span>
        <span v-if="duplicateNames.has(baseName(tab.filePath))" class="tab-dir">{{
          parentDir(tab.filePath)
        }}</span>
        <span class="tab-dirty-dot" aria-hidden="true"></span>
        <button
          type="button"
          class="editor-tab-close"
          :title="t('editorTabs.closeTab', { name: baseName(tab.filePath) })"
          @click.stop="$emit('request-close', tab.id)"
        >
          <X :size="12" />
        </button>
      </div>
    </div>

    <div ref="actionsEl" class="tab-actions">
      <button
        type="button"
        class="tab-action"
        :title="t('editorTabs.split')"
        :aria-label="t('editorTabs.split')"
        @click="$emit('split')"
      >
        <Columns2 :size="14" />
      </button>
      <button
        v-if="canCloseGroup"
        type="button"
        class="tab-action"
        :title="t('editorTabs.closeGroup')"
        :aria-label="t('editorTabs.closeGroup')"
        @click="$emit('close-group')"
      >
        <X :size="14" />
      </button>
      <button
        type="button"
        class="tab-action overflow"
        :class="{ show: overflowing }"
        :title="t('editorTabs.overflow')"
        :aria-label="t('editorTabs.overflow')"
        @click="toggleOverflow"
      >
        <ChevronDown :size="14" />
      </button>

      <div v-if="overflowOpen" class="tab-overflow" role="menu">
        <div class="overflow-head">{{ t('editorTabs.openEditors') }}</div>
        <button
          v-for="tab in tabs"
          :key="tab.id"
          type="button"
          class="overflow-item"
          :class="{ active: tab.id === activeTabId }"
          role="menuitem"
          @click="activateFromOverflow(tab.id)"
        >
          <FileGlyph :path="tab.filePath" :size="15" />
          <span class="oi-name">{{ baseName(tab.filePath) }}</span>
          <span v-if="isDirty(tab)" class="oi-dirty" aria-hidden="true"></span>
          <span class="oi-path">{{ parentDir(tab.filePath) }}</span>
        </button>
      </div>
    </div>

    <EditorTabContextMenu
      :visible="!!menu"
      :x="menu?.x ?? 0"
      :y="menu?.y ?? 0"
      :tab="menu?.tab ?? null"
      :can-close-right="canCloseRight"
      @command="onMenuCommand"
      @close-menu="menu = null"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ChevronDown, Columns2, X } from 'lucide-vue-next'
import { useI18n } from '../../composables/useI18n'
import { useTabBufferStore } from '../../composables/useTabBufferStore'
import {
  beginTabDrag,
  endTabDrag,
  getTabDrag,
  isTabDragEvent,
  TAB_DRAG_MIME,
} from '../../composables/useEditorTabDrag'
import type { EditorTab } from '../../types/editorTabs'
import FileGlyph from './FileGlyph.vue'
import EditorTabContextMenu, { type TabMenuCommand } from './EditorTabContextMenu.vue'

const props = defineProps<{
  leafId: string
  tabs: EditorTab[]
  activeTabId: string | null
  canCloseGroup: boolean
}>()

const emit = defineEmits<{
  activate: [tabId: string]
  'request-close': [tabId: string]
  pin: [tabId: string]
  split: []
  'close-group': []
  reorder: [tabId: string, targetTabId: string, after: boolean]
  'drop-on-strip': [sourceLeafId: string, tabId: string]
  command: [tabId: string, command: TabMenuCommand]
}>()

const { t } = useI18n()
const buffers = useTabBufferStore()

const tabsEl = ref<HTMLElement | null>(null)
const actionsEl = ref<HTMLElement | null>(null)
const overflowing = ref(false)
const fadeLeft = ref(false)
const fadeRight = ref(false)
const overflowOpen = ref(false)
const draggingTabId = ref<string | null>(null)
const dropTarget = ref<{ tabId: string; after: boolean } | null>(null)
const stripDrop = ref(false)
const menu = ref<{ tab: EditorTab; x: number; y: number } | null>(null)

const duplicateNames = computed(() => {
  const counts = new Map<string, number>()
  for (const tab of props.tabs) {
    const name = baseName(tab.filePath)
    counts.set(name, (counts.get(name) ?? 0) + 1)
  }
  return new Set([...counts.entries()].filter(([, count]) => count > 1).map(([name]) => name))
})

const canCloseRight = computed(() => {
  const tabId = menu.value?.tab.id
  if (!tabId) return false
  const idx = props.tabs.findIndex((tab) => tab.id === tabId)
  return idx >= 0 && idx < props.tabs.length - 1
})

function baseName(path: string): string {
  return path.split('/').pop() || path
}

function parentDir(path: string): string {
  const parts = path.split('/').filter(Boolean)
  if (parts.length < 2) return ''
  return `${parts[parts.length - 2]}/`
}

function isDirty(tab: EditorTab): boolean {
  return buffers.isDirty(tab)
}

function updateFade() {
  const el = tabsEl.value
  if (!el) return
  overflowing.value = el.scrollWidth > el.clientWidth + 1
  fadeLeft.value = el.scrollLeft > 1
  fadeRight.value = el.scrollLeft + el.clientWidth < el.scrollWidth - 1
}

function revealActive() {
  const el = tabsEl.value
  if (!el) return
  const active = el.querySelector<HTMLElement>('.editor-tab.active')
  active?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  updateFade()
}

function onWheel(event: WheelEvent) {
  const el = tabsEl.value
  if (!el || el.scrollWidth <= el.clientWidth) return
  if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return
  event.preventDefault()
  el.scrollLeft += event.deltaY
  updateFade()
}

function onAuxClick(event: MouseEvent, tabId: string) {
  if (event.button === 1) emit('request-close', tabId)
}

function openMenu(event: MouseEvent, tab: EditorTab) {
  overflowOpen.value = false
  menu.value = { tab, x: event.clientX, y: event.clientY }
}

function onMenuCommand(command: TabMenuCommand) {
  const tab = menu.value?.tab
  if (!tab) return
  emit('command', tab.id, command)
  menu.value = null
}

function toggleOverflow() {
  menu.value = null
  overflowOpen.value = !overflowOpen.value
}

function activateFromOverflow(tabId: string) {
  overflowOpen.value = false
  emit('activate', tabId)
}

function onTabDragStart(event: DragEvent, tab: EditorTab) {
  beginTabDrag({ leafId: props.leafId, tabId: tab.id, filePath: tab.filePath })
  draggingTabId.value = tab.id
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData(TAB_DRAG_MIME, tab.id)
    event.dataTransfer.setData('text/plain', tab.filePath)
  }
}

function onTabDragOver(event: DragEvent, tab: EditorTab) {
  const drag = getTabDrag()
  if (!drag || drag.tabId === tab.id) return
  event.dataTransfer!.dropEffect = 'move'
  stripDrop.value = false
  if (drag.leafId === props.leafId) {
    const box = (event.currentTarget as HTMLElement).getBoundingClientRect()
    dropTarget.value = {
      tabId: tab.id,
      after: event.clientX > box.left + box.width / 2,
    }
  } else {
    // Dropping on another group's strip moves the tab into that group.
    dropTarget.value = null
  }
}

function onTabDragLeave(tabId: string) {
  if (dropTarget.value?.tabId === tabId) dropTarget.value = null
}

function onTabDrop(event: DragEvent, tab: EditorTab) {
  const drag = getTabDrag()
  dropTarget.value = null
  stripDrop.value = false
  if (!drag) return
  event.stopPropagation()
  if (drag.leafId === props.leafId) {
    if (drag.tabId === tab.id) return
    const box = (event.currentTarget as HTMLElement).getBoundingClientRect()
    emit('reorder', drag.tabId, tab.id, event.clientX > box.left + box.width / 2)
  } else {
    emit('drop-on-strip', drag.leafId, drag.tabId)
  }
  endTabDrag()
}

function onStripDragOver(event: DragEvent) {
  if (!isTabDragEvent(event)) return
  const drag = getTabDrag()
  if (!drag || drag.leafId === props.leafId) return
  event.dataTransfer!.dropEffect = 'move'
  stripDrop.value = true
}

function onStripDragLeave(event: DragEvent) {
  const next = event.relatedTarget as Node | null
  if (next && (event.currentTarget as HTMLElement).contains(next)) return
  stripDrop.value = false
}

function onStripDrop(event: DragEvent) {
  const drag = getTabDrag()
  stripDrop.value = false
  if (!drag || drag.leafId === props.leafId) return
  event.preventDefault()
  emit('drop-on-strip', drag.leafId, drag.tabId)
  endTabDrag()
}

function onTabDragEnd() {
  draggingTabId.value = null
  dropTarget.value = null
  stripDrop.value = false
  endTabDrag()
}

function onDocPointerDown(event: PointerEvent) {
  if (!overflowOpen.value) return
  const target = event.target as Node
  if (actionsEl.value?.contains(target)) return
  overflowOpen.value = false
}

function onDocKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    overflowOpen.value = false
    menu.value = null
  }
}

let resizeObserver: ResizeObserver | null = null

onMounted(() => {
  document.addEventListener('pointerdown', onDocPointerDown, true)
  document.addEventListener('keydown', onDocKeydown, true)
  resizeObserver = new ResizeObserver(() => updateFade())
  if (tabsEl.value) resizeObserver.observe(tabsEl.value)
  void nextTick(revealActive)
})

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onDocPointerDown, true)
  document.removeEventListener('keydown', onDocKeydown, true)
  resizeObserver?.disconnect()
})

watch(
  () => [props.activeTabId, props.tabs.length],
  () => void nextTick(revealActive)
)
</script>

<style scoped>
.editor-tab-bar {
  display: flex;
  align-items: stretch;
  flex-shrink: 0;
  height: 36px;
  background: var(--tab-bg, #252526);
  border-bottom: 1px solid var(--border, #333);
  position: relative;
}

.editor-tab-bar.strip-drop {
  box-shadow: inset 0 -2px 0 var(--accent, #4d80ff);
}

.editor-tabs {
  display: flex;
  flex: 1;
  min-width: 0;
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: none;
  white-space: nowrap;
}

.editor-tabs::-webkit-scrollbar {
  display: none;
}

.editor-tabs.fade-left {
  -webkit-mask-image: linear-gradient(to right, transparent 0, #000 16px, #000 100%);
  mask-image: linear-gradient(to right, transparent 0, #000 16px, #000 100%);
}

.editor-tabs.fade-right {
  -webkit-mask-image: linear-gradient(to right, #000 0, #000 calc(100% - 16px), transparent 100%);
  mask-image: linear-gradient(to right, #000 0, #000 calc(100% - 16px), transparent 100%);
}

.editor-tabs.fade-left.fade-right {
  -webkit-mask-image: linear-gradient(
    to right,
    transparent 0,
    #000 16px,
    #000 calc(100% - 16px),
    transparent 100%
  );
  mask-image: linear-gradient(
    to right,
    transparent 0,
    #000 16px,
    #000 calc(100% - 16px),
    transparent 100%
  );
}

.editor-tab {
  position: relative;
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 92px;
  max-width: 220px;
  height: 36px;
  padding: 0 7px 0 11px;
  flex-shrink: 0;
  background: var(--tab-bg, #252526);
  color: var(--fg-muted, #a3a3a3);
  border-right: 1px solid rgba(0, 0, 0, 0.25);
  border-top: 1px solid transparent;
  cursor: pointer;
  user-select: none;
  font-size: 12.5px;
}

.editor-tab:hover {
  background: var(--tab-hover-bg, #333);
  color: var(--fg, #d4d4d4);
}

.editor-tab.active {
  background: var(--bg, #1e1e1e);
  color: var(--fg, #e6e6e6);
  border-top-color: var(--accent, #4d80ff);
}

.editor-tab.dragging {
  opacity: 0.35;
}

.editor-tab.drop-before::before,
.editor-tab.drop-after::after {
  content: '';
  position: absolute;
  top: 2px;
  bottom: 2px;
  width: 2px;
  background: var(--accent, #4d80ff);
  z-index: 2;
}

.editor-tab.drop-before::before {
  left: -1px;
}

.editor-tab.drop-after::after {
  right: -1px;
}

.tab-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.editor-tab.preview .tab-name {
  font-style: italic;
}

.tab-dir {
  flex-shrink: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--fg-muted, #7d7d7d);
  font-size: 10.5px;
}

.editor-tab.active .tab-dir {
  color: #9a9a9a;
}

.tab-dirty-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
  background: var(--color-orange, #d19a66);
  display: none;
}

.editor-tab.dirty:not(:hover) .tab-dirty-dot {
  display: block;
}

/* Named `editor-tab-close`, not `tab-close`: the terminal tab bar in
   layout.css owns `.tab-close` and keeps it at opacity 0 until hover. */
.editor-tab-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 17px;
  height: 17px;
  padding: 0;
  flex-shrink: 0;
  border: 0;
  border-radius: 3px;
  background: transparent;
  color: #b0b0b0;
  cursor: pointer;
}

.editor-tab-close:hover {
  background: rgba(255, 255, 255, 0.14);
  color: #fff;
}

.tab-actions {
  display: flex;
  align-items: center;
  gap: 1px;
  flex-shrink: 0;
  padding: 0 4px;
  position: relative;
  background: var(--tab-bg, #252526);
}

.tab-action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  padding: 0;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: #a0a0a0;
  cursor: pointer;
}

.tab-action:hover {
  background: var(--tab-hover-bg, #37373d);
  color: var(--fg, #e6e6e6);
}

.tab-action.overflow:not(.show) {
  display: none;
}

.tab-overflow {
  position: absolute;
  top: 33px;
  right: 0;
  z-index: 20;
  width: 340px;
  max-height: 380px;
  overflow: auto;
  padding: 5px 0;
  border-radius: 6px;
  background: var(--menu-bg, #252526);
  border: 1px solid #454545;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.55);
}

.overflow-head {
  padding: 3px 12px 6px;
  color: #8a8a8a;
  font-size: 10px;
  letter-spacing: 0.6px;
  text-transform: uppercase;
}

.overflow-item {
  display: flex;
  align-items: center;
  gap: 7px;
  width: 100%;
  height: 28px;
  padding: 0 12px;
  border: 0;
  background: transparent;
  color: #cccccc;
  font: inherit;
  font-size: 12px;
  text-align: left;
  cursor: pointer;
}

.overflow-item:hover {
  background: #094771;
  color: #fff;
}

.overflow-item.active {
  color: #fff;
  font-weight: 500;
}

.oi-name {
  flex-shrink: 0;
}

.oi-path {
  margin-left: auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  color: #7f7f7f;
  font-size: 10.5px;
  font-family: var(--font-mono, monospace);
  white-space: nowrap;
}

.oi-dirty {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--color-orange, #d19a66);
  flex-shrink: 0;
}
</style>
