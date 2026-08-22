<template>
  <button
    ref="columnsButtonElement"
    type="button"
    class="csv-preview-icon-button"
    :class="{ active: columnDialogOpen || modelValue.length > 0 }"
    data-testid="csv-columns-toggle"
    :title="t('csvPreview.chooseColumns')"
    :aria-label="t('csvPreview.chooseColumns')"
    aria-haspopup="dialog"
    :aria-expanded="columnDialogOpen"
    aria-controls="csv-preview-columns-dialog"
    @click="openColumnDialog"
  >
    <Columns3 :size="16" aria-hidden="true" />
  </button>

  <div v-if="columnDialogOpen" class="csv-preview-dialog-backdrop" @click.self="cancelColumnDialog">
    <section
      id="csv-preview-columns-dialog"
      ref="columnDialogElement"
      class="csv-preview-columns-dialog"
      data-testid="csv-columns-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="csv-preview-columns-title"
      tabindex="-1"
      @keydown.esc="cancelColumnDialog"
    >
      <header class="csv-preview-dialog-header">
        <div>
          <h2 id="csv-preview-columns-title">{{ t('csvPreview.chooseColumns') }}</h2>
          <span>
            {{ draftVisibleColumnIndexes.length }} / {{ columnCount }}
            {{ t('csvPreview.columns') }}
          </span>
        </div>
        <button
          type="button"
          class="csv-preview-icon-button"
          :title="t('cancel')"
          :aria-label="t('cancel')"
          @click="cancelColumnDialog"
        >
          <X :size="16" aria-hidden="true" />
        </button>
      </header>

      <div class="csv-preview-dialog-tools">
        <button
          type="button"
          class="csv-preview-text-button"
          data-testid="csv-columns-select-all"
          :disabled="draftVisibleColumnIndexes.length === columnCount"
          @click="selectAllDraftColumns"
        >
          {{ t('csvPreview.showAllColumns') }}
        </button>
        <button
          type="button"
          class="csv-preview-text-button"
          data-testid="csv-columns-select-none"
          :disabled="draftVisibleColumnIndexes.length === 0"
          @click="selectNoDraftColumns"
        >
          {{ t('csvPreview.hideAllColumns') }}
        </button>
      </div>

      <div class="csv-preview-dialog-column-list">
        <label v-for="columnIndex in columnCount" :key="columnIndex">
          <input
            type="checkbox"
            :checked="isDraftColumnVisible(columnIndex - 1)"
            :data-testid="`csv-column-option-${columnIndex - 1}`"
            @change="changeDraftColumnVisibility(columnIndex - 1, $event)"
          />
          <span :title="headerText(columnIndex - 1)">{{ headerText(columnIndex - 1) }}</span>
        </label>
      </div>

      <footer class="csv-preview-dialog-footer">
        <button
          type="button"
          class="csv-preview-text-button"
          data-testid="csv-columns-cancel"
          @click="cancelColumnDialog"
        >
          {{ t('cancel') }}
        </button>
        <button
          type="button"
          class="csv-preview-primary-button"
          data-testid="csv-columns-confirm"
          @click="confirmColumnDialog"
        >
          {{ t('csvPreview.confirm') }}
        </button>
      </footer>
    </section>
  </div>
</template>

<script setup lang="ts">
import { nextTick, ref } from 'vue'
import { Columns3, X } from 'lucide-vue-next'
import { useI18n } from '../../composables/useI18n'

const props = defineProps<{
  modelValue: number[]
  columnCount: number
  headerText: (columnIndex: number) => string
}>()

const emit = defineEmits<{
  'update:modelValue': [hiddenIndexes: number[]]
}>()

const { t } = useI18n()
const columnDialogOpen = ref(false)
const draftVisibleColumnIndexes = ref<number[]>([])
const columnDialogElement = ref<HTMLElement | null>(null)
const columnsButtonElement = ref<HTMLButtonElement | null>(null)

function openColumnDialog(): void {
  const visibleIndexes: number[] = []
  for (let columnIndex = 0; columnIndex < props.columnCount; columnIndex += 1) {
    if (!props.modelValue.includes(columnIndex)) visibleIndexes.push(columnIndex)
  }
  draftVisibleColumnIndexes.value = visibleIndexes
  columnDialogOpen.value = true

  void nextTick(function focusColumnDialog() {
    columnDialogElement.value?.focus()
  })
}

function isDraftColumnVisible(columnIndex: number): boolean {
  return draftVisibleColumnIndexes.value.includes(columnIndex)
}

function changeDraftColumnVisibility(columnIndex: number, event: Event): void {
  const checkbox = event.target as HTMLInputElement
  const updatedDraftIndexes: number[] = []
  for (let index = 0; index < props.columnCount; index += 1) {
    if (index === columnIndex) {
      if (checkbox.checked) updatedDraftIndexes.push(index)
      continue
    }
    if (draftVisibleColumnIndexes.value.includes(index)) updatedDraftIndexes.push(index)
  }
  draftVisibleColumnIndexes.value = updatedDraftIndexes
}

function selectAllDraftColumns(): void {
  const allColumnIndexes: number[] = []
  for (let columnIndex = 0; columnIndex < props.columnCount; columnIndex += 1) {
    allColumnIndexes.push(columnIndex)
  }
  draftVisibleColumnIndexes.value = allColumnIndexes
}

function selectNoDraftColumns(): void {
  draftVisibleColumnIndexes.value = []
}

function closeColumnDialog(): void {
  columnDialogOpen.value = false
  void nextTick(function focusColumnsButton() {
    columnsButtonElement.value?.focus()
  })
}

