<template>
  <div v-if="drag.state.isDragging && previewStyle" class="drop-preview" :style="previewStyle"></div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { usePaneDrag } from '../../composables/paneDragContext'

const drag = usePaneDrag()

const previewStyle = computed(() => {
  if (!drag.state.isDragging || !drag.state.targetId || !drag.state.zone) {
    return null
  }

  let targetEl: HTMLElement | null = null

  if (drag.state.targetKind === 'pane') {
    targetEl = document.querySelector(
      `.split-leaf[data-pane-id="${drag.state.targetId}"]`
    ) as HTMLElement | null
  } else if (drag.state.targetKind === 'tab-label') {
    targetEl = document.querySelector(
      `.tab[data-tab-id="${drag.state.targetId}"]`
    ) as HTMLElement | null
  } else if (drag.state.targetKind === 'tab-blank') {
    // Position the preview right after the last tab so it visually
    // indicates where the new tab will be inserted. Anchoring to
    // .tab-bar would place it over the action buttons; anchoring to
    // the right edge of #tabs-list leaves a gap when the list is wide.
    const list = document.querySelector('#tabs-list') as HTMLElement | null
    if (!list) return null
    const listRect = list.getBoundingClientRect()
    const tabs = list.querySelectorAll('.tab')
    const lastTab = tabs.length > 0 ? (tabs[tabs.length - 1] as HTMLElement) : null
    const left = lastTab ? lastTab.getBoundingClientRect().right : listRect.left
    const maxWidth = listRect.right - left
    const width = Math.min(80, maxWidth)
    if (width <= 0) return null
    return {
      left: `${left}px`,
      top: `${listRect.top}px`,
      width: `${width}px`,
      height: `${listRect.height}px`,
    }
  }

  if (!targetEl) return null

  const rect = targetEl.getBoundingClientRect()
  const halfW = rect.width / 2
  const halfH = rect.height / 2
  const zone = drag.state.zone

  if (zone === 'tab-label') {
    return {
      left: `${rect.left}px`,
      top: `${rect.top}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
    }
  }

  switch (zone) {
    case 'left':
      return {
        left: `${rect.left}px`,
        top: `${rect.top}px`,
        width: `${halfW}px`,
        height: `${rect.height}px`,
      }
    case 'right':
      return {
        left: `${rect.left + halfW}px`,
        top: `${rect.top}px`,
        width: `${halfW}px`,
        height: `${rect.height}px`,
      }
    case 'top':
      return {
        left: `${rect.left}px`,
        top: `${rect.top}px`,
        width: `${rect.width}px`,
        height: `${halfH}px`,
      }
    case 'bottom':
      return {
        left: `${rect.left}px`,
        top: `${rect.top + halfH}px`,
        width: `${rect.width}px`,
        height: `${halfH}px`,
      }
    case 'center':
      return {
        left: `${rect.left}px`,
        top: `${rect.top}px`,
        width: `${rect.width}px`,
        height: `${rect.height}px`,
      }
    default:
      return null
  }
})
</script>

<style scoped>
.drop-preview {
  position: fixed;
  z-index: 10000;
  background: rgba(239, 68, 68, 0.25);
  border: 1px solid rgba(239, 68, 68, 0.6);
  pointer-events: none;
  border-radius: 2px;
  transition:
    left 0.08s ease-out,
    top 0.08s ease-out,
    width 0.08s ease-out,
    height 0.08s ease-out;
}
</style>
