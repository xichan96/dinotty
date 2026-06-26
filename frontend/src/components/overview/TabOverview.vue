<template>
  <AnimatePresence>
    <Motion
      v-if="visible"
      key="backdrop"
      class="mc-backdrop"
      :initial="{ opacity: 0 }"
      :animate="{ opacity: 1 }"
      :exit="{ opacity: 0 }"
      :transition="{ duration: 0.2 }"
      tabindex="0"
      @click.self="$emit('close')"
      @keydown.esc="$emit('close')"
    >
      <Motion
        class="mc-grid"
        :style="gridStyle"
        :initial="{ scale: 0.9, opacity: 0 }"
        :animate="{ scale: 1, opacity: 1 }"
        :exit="{ scale: 0.9, opacity: 0 }"
        :transition="{ type: 'spring', damping: 25, stiffness: 300 }"
      >
        <Motion
          v-for="(card, i) in cards"
          :key="card.paneId"
          class="mc-card"
          :class="{ active: card.paneId === activePaneId }"
          :initial="{ opacity: 0, y: 20 }"
          :animate="{ opacity: 1, y: 0 }"
          :exit="{ opacity: 0, y: -10 }"
          :transition="{ delay: Math.min(i, 8) * 0.03, type: 'spring', damping: 20 }"
          @click="$emit('activate', card.paneId)"
        >
          <div class="mc-card-header">
            <span class="mc-card-index">{{ card.index }}</span>
            <span class="mc-card-title">{{ card.title }}</span>
            <button
              class="mc-card-close"
              :aria-label="`Close ${card.title}`"
              @click.stop="$emit('close-tab', card.paneId)"
            >
              <X :size="14" />
            </button>
          </div>
          <div class="mc-card-preview">
            <img v-if="card.previewImage" :src="card.previewImage" />
            <SplitPreviewNode v-else-if="isSplitPreview(card.htmlContent)" :node="card.htmlContent" />
            <pre v-else-if="card.htmlContent" class="mc-card-text" v-html="card.htmlContent"></pre>
            <pre v-else-if="card.textContent" class="mc-card-text">{{ card.textContent }}</pre>
            <div v-else-if="card.type === 'plugin'" class="mc-plugin-placeholder">
              <Puzzle :size="32" />
              <span class="mc-plugin-label">{{ card.title }}</span>
            </div>
            <pre v-else class="mc-card-text"></pre>
          </div>
        </Motion>
      </Motion>
    </Motion>
  </AnimatePresence>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { Motion, AnimatePresence } from 'motion-v'
import { X, Puzzle } from 'lucide-vue-next'
import type { TabCard, PanePreviewNode } from '../../composables/useTabPreview'
import SplitPreviewNode from './SplitPreviewNode.vue'

function isSplitPreview(content: string | PanePreviewNode): content is PanePreviewNode {
  return typeof content === 'object' && content !== null && 'direction' in content
}

const props = defineProps<{
  visible: boolean
  cards: TabCard[]
  activePaneId: string | null
}>()

defineEmits<{
  close: []
  activate: [paneId: string]
  'close-tab': [paneId: string]
}>()

const COLS_SM = 2
const COLS_MD = 3
const COLS_LG = 4

const gridStyle = computed(() => {
  const n = props.cards.length || 1
  return {
    '--mc-rows': Math.ceil(n / COLS_SM),
    '--mc-rows-md': Math.ceil(n / COLS_MD),
    '--mc-rows-lg': Math.ceil(n / COLS_LG),
  }
})
</script>