function cancelColumnDialog(): void {
  closeColumnDialog()
}

function confirmColumnDialog(): void {
  const updatedHiddenIndexes: number[] = []
  for (let columnIndex = 0; columnIndex < props.columnCount; columnIndex += 1) {
    if (!draftVisibleColumnIndexes.value.includes(columnIndex)) {
      updatedHiddenIndexes.push(columnIndex)
    }
  }
  emit('update:modelValue', updatedHiddenIndexes)
  closeColumnDialog()
}
</script>

<style scoped>
.csv-preview-icon-button {
  position: relative;
  display: inline-flex;
  width: 28px;
  height: 28px;
  flex: 0 0 28px;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 1px solid var(--border, #3c3c3c);
  border-radius: 4px;
  background: var(--bg, #1a1a1a);
  color: var(--fg-muted, #888888);
  cursor: pointer;
}

.csv-preview-icon-button:hover:not(:disabled) {
  border-color: var(--accent, #89b4fa);
  color: var(--fg-bright, #eeeeee);
}

.csv-preview-icon-button.active {
  border-color: var(--accent, #89b4fa);
  background: color-mix(in srgb, var(--accent, #89b4fa) 12%, var(--bg, #1a1a1a));
  color: var(--accent, #89b4fa);
}

.csv-preview-icon-button:focus-visible {
  outline: 2px solid var(--accent, #89b4fa);
  outline-offset: 2px;
}

.csv-preview-icon-button:disabled {
  cursor: default;
  opacity: 0.35;
}

.csv-preview-text-button {
  display: inline-flex;
  height: 28px;
  flex: 0 0 auto;
  align-items: center;
  gap: 5px;
  padding: 0 8px;
  border: 1px solid var(--border, #3c3c3c);
  border-radius: 4px;
  background: var(--bg-surface, #141414);
  color: var(--fg, #cccccc);
  font: inherit;
  cursor: pointer;
}

.csv-preview-text-button:hover:not(:disabled) {
  border-color: var(--accent, #89b4fa);
}

.csv-preview-text-button:disabled {
  cursor: default;
  opacity: 0.4;
}

.csv-preview-text-button:focus-visible,
.csv-preview-primary-button:focus-visible,
.csv-preview-columns-dialog:focus-visible {
  outline: 2px solid var(--accent, #89b4fa);
  outline-offset: 2px;
}

.csv-preview-dialog-backdrop {
  position: absolute;
  z-index: 20;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 12px;
  background: rgb(0 0 0 / 55%);
  font-family: var(--font-sans, sans-serif);
}

.csv-preview-columns-dialog {
  display: flex;
  width: min(460px, 100%);
  max-height: min(560px, 100%);
  flex-direction: column;
  overflow: hidden;
  border: 1px solid var(--border, #3c3c3c);
  border-radius: 6px;
  outline: 0;
  background: var(--tab-bg, #252525);
  box-shadow: 0 12px 30px rgb(0 0 0 / 35%);
  color: var(--fg, #cccccc);
}

.csv-preview-dialog-header {
  display: flex;
  min-height: 54px;
  flex-shrink: 0;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border, #333333);
}

.csv-preview-dialog-header > div {
  min-width: 0;
}

.csv-preview-dialog-header h2 {
  margin: 0;
  color: var(--fg-bright, #eeeeee);
  font-size: 14px;
  font-weight: 600;
}

.csv-preview-dialog-header span {
  color: var(--fg-muted, #888888);
  font-size: 11px;
}

.csv-preview-dialog-tools {
  display: flex;
  flex-shrink: 0;
  justify-content: flex-end;
  gap: 7px;
  padding: 7px 12px;
  border-bottom: 1px solid var(--border, #333333);
}

.csv-preview-dialog-column-list {
  display: grid;
  min-height: 0;
  padding: 8px 12px;
  overflow-y: auto;
  gap: 5px;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  scrollbar-width: thin;
}

.csv-preview-dialog-column-list label {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 7px;
  padding: 6px 8px;
  border: 1px solid var(--border, #3c3c3c);
  border-radius: 4px;
  color: var(--fg-muted, #888888);
  cursor: pointer;
}

.csv-preview-dialog-column-list label:has(input:checked) {
  border-color: color-mix(in srgb, var(--accent, #89b4fa) 45%, var(--border, #3c3c3c));
  color: var(--fg, #cccccc);
}

.csv-preview-dialog-column-list input {
  flex: 0 0 auto;
  width: 14px;
  height: 14px;
  margin: 0;
  accent-color: var(--accent, #89b4fa);
}

.csv-preview-dialog-column-list input:focus-visible {
  outline: 2px solid var(--accent, #89b4fa);
  outline-offset: 2px;
}

.csv-preview-dialog-column-list span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.csv-preview-dialog-footer {
  display: flex;
  min-height: 46px;
  flex-shrink: 0;
  align-items: center;
  justify-content: flex-end;
  gap: 7px;
  padding: 7px 12px;
  border-top: 1px solid var(--border, #333333);
}

.csv-preview-primary-button {
  height: 28px;
  padding: 0 12px;
  border: 1px solid var(--accent, #89b4fa);
  border-radius: 4px;
  background: var(--accent, #89b4fa);
  color: var(--bg, #1a1a1a);
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}

.csv-preview-primary-button:disabled {
  cursor: default;
  opacity: 0.4;
}

@media (max-width: 560px) {
  .csv-preview-dialog-backdrop {
    padding: 8px;
  }

  .csv-preview-dialog-column-list {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
