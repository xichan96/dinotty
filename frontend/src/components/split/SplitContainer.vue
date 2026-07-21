<template>
  <!-- Leaf node: render TerminalPane wrapper -->
  <div
    v-if="leaf"
    :class="[
      'split-leaf',
      {
        active: leaf.paneId === activePaneId,
        zoomed: leaf.zoomed,
        'broadcast-active': broadcastActive,
        'broadcast-receiving': broadcastReceiving,
      },
    ]"
    :data-pane-id="leaf.paneId"
    @mousedown="onLeafClick(leaf.paneId)"
  >
    <PaneHeader
      v-if="showHeader"
      :pane-id="leaf.paneId"
      :tab-id="tabId"
      :title="leaf.title || 'Terminal'"
      :is-active="leaf.paneId === activePaneId"
      :direction="parentDirection"
      @reorder="(src, tgt, pos) => emit('reorder', src, tgt, pos)"
      @drop-on-tab="(srcTab, srcPane, dstTab, pos) => emit('dropOnTab', srcTab, srcPane, dstTab, pos)"
      @drop-extract="(srcTab, srcPane, idx) => emit('dropExtract', srcTab, srcPane, idx)"
    />
    <button
      v-if="allowClose"
      class="pane-close-btn"
      :title="t('split.closePane')"
      @mousedown.stop
      @click.stop="emit('close', leaf!.paneId)"
    >
      &times;
    </button>
    <template v-if="broadcastActive">
      <div class="broadcast-icon broadcast-icon--active" :title="t('split.broadcastTooltip')">
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M2 12C2 6.5 6.5 2 12 2" />
          <path d="M6 12c0-3.3 2.7-6 6-6" />
          <circle cx="12" cy="12" r="2" fill="currentColor" />
        </svg>
      </div>
    </template>
    <div
      v-else-if="broadcastReceiving"
      class="broadcast-icon broadcast-icon--receiving"
      :title="t('split.broadcastTooltip')"
    >
      <svg
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2.5"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <path d="M2 12C2 6.5 6.5 2 12 2" />
        <path d="M6 12c0-3.3 2.7-6 6-6" />
        <circle cx="12" cy="12" r="2" fill="currentColor" />
      </svg>
    </div>
    <PaneContent
      :leaf="leaf"
      @register="(id: string, el: any) => emit('register', id, el)"
      @title-change="(id: string, title: string) => emit('titleChange', id, title)"
      @shell-info="(id: string, shell: string) => emit('shellInfo', id, shell)"
      @input="(id: string, data: string) => emit('input', id, data)"
      @file-click="(path: string) => emit('fileClick', path)"
      @preview-link="(id: string, url: string) => emit('previewLink', id, url)"
      @link-activate="emit('linkActivate')"
      @close="(id: string) => emit('close', id)"
      @reconnect="(id: string) => emit('reconnect', id)"
      @split-horizontal="emit('splitHorizontal')"
      @split-vertical="emit('splitVertical')"
      @toggle-broadcast="emit('toggleBroadcast')"
      @new-local-terminal="emit('newLocalTerminal')"
    />
  </div>

  <!-- Split node: render flex container with children and dividers -->
  <div v-else-if="split" ref="containerRef" :class="['split-container', split.direction]">
    <template
      v-for="(child, idx) in split.children"
      :key="child.type === 'leaf' ? child.paneId : child.id"
    >
      <SplitContainer
        :layout="child"
        :active-pane-id="activePaneId"
        :broadcast-mode="broadcastMode"
        :broadcast-activity="broadcastActivity"
        :show-header="allowClose"
        :allow-close="allowClose"
        :parent-direction="split!.direction"
        :tab-id="tabId"
        :style="getChildStyle(idx)"
        @register="(id: string, el: any) => emit('register', id, el)"
        @title-change="(id: string, title: string) => emit('titleChange', id, title)"
        @shell-info="(id: string, shell: string) => emit('shellInfo', id, shell)"
        @focus="(id: string) => emit('focus', id)"
        @close="(id: string) => emit('close', id)"
        @input="(id: string, data: string) => emit('input', id, data)"
        @file-click="(path: string) => emit('fileClick', path)"
        @preview-link="(id: string, url: string) => emit('previewLink', id, url)"
        @link-activate="emit('linkActivate')"
        @reorder="(src: string, tgt: string, pos: DropPosition) => emit('reorder', src, tgt, pos)"
        @drop-on-tab="(srcTab: string, srcPane: string, dstTab: string, pos: DropPosition) => emit('dropOnTab', srcTab, srcPane, dstTab, pos)"
        @drop-extract="(srcTab: string, srcPane: string, idx: number) => emit('dropExtract', srcTab, srcPane, idx)"
        @split-horizontal="emit('splitHorizontal')"
        @split-vertical="emit('splitVertical')"
        @toggle-broadcast="emit('toggleBroadcast')"
        @new-local-terminal="emit('newLocalTerminal')"
        @divider-drag-end="emit('dividerDragEnd')"
        @reconnect="(id: string) => emit('reconnect', id)"
      />
      <SplitDivider
        v-if="idx < split.children.length - 1"
        :direction="split.direction"
        :left-ratio-ref="makeRatioRef(idx)"
        :right-ratio-ref="makeRatioRef(idx + 1)"
        :container-el="containerRef!"
        :offset-ratio="getOffsetRatio(idx)"
        @drag-end="emit('dividerDragEnd')"
      />
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import type { PaneLayout, LeafPane, DropPosition } from '../../types/pane'
import PaneContent from './PaneContent.vue'
import SplitDivider from './SplitDivider.vue'
import PaneHeader from './PaneHeader.vue'
import { useI18n } from '../../composables/useI18n'

