<template>
  <div class="search-bar" @mousedown.prevent>
    <div class="search-bar-input-wrap">
      <Search :size="14" />
      <input
        ref="inputRef"
        type="text"
        class="search-bar-input"
        :placeholder="t('search.placeholder')"
        autocomplete="off"
        spellcheck="false"
        v-model="query"
        @keydown="onKey"
      />
      <span v-if="resultText" class="search-bar-count">{{ resultText }}</span>
    </div>
    <button
      class="search-bar-btn"
      :title="t('search.previous')"
      :aria-label="t('search.previous')"
      @click="findPrev"
    >
      <ChevronUp :size="14" />
    </button>
    <button
      class="search-bar-btn"
      :title="t('search.next')"
      :aria-label="t('search.next')"
      @click="findNext"
    >
      <ChevronDown :size="14" />
    </button>
    <button
      class="search-bar-btn"
      :title="t('search.close')"
      :aria-label="t('search.close')"
      @click="emit('close')"
    >
      <X :size="14" />
    </button>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, nextTick, computed } from 'vue'
import { Search, ChevronUp, ChevronDown, X } from 'lucide-vue-next'
import type { TerminalInstance } from '../../composables/useTerminal'
import { useI18n } from '../../composables/useI18n'

const props = defineProps<{
  terminal: TerminalInstance
}>()

const emit = defineEmits<{
  close: []
}>()
const { t } = useI18n()

const query = ref('')
const inputRef = ref<HTMLInputElement>()
const resultCount = ref(0)
const currentIndex = ref(0)

const resultText = computed(() => {
  if (!query.value) return ''
  if (resultCount.value === 0) return t('search.noResults')
  return t('search.resultCount', {
    current: currentIndex.value,
    total: resultCount.value,
  })
})

function doSearch(direction: 'next' | 'prev' = 'next') {
  const addon = props.terminal.searchAddon
  if (!addon) return

  const term = query.value
  if (!term) {
    addon.clearDecorations()
    resultCount.value = 0
    currentIndex.value = 0
    return
  }

  const opts = { caseSensitive: false, wholeWord: false, regex: false }
  if (direction === 'next') {
    addon.findNext(term, opts)
  } else {
    addon.findPrevious(term, opts)
  }
}

function findNext() {
  doSearch('next')
}

function findPrev() {
  doSearch('prev')
}

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    e.preventDefault()
    emit('close')
  } else if (e.key === 'Enter') {
    e.preventDefault()
    if (e.shiftKey) {
      findPrev()
    } else {
      findNext()
    }
  }
}

watch(query, () => {
  doSearch('next')
})

onMounted(() => {
  nextTick(() => inputRef.value?.focus())
})
</script>

<style scoped>
.search-bar {
  position: absolute;
  top: 4px;
  right: 4px;
  z-index: 10;
  display: flex;
  align-items: center;
  gap: 2px;
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 4px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
  backdrop-filter: blur(8px);
}

.search-bar-input-wrap {
  display: flex;
  align-items: center;
  gap: 6px;
  background: var(--bg-input);
  border: 1px solid transparent;
  border-radius: 4px;
  padding: 4px 8px;
  transition: border-color 0.15s;
}

.search-bar-input-wrap:focus-within {
  border-color: var(--border-focus, #8a8a8a);
}

.search-bar-input-wrap svg {
  color: var(--fg-muted, #858585);
  flex-shrink: 0;
}

.search-bar-input {
  background: none;
  border: none;
  outline: none;
  color: var(--fg);
  font-size: 13px;
  font-family: inherit;
  width: 160px;
  padding: 0;
}

.search-bar-input::placeholder {
  color: var(--fg-muted, #858585);
}

.search-bar-count {
  color: var(--fg-muted, #858585);
  font-size: 11px;
  white-space: nowrap;
  flex-shrink: 0;
}

.search-bar-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  background: none;
  border: none;
  border-radius: 4px;
  color: var(--fg-muted, #858585);
  cursor: pointer;
  transition:
    background-color 0.1s,
    color 0.1s;
}

.search-bar-btn:hover {
  background: var(--bg-hover);
  color: var(--fg);
}

@media (max-width: 480px) {
  .search-bar {
    left: 4px;
    right: 4px;
    min-width: 0;
  }

  .search-bar-input-wrap {
    flex: 1 1 auto;
    min-width: 0;
  }

  .search-bar-input {
    width: 100%;
    min-width: 0;
  }
}
</style>
