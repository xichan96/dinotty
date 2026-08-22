<template>
  <!-- Leaf node: render EditorPane -->
  <EditorPane
    v-if="leaf"
    :leaf-id="leaf.id"
    :pane-id="paneId"
    :file-path="leaf.filePath"
    :is-dir="leaf.isDir"
    :is-active="leaf.id === activeLeafId"
    :show-header="showHeader"
    :style="{ flex: `${leaf.ratio} 1 0%` }"
    @focus="(id: string) => emit('focus', id)"
    @close="(id: string) => emit('close', id)"
    @file-drop="
      (leafId: string, rel: string, pos: DropPosition) => emit('file-drop', leafId, rel, pos)
    "
  />

  <!-- Split node: flex container with children and dividers -->
  <div v-else-if="split" ref="containerRef" :class="['editor-split-container', split.direction]">
    <template
      v-for="(child, idx) in split.children"
      :key="child.type === 'editor-leaf' ? child.id : child.id"
    >
      <EditorSplitContainer
        :layout="child"
        :active-leaf-id="activeLeafId"
        :pane-id="paneId"
        :show-header="showHeader"
        :style="getChildStyle(idx)"
        @focus="(id: string) => emit('focus', id)"
        @close="(id: string) => emit('close', id)"
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
import EditorPane from './EditorPane.vue'
import SplitDivider from '../split/SplitDivider.vue'

const props = defineProps<{
  layout: EditorPaneLayout
  activeLeafId: string | null
  paneId: string
  showHeader: boolean
}>()

const emit = defineEmits<{
  focus: [leafId: string]
  close: [leafId: string]
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