const props = defineProps<{
  layout: PaneLayout
  activePaneId: string
  broadcastMode: boolean
  broadcastActivity: number
  showHeader?: boolean
  allowClose?: boolean
  parentDirection?: 'horizontal' | 'vertical'
  tabId: string
}>()

const emit = defineEmits<{
  register: [paneId: string, el: any]
  titleChange: [paneId: string, title: string]
  shellInfo: [paneId: string, shell: string]
  focus: [paneId: string]
  close: [paneId: string]
  input: [paneId: string, data: string]
  fileClick: [path: string]
  previewLink: [paneId: string, url: string]
  linkActivate: []
  reorder: [sourcePaneId: string, targetPaneId: string, position: DropPosition]
  dropOnTab: [sourceTabId: string, sourcePaneId: string, dstTabId: string, position: DropPosition]
  dropExtract: [sourceTabId: string, sourcePaneId: string, targetIndex: number]
  dividerDragEnd: []
  reconnect: [paneId: string]
  splitHorizontal: []
  splitVertical: []
  toggleBroadcast: []
  newLocalTerminal: []
}>()

const { t } = useI18n()
const containerRef = ref<HTMLElement>()

const leaf = computed(() => (props.layout.type === 'leaf' ? (props.layout as LeafPane) : null))
const split = computed(() => (props.layout.type === 'split' ? props.layout : null))

const broadcastActive = computed(() => {
  if (!leaf.value) return false
  return props.broadcastMode && leaf.value.paneId === props.activePaneId
})

const broadcastReceiving = computed(() => {
  if (!leaf.value) return false
  return props.broadcastMode && leaf.value.paneId !== props.activePaneId
})

function onLeafClick(paneId: string) {
  emit('focus', paneId)
}

function makeRatioRef(idx: number) {
  return computed({
    get: () => split.value?.ratios[idx] ?? 0,
    set: (val: number) => {
      if (split.value) {
        split.value.ratios[idx] = val
      }
    },
  })
}

function getOffsetRatio(leftIdx: number) {
  if (!split.value) return 0
  let sum = 0
  for (let i = 0; i < leftIdx; i++) {
    sum += split.value.ratios[i] ?? 0
  }
  return sum
}

function getChildStyle(idx: number) {
  if (!split.value) return {}
  const ratio = split.value.ratios[idx] ?? 1 / (split.value.children.length || 1)
  const dir = split.value.direction
  return {
    flex: `${ratio} 1 0%`,
    minWidth: dir === 'horizontal' ? '80px' : undefined,
    minHeight: dir === 'vertical' ? '40px' : undefined,
  }
}
</script>

<style scoped>
.split-container {
  display: flex;
  width: 100%;
  height: 100%;
  position: relative;
}

.split-container.horizontal {
  flex-direction: row;
}

.split-container.vertical {
  flex-direction: column;
}

.split-leaf {
  position: relative;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  height: 100%;
  opacity: 0.55;
  transition: opacity 0.15s;
}

.split-leaf.active {
  opacity: 1;
}

.split-leaf.zoomed {
  position: absolute;
  inset: 0;
  z-index: 10;
  min-width: 0;
  min-height: 0;
}

.split-leaf.broadcast-active {
  opacity: 1;
}

.split-leaf.broadcast-receiving {
  opacity: 1;
}

/* Close button — visible on hover, positioned inside header when present */
.pane-close-btn {
  position: absolute;
  top: 4px;
  left: 4px;
  z-index: 20;
  width: 20px;
  height: 20px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--text-secondary, #888);
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  transition:
    opacity 0.15s,
    background 0.15s,
    color 0.15s;
}

/* Adjust close button position when vertical header with expanded padding is present */
.split-leaf:has(.direction-vertical) .pane-close-btn {
  top: 11px;
}

/* Push header title right to avoid overlapping the close button */
.split-leaf:has(.pane-close-btn) .pane-header {
  padding-left: 28px;
}

.split-leaf:hover .pane-close-btn {
  opacity: 1;
}

.pane-close-btn:hover {
  background: var(--hover-bg, var(--bg-hover));
  color: var(--text-primary, var(--fg-bright));
}

/* Broadcast indicator — radar style */
.broadcast-icon {
  position: absolute;
  top: 4px;
  right: 8px;
  z-index: 10;
  color: var(--text-secondary, #888);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: default;
}

.broadcast-icon--active {
  opacity: 0.9;
  animation: radar-pulse 2s ease-in-out infinite;
}

.broadcast-icon--receiving {
  opacity: 0.45;
}

@keyframes radar-pulse {
  0%,
  100% {
    opacity: 0.9;
  }
  50% {
    opacity: 0.5;
  }
}
</style>
