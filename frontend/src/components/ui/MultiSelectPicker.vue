<template>
  <Teleport to="body">
    <div v-if="visible" class="ms-backdrop" @mousedown.self="onCancel">
      <div class="ms-modal">
        <div class="ms-header">
          <span class="ms-title">{{ title }}</span>
          <span class="ms-count">{{ selectedCountLabel }}</span>
        </div>
        <div class="ms-input-wrap">
          <Search :size="14" />
          <input
            ref="inputRef"
            v-model="query"
            type="text"
            class="ms-input"
            :placeholder="t('palette.search')"
            autocomplete="off"
            spellcheck="false"
            @keydown="onInputKey"
          />
        </div>
        <div class="ms-list">
          <div v-if="filtered.length === 0" class="ms-empty">{{ t('multiSelect.empty') }}</div>
          <div
            v-for="(item, i) in filtered"
            :key="item.id"
            class="ms-item"
            :class="{ selected: i === cursor, checked: selectedSet.has(item.id), disabled: overMax(item.id) }"
            @mousedown.prevent="toggle(item, i)"
            @mouseenter="cursor = i"
          >
            <span class="ms-check" :class="{ checked: selectedSet.has(item.id) }">
              <Check v-if="selectedSet.has(item.id)" :size="12" />
            </span>
            <div class="ms-item-body">
              <div class="ms-item-label">{{ item.label }}</div>
              <div v-if="item.detail" class="ms-item-detail">{{ item.detail }}</div>
            </div>
          </div>
        </div>
        <div class="ms-footer">
          <span v-if="overMaxWarning" class="ms-warn">{{ overMaxWarning }}</span>
          <div class="ms-actions">
            <button class="ms-btn cancel" @click="onCancel">{{ t('multiSelect.cancel') }}</button>
            <button
              class="ms-btn primary"
              :disabled="selectedSet.size === 0 || !!overMaxWarning"
              @click="onConfirm"
            >{{ t('multiSelect.confirm') }}</button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { Search, Check } from 'lucide-vue-next'
import { useI18n } from '../../composables/useI18n'

interface PickerItem {
  id: string
  label: string
  detail?: string
}

const props = withDefaults(
  defineProps<{
    visible: boolean
    title: string
    items: PickerItem[]
    max?: number
  }>(),
  { max: 100 }
)

const emit = defineEmits<{
  confirm: [ids: string[]]
  cancel: []
}>()

const { t } = useI18n()
const query = ref('')
const cursor = ref(0)
const inputRef = ref<HTMLInputElement>()
const selectedSet = ref<Set<string>>(new Set())

const filtered = computed(() => {
  const q = query.value.trim().toLowerCase()
  if (!q) return props.items
  return props.items.filter(
    (it) =>
      it.label.toLowerCase().includes(q) || (it.detail?.toLowerCase().includes(q) ?? false)
  )
})

const selectedCountLabel = computed(() =>
  t('multiSelect.selectedCount').replace('{n}', String(selectedSet.value.size))
)

const overMaxWarning = computed(() => {
  if (selectedSet.value.size <= props.max) return ''
  return t('multiSelect.tooMany').replace('{max}', String(props.max))
})

function overMax(id: string): boolean {
  if (selectedSet.value.has(id)) return false
  return selectedSet.value.size >= props.max
}

watch(
  () => props.visible,
  (v) => {
    if (v) {
      query.value = ''
      selectedSet.value = new Set()
      cursor.value = 0
      nextTick(() => inputRef.value?.focus())
    }
  },
  { immediate: true }
)

function toggle(item: PickerItem, index: number) {
  cursor.value = index
  if (selectedSet.value.has(item.id)) {
    selectedSet.value.delete(item.id)
    selectedSet.value = new Set(selectedSet.value)
  } else if (selectedSet.value.size < props.max) {
    selectedSet.value.add(item.id)
    selectedSet.value = new Set(selectedSet.value)
  }
}

