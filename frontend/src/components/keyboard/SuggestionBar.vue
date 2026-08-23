<template>
  <div class="suggestion-bar">
    <div class="suggestion-scroll">
      <button
        v-for="item in suggestions"
        :key="item.command"
        class="suggestion-chip"
        @mousedown.prevent="onTap(item.command)"
        @touchstart="onTouchStart(item.command, $event)"
        @touchmove="onTouchMove"
        @touchend.prevent="onTouchEnd(item.command)"
        @touchcancel="cancelLongPress"
      >
        <span class="suggestion-chip-text">{{ item.command }}</span>
        <span class="suggestion-chip-freq">{{ item.frequency }}</span>
      </button>
      <span v-if="suggestions.length === 0" class="suggestion-empty">No suggestions</span>
    </div>
    <button
      class="suggestion-expand-btn"
      @mousedown.prevent="$emit('expand')"
      @touchstart.prevent="$emit('expand')"
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <polyline points="9 18 15 12 9 6" />
      </svg>
    </button>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import type { SuggestionItem } from '@/composables/useHistory'

defineProps<{
  suggestions: SuggestionItem[]
}>()

const emit = defineEmits<{
  select: [command: string]
  edit: [command: string]
  expand: []
}>()

let longPressTimer: ReturnType<typeof setTimeout> | null = null
const longPressed = ref(false)
let moved = false

function onTap(command: string) {
  emit('select', command)
}

function onTouchStart(command: string, _e: TouchEvent) {
  longPressed.value = false
  moved = false
  longPressTimer = setTimeout(() => {
    if (!moved) {
      longPressed.value = true
      emit('edit', command)
    }
  }, 300)
}

function onTouchMove() {
  moved = true
  if (longPressTimer) {
    clearTimeout(longPressTimer)
    longPressTimer = null
  }
}

function onTouchEnd(command: string) {
  if (longPressTimer) {
    clearTimeout(longPressTimer)
    longPressTimer = null
  }
  if (!longPressed.value && !moved) {
    emit('select', command)
  }
  longPressed.value = false
  moved = false
}

function cancelLongPress() {
  if (longPressTimer) {
    clearTimeout(longPressTimer)
    longPressTimer = null
  }
  longPressed.value = false
  moved = false
}
</script>

<style scoped>
.suggestion-bar {
  display: flex;
  align-items: center;
  height: 36px;
  padding: 0 6px;
  background: var(--bg-surface);
  border-bottom: 1px solid var(--border);
  overflow: hidden;
}

.suggestion-scroll {
  display: flex;
  gap: 6px;
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: none;
  -webkit-overflow-scrolling: touch;
  touch-action: pan-x;
  flex: 1;
  align-items: center;
}

.suggestion-scroll::-webkit-scrollbar {
  display: none;
}

.suggestion-chip {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
  padding: 4px 10px;
  border-radius: 14px;
  border: 1px solid var(--border);
  background: var(--bg-input);
  color: var(--fg);
  font-size: 12px;
  font-family: monospace;
  cursor: pointer;
  white-space: nowrap;
  user-select: none;
  -webkit-user-select: none;
  touch-action: pan-x;
}

.suggestion-chip:active {
  background: var(--border);
}

.suggestion-chip-freq {
  font-size: 10px;
  opacity: 0.5;
}

.suggestion-empty {
  font-size: 12px;
  color: var(--fg-muted);
  padding: 0 8px;
}

.suggestion-expand-btn {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: none;
  background: transparent;
  color: var(--fg);
  opacity: 0.6;
  cursor: pointer;
  border-radius: 4px;
}

.suggestion-expand-btn:active {
  opacity: 1;
  background: var(--border);
}
</style>
