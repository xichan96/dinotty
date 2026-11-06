<template>
  <!-- Leaf node: render one editor group -->
  <EditorPane
    v-if="leaf"
    :leaf="leaf"
    :pane-id="paneId"
    :is-active="leaf.id === activeLeafId"
    :show-header="showHeader"
    :reveal="reveal"
    :style="{ flex: `${leaf.ratio} 1 0%` }"
    @focus="(id: string) => emit('focus', id)"
    @activate-tab="(leafId, tabId) => emit('activate-tab', leafId, tabId)"
    @close-tab="(leafId, tabId) => emit('close-tab', leafId, tabId)"
    @close-tabs="(leafId, tabIds) => emit('close-tabs', leafId, tabIds)"
    @set-tab-preview="(leafId, tabId, preview) => emit('set-tab-preview', leafId, tabId, preview)"
    @split="(leafId: string) => emit('split', leafId)"
    @close-group="(leafId: string) => emit('close-group', leafId)"
    @copy-tab-path="(leafId, tabId) => emit('copy-tab-path', leafId, tabId)"
    @reorder-tab="(leafId, tabId, targetId, after) => emit('reorder-tab', leafId, tabId, targetId, after)"
    @move-tab="(sourceLeafId, tabId, targetLeafId) => emit('move-tab', sourceLeafId, tabId, targetLeafId)"
    @split-tab="(sourceLeafId, tabId, targetLeafId, position) => emit('split-tab', sourceLeafId, tabId, targetLeafId, position)"
    @file-drop="
      (leafId: string, rel: string, pos: DropPosition) => emit('file-drop', leafId, rel, pos)
    "
  />

  <!-- Split node: flex container with children and dividers -->
  <div v-else-if="split" ref="containerRef" :class="['editor-split-container', split.direction]">
    <template v-for="(child, idx) in split.children" :key="child.id">
      <EditorSplitContainer
        :layout="child"
        :active-leaf-id="activeLeafId"
        :pane-id="paneId"
        :show-header="showHeader"
        :reveal="reveal"
        :style="getChildStyle(idx)"
        @focus="(id: string) => emit('focus', id)"
        @activate-tab="(leafId, tabId) => emit('activate-tab', leafId, tabId)"
        @close-tab="(leafId, tabId) => emit('close-tab', leafId, tabId)"
        @close-tabs="(leafId, tabIds) => emit('close-tabs', leafId, tabIds)"
        @set-tab-preview="
          (leafId, tabId, preview) => emit('set-tab-preview', leafId, tabId, preview)
        "
        @split="(leafId: string) => emit('split', leafId)"
        @close-group="(leafId: string) => emit('close-group', leafId)"
        @copy-tab-path="(leafId, tabId) => emit('copy-tab-path', leafId, tabId)"
        @reorder-tab="
          (leafId, tabId, targetId, after) =>
            emit('reorder-tab', leafId, tabId, targetId, after)
        "
        @move-tab="
          (sourceLeafId, tabId, targetLeafId) =>
            emit('move-tab', sourceLeafId, tabId, targetLeafId)
        "
        @split-tab="
          (sourceLeafId, tabId, targetLeafId, position) =>
            emit('split-tab', sourceLeafId, tabId, targetLeafId, position)
        "
        @file-drop="
          (leafId: string, rel: string, pos: DropPosition) => emit('file-drop', leafId, rel, pos)
        "
      />
      <SplitDivider
        v-if="idx < split.children.length - 1"
        :direction="split.direction"
        :left-ratio-ref="makeRatioRef(idx)"
        :right-ratio-ref="makeRatioRef(idx + 1)"
        :container-el="containerRef!"
        :offset-ratio="getOffsetRatio(idx)"
      />
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import type { EditorPaneLayout, EditorLeafPane, EditorSplitPane } from '../../types/editorPane'
import type { DropPosition } from '../../types/pane'
import type { EditorDropPosition } from '../../composables/useEditorSplit'
import EditorPane, { type EditorRevealTarget } from './EditorPane.vue'
import SplitDivider from '../split/SplitDivider.vue'

const props = defineProps<{
  layout: EditorPaneLayout
  activeLeafId: string | null
  paneId: string
  showHeader: boolean
  reveal?: EditorRevealTarget | null
}>()

const emit = defineEmits<{
  focus: [leafId: string]
  'activate-tab': [leafId: string, tabId: string]
  'close-tab': [leafId: string, tabId: string]
  'close-tabs': [leafId: string, tabIds: string[]]
  'set-tab-preview': [leafId: string, tabId: string, preview: boolean]
  split: [leafId: string]
  'close-group': [leafId: string]
  'copy-tab-path': [leafId: string, tabId: string]
  'reorder-tab': [leafId: string, tabId: string, targetTabId: string, after: boolean]
  'move-tab': [sourceLeafId: string, tabId: string, targetLeafId: string]
  'split-tab': [
    sourceLeafId: string,
    tabId: string,
    targetLeafId: string,
    position: Exclude<EditorDropPosition, 'center'>,
  ]
  'file-drop': [leafId: string, rel: string, position: DropPosition]
}>()

const containerRef = ref<HTMLElement>()

const leaf = computed(() =>
  props.layout.type === 'editor-leaf' ? (props.layout as EditorLeafPane) : null
)
const split = computed(() =>
  props.layout.type === 'editor-split' ? (props.layout as EditorSplitPane) : null
)

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
  return {
    flex: `${ratio} 1 0%`,
    minWidth: split.value.direction === 'horizontal' ? '120px' : undefined,
    minHeight: split.value.direction === 'vertical' ? '60px' : undefined,
  }
}
</script>

<style scoped>
.editor-split-container {
  display: flex;
  width: 100%;
  height: 100%;
  position: relative;
}

.editor-split-container.horizontal {
  flex-direction: row;
}

.editor-split-container.vertical {
  flex-direction: column;
}
</style>