function onInputKey(e: KeyboardEvent) {
  if (e.isComposing) return
  if (e.key === 'Escape') {
    e.preventDefault()
    onCancel()
    return
  }
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    cursor.value = Math.min(cursor.value + 1, filtered.value.length - 1)
    return
  }
  if (e.key === 'ArrowUp') {
    e.preventDefault()
    cursor.value = Math.max(cursor.value - 1, 0)
    return
  }
  if (e.key === ' ' || (e.key === 'Enter' && !e.shiftKey)) {
    e.preventDefault()
    const item = filtered.value[cursor.value]
    if (item) toggle(item, cursor.value)
    return
  }
  if (e.key === 'Enter' && e.shiftKey) {
    e.preventDefault()
    onConfirm()
  }
}

function onConfirm() {
  if (selectedSet.value.size === 0 || overMaxWarning.value) return
  emit('confirm', [...selectedSet.value])
}

function onCancel() {
  emit('cancel')
}
</script>

<style scoped>
.ms-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  z-index: 2100;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: calc(15vh + env(safe-area-inset-top, 0px));
}

.ms-modal {
  width: 560px;
  max-height: 480px;
  background: var(--palette-bg);
  border: 1px solid var(--palette-border);
  border-radius: var(--radius);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  backdrop-filter: blur(8px);
}

.ms-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 14px 10px;
  border-bottom: 1px solid var(--palette-border);
}

.ms-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--fg-bright);
}

.ms-count {
  font-size: 11px;
  color: var(--fg-muted);
}

.ms-input-wrap {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 14px;
  border-bottom: 1px solid var(--palette-border);
}

.ms-input-wrap svg {
  color: var(--fg-muted);
  flex-shrink: 0;
}

.ms-input {
  flex: 1;
  background: none;
  border: none;
  outline: none;
  color: var(--fg-bright);
  font-size: 13px;
  caret-color: var(--accent);
}

.ms-input::placeholder {
  color: var(--fg-muted);
}

.ms-list {
  flex: 1;
  overflow-y: auto;
  padding: 4px 0;
  scrollbar-width: thin;
  scrollbar-color: var(--border) transparent;
}

.ms-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 14px;
  cursor: pointer;
  border-radius: 4px;
  margin: 1px 4px;
  transition: background 0.1s;
}

.ms-item:hover,
.ms-item.selected {
  background: var(--palette-select);
}

.ms-item.disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.ms-check {
  width: 14px;
  height: 14px;
  border-radius: 3px;
  border: 1px solid var(--border-hover);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  color: transparent;
}

.ms-check.checked {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--bg);
}

.ms-item-body {
  flex: 1;
  min-width: 0;
}

.ms-item-label {
  font-size: 13px;
  color: var(--fg-bright);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-family: var(--font-mono);
}

.ms-item-detail {
  font-size: 11px;
  color: var(--fg-muted);
  margin-top: 1px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-family: var(--font-mono);
}

.ms-empty {
  padding: 20px 14px;
  color: var(--fg-muted);
  text-align: center;
  font-size: 13px;
}

.ms-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 14px;
  border-top: 1px solid var(--palette-border);
}

.ms-warn {
  font-size: 11px;
  color: var(--color-yellow);
}

.ms-actions {
  display: flex;
  gap: 8px;
  margin-left: auto;
}

.ms-btn {
  padding: 5px 14px;
  border-radius: var(--radius);
  font-size: 12px;
  cursor: pointer;
  border: 1px solid transparent;
  background: none;
  color: var(--fg-muted);
  transition: background 0.15s, color 0.15s;
}

.ms-btn.cancel:hover {
  background: var(--bg-hover);
  color: var(--fg);
}

.ms-btn.primary {
  color: var(--fg-bright);
  border-color: var(--border);
}

.ms-btn.primary:hover:not(:disabled) {
  background: var(--palette-select);
  border-color: var(--border-hover);
}

.ms-btn.primary:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
</style>
