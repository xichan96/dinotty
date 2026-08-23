<template>
  <div
    class="history-panel-overlay"
    @mousedown.self="$emit('close')"
    @touchstart.self="$emit('close')"
  >
    <div class="history-panel">
      <div class="history-panel-header">
        <input
          ref="searchRef"
          v-model="searchQuery"
          class="history-search"
          type="text"
          placeholder="Search history..."
          @input="onSearch"
        />
        <button class="history-close-btn" @click="$emit('close')">
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>
      <div class="history-list">
        <div v-for="item in filteredItems" :key="item.command" class="history-item">
          <button class="history-item-cmd" @click="$emit('select', item.command)">
            <span class="history-item-text">{{ item.command }}</span>
            <span class="history-item-freq">{{ item.frequency }}</span>
          </button>
          <button class="history-item-delete" @click="onDelete(item.command)">
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
              <polyline points="3 6 5 6 21 6" />
              <path
                d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"
              />
            </svg>
          </button>
        </div>
        <div v-if="filteredItems.length === 0" class="history-empty">No commands found</div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import type { SuggestionItem } from '@/composables/useHistory'
import { useHistory } from '@/composables/useHistory'

const props = defineProps<{
  items: SuggestionItem[]
}>()

const emit = defineEmits<{
  close: []
  select: [command: string]
  delete: [command: string]
}>()

const { deleteSuggestion } = useHistory()

const searchQuery = ref('')
const searchRef = ref<HTMLInputElement>()

const filteredItems = computed(() => {
  const q = searchQuery.value.trim().toLowerCase()
  if (!q) return props.items
  return props.items.filter((item) => item.command.toLowerCase().includes(q))
})

function onSearch() {
  // reactive via v-model
}

async function onDelete(command: string) {
  await deleteSuggestion(command)
  emit('delete', command)
}

onMounted(() => {
  searchRef.value?.focus()
})
</script>

<style scoped>
.history-panel-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  z-index: 9999;
  display: flex;
  align-items: flex-end;
  justify-content: center;
}

.history-panel {
  width: 100%;
  max-width: 500px;
  max-height: 70vh;
  background: var(--bg-surface);
  border-radius: 12px 12px 0 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.history-panel-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px;
  border-bottom: 1px solid var(--border);
}

.history-search {
  flex: 1;
  padding: 8px 12px;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: var(--bg-input);
  color: var(--fg);
  font-size: 14px;
  font-family: monospace;
  outline: none;
}

.history-search:focus {
  border-color: var(--border-focus);
}

.history-close-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: none;
  background: transparent;
  color: var(--fg);
  cursor: pointer;
  border-radius: 6px;
}

.history-close-btn:active {
  background: var(--border);
}

.history-list {
  flex: 1;
  overflow-y: auto;
  padding: 8px 0;
  -webkit-overflow-scrolling: touch;
}

.history-item {
  display: flex;
  align-items: center;
  padding: 0 12px;
}

.history-item-cmd {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  border: none;
  background: transparent;
  color: var(--fg);
  font-size: 13px;
  font-family: monospace;
  text-align: left;
  cursor: pointer;
  border-radius: 6px;
}

.history-item-cmd:active {
  background: var(--border);
}

.history-item-text {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.history-item-freq {
  font-size: 11px;
  opacity: 0.4;
  margin-left: 8px;
  flex-shrink: 0;
}

.history-item-delete {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: none;
  background: transparent;
  color: var(--fg-muted);
  cursor: pointer;
  border-radius: 4px;
  flex-shrink: 0;
}

.history-item-delete:active {
  color: var(--color-red);
  background: rgba(244, 71, 71, 0.1);
}

.history-empty {
  text-align: center;
  padding: 24px;
  color: var(--fg-muted);
  font-size: 13px;
}
</style>
