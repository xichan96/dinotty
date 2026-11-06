<template>
  <div class="csv-preview">
    <div class="csv-preview-toolbar">
      <div class="csv-preview-summary">
        <TableProperties :size="15" aria-hidden="true" />
        <span>{{ filteredRows.length }} {{ t('csvPreview.rows') }}</span>
        <span class="csv-preview-separator">·</span>
        <span>
          {{ visibleColumnIndexes.length
          }}<template v-if="hiddenColumnIndexes.length > 0"> / {{ columnCount }}</template>
          {{ t('csvPreview.columns') }}
        </span>
      </div>

      <label class="csv-preview-search">
        <Search :size="14" aria-hidden="true" />
        <span class="sr-only">{{ t('csvPreview.search') }}</span>
        <input
          v-model="searchText"
          type="search"
          :placeholder="t('csvPreview.search')"
          @input="resetPage"
        />
      </label>

      <button
        type="button"
        class="csv-preview-icon-button"
        :class="{ active: filterPanelOpen || filterIsActive }"
        data-testid="csv-filter-toggle"
        :title="t('csvPreview.filter')"
        :aria-label="t('csvPreview.filter')"
        :aria-pressed="filterPanelOpen"
        aria-controls="csv-preview-filter-panel"
        @click="toggleFilterPanel"
      >
        <ListFilter :size="16" aria-hidden="true" />
        <span v-if="activeFilterCount > 0" class="csv-preview-filter-count">
          {{ activeFilterCount }}
        </span>
      </button>

      <CsvColumnDialog
        v-model="hiddenColumnIndexes"
        :column-count="columnCount"
        :header-text="headerText"
      />

      <label class="csv-preview-header-toggle">
        <input v-model="firstRowIsHeader" type="checkbox" @change="resetPage" />
        <span>{{ t('csvPreview.firstRowHeader') }}</span>
      </label>

      <label v-if="encodingAvailable" class="csv-preview-encoding">
        <span class="sr-only">{{ t('csvPreview.encoding') }}</span>
        <select
          v-model="selectedEncoding"
          data-testid="csv-encoding-select"
          :title="t('csvPreview.encoding')"
          :aria-label="t('csvPreview.encoding')"
          @change="changeEncoding"
        >
          <option value="utf-8">UTF-8</option>
          <option value="gbk">GBK</option>
        </select>
      </label>

      <button
        v-if="sourceAvailable"
        type="button"
        class="csv-preview-icon-button"
        data-testid="csv-source-button"
        :title="t('filePreview.source')"
        :aria-label="t('filePreview.source')"
        @click="emitShowSource"
      >
        <Code2 :size="16" aria-hidden="true" />
      </button>
    </div>

    <div
      v-if="filterPanelOpen"
      id="csv-preview-filter-panel"
      class="csv-preview-filter-panel"
      data-testid="csv-filter-panel"
    >
      <div class="csv-preview-filter-header">
        <div
          class="csv-preview-logic-switch"
          role="group"
          :aria-label="t('csvPreview.combineMode')"
        >
          <button
            type="button"
            :class="{ active: filterLogicMode === 'and' }"
            data-testid="csv-filter-logic-and"
            :aria-pressed="filterLogicMode === 'and'"
            @click="setFilterLogicMode('and')"
          >
            {{ t('csvPreview.matchAll') }}
          </button>
          <button
            type="button"
            :class="{ active: filterLogicMode === 'or' }"
            data-testid="csv-filter-logic-or"
            :aria-pressed="filterLogicMode === 'or'"
            @click="setFilterLogicMode('or')"
          >
            {{ t('csvPreview.matchAny') }}
          </button>
        </div>

        <button
          type="button"
          class="csv-preview-text-button"
          data-testid="csv-filter-add"
          @click="addFilterCondition"
        >
          <Plus :size="14" aria-hidden="true" />
          {{ t('csvPreview.addCondition') }}
        </button>

        <button
          type="button"
          class="csv-preview-icon-button"
          data-testid="csv-filter-clear"
          :disabled="!filterIsActive"
          :title="t('csvPreview.clearFilter')"
          :aria-label="t('csvPreview.clearFilter')"
          @click="clearFilter"
        >
          <X :size="15" aria-hidden="true" />
        </button>
      </div>

      <div class="csv-preview-filter-conditions">
        <div
          v-for="(condition, conditionIndex) in filterConditions"
          :key="condition.id"
          class="csv-preview-filter-condition"
          :data-testid="`csv-filter-condition-${conditionIndex}`"
        >
          <span class="csv-preview-condition-number">{{ conditionIndex + 1 }}</span>

          <label class="csv-preview-filter-negate">
            <input
              v-model="condition.negated"
              type="checkbox"
              :data-testid="`csv-filter-negate-${conditionIndex}`"
              @change="resetPage"
            />
            <span>{{ t('csvPreview.negate') }}</span>
          </label>

          <label>
            <span class="sr-only">{{ t('csvPreview.filterColumn') }}</span>
            <select
              v-model.number="condition.columnIndex"
              :data-testid="`csv-filter-column-${conditionIndex}`"
              :aria-label="t('csvPreview.filterColumn')"
              @change="resetPage"
            >
              <option :value="-1">{{ t('csvPreview.allColumns') }}</option>
              <option
                v-for="columnIndex in columnCount"
                :key="columnIndex"
                :value="columnIndex - 1"
              >
                {{ headerText(columnIndex - 1) }}
              </option>
            </select>
          </label>

          <label>
            <span class="sr-only">{{ t('csvPreview.filterOperator') }}</span>
            <select
              v-model="condition.operator"
              :data-testid="`csv-filter-operator-${conditionIndex}`"
              :aria-label="t('csvPreview.filterOperator')"
              @change="resetPage"
            >
              <option value="contains">{{ t('csvPreview.contains') }}</option>
              <option value="notContains">{{ t('csvPreview.notContains') }}</option>
              <option value="equals">{{ t('csvPreview.equals') }}</option>
              <option value="notEquals">{{ t('csvPreview.notEquals') }}</option>
              <option value="startsWith">{{ t('csvPreview.startsWith') }}</option>
              <option value="endsWith">{{ t('csvPreview.endsWith') }}</option>
              <option value="isEmpty">{{ t('csvPreview.isEmpty') }}</option>
              <option value="isNotEmpty">{{ t('csvPreview.isNotEmpty') }}</option>
              <optgroup :label="t('csvPreview.numberOperators')">
                <option value="numberEquals">{{ t('csvPreview.numberEquals') }}</option>
                <option value="numberGreaterThan">
                  {{ t('csvPreview.numberGreaterThan') }}
                </option>
                <option value="numberGreaterThanOrEqual">
                  {{ t('csvPreview.numberGreaterThanOrEqual') }}
                </option>
                <option value="numberLessThan">{{ t('csvPreview.numberLessThan') }}</option>
                <option value="numberLessThanOrEqual">
                  {{ t('csvPreview.numberLessThanOrEqual') }}
                </option>
              </optgroup>
              <optgroup :label="t('csvPreview.dateOperators')">
                <option value="dateEquals">{{ t('csvPreview.dateEquals') }}</option>
                <option value="dateBefore">{{ t('csvPreview.dateBefore') }}</option>
                <option value="dateBeforeOrEqual">
                  {{ t('csvPreview.dateBeforeOrEqual') }}
                </option>
                <option value="dateAfter">{{ t('csvPreview.dateAfter') }}</option>
                <option value="dateAfterOrEqual">
                  {{ t('csvPreview.dateAfterOrEqual') }}
                </option>
              </optgroup>
            </select>
          </label>

          <label v-if="conditionNeedsValue(condition)" class="csv-preview-filter-value">
            <span class="sr-only">{{ t('csvPreview.filterValue') }}</span>
            <input
              v-model="condition.value"
              :data-testid="`csv-filter-value-${conditionIndex}`"
              :type="conditionInputType(condition)"
              :step="conditionInputType(condition) === 'number' ? 'any' : undefined"
              :placeholder="t('csvPreview.filterValue')"
              @input="resetPage"
            />
          </label>
          <span v-else class="csv-preview-filter-value-placeholder"></span>

          <button
            type="button"
            class="csv-preview-icon-button"
            :disabled="filterConditions.length <= 1"
            :title="t('csvPreview.removeCondition')"
            :aria-label="t('csvPreview.removeCondition')"
            :data-testid="`csv-filter-remove-${conditionIndex}`"
            @click="removeFilterCondition(conditionIndex)"
          >
            <Trash2 :size="14" aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>

    <div v-if="displayedContentIsTruncated" class="csv-preview-notice" role="status">
      {{ truncatedMessage || t('csvPreview.truncated') }}
    </div>

    <div v-if="encodingLoading" class="csv-preview-notice" role="status">
      {{ t('csvPreview.encodingLoading') }}
    </div>

    <div v-if="encodingError" class="csv-preview-notice error" role="alert">
      {{ encodingError }}
    </div>

    <div v-if="parsedRows.length === 0" class="csv-preview-empty">
      {{ t('csvPreview.empty') }}
    </div>

    <div v-else-if="filteredRows.length === 0" class="csv-preview-empty">
      {{ t('csvPreview.noMatches') }}
    </div>

    <div v-else class="csv-preview-table-scroll">
      <table>
        <thead>
          <tr>
            <th class="csv-preview-row-number" scope="col">#</th>
            <th v-for="columnIndex in visibleColumnIndexes" :key="columnIndex" scope="col">
              {{ headerText(columnIndex) }}
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="visibleRow in visibleRows" :key="visibleRow.sourceIndex">
            <th class="csv-preview-row-number" scope="row">
              {{ visibleRow.sourceIndex + 1 }}
            </th>
            <td
              v-for="columnIndex in visibleColumnIndexes"
              :key="columnIndex"
              :title="cellText(visibleRow.cells, columnIndex)"
            >
              {{ cellText(visibleRow.cells, columnIndex) }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="filteredRows.length > 0" class="csv-preview-footer">
      <span>{{ pageStart + 1 }}–{{ pageEnd }} / {{ filteredRows.length }}</span>
      <div class="csv-preview-pagination">
        <button
          type="button"
          class="csv-preview-icon-button"
          :disabled="currentPage <= 1"
          :title="t('csvPreview.previousPage')"
          :aria-label="t('csvPreview.previousPage')"
          @click="goToPreviousPage"
        >
          <ChevronLeft :size="16" aria-hidden="true" />
        </button>
        <span>{{ currentPage }} / {{ pageCount }}</span>
        <button
          type="button"
          class="csv-preview-icon-button"
          :disabled="currentPage >= pageCount"
          :title="t('csvPreview.nextPage')"
          :aria-label="t('csvPreview.nextPage')"
          @click="goToNextPage"
        >
          <ChevronRight :size="16" aria-hidden="true" />
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, toRef } from 'vue'
import {
  ChevronLeft,
  ChevronRight,
  Code2,
  ListFilter,
  Plus,
  Search,
  TableProperties,
  Trash2,
  X,
} from 'lucide-vue-next'
import { useI18n } from '../../composables/useI18n'
import { detectCsvDelimiter, parseCsvText } from '../../utils/csvPreview'
import { useCsvFilter, type VisibleCsvRow } from '../../composables/useCsvFilter'
import { useCsvEncoding } from '../../composables/useCsvEncoding'
import CsvColumnDialog from './CsvColumnDialog.vue'

type PaginatedRow = VisibleCsvRow

const props = withDefaults(
  defineProps<{
    content?: string
    filePath: string
    rawUrl?: string
    sourceAvailable?: boolean
    truncated: boolean
    pageSize?: number
    rows?: string[][]
    encodingAvailable?: boolean
    truncatedMessage?: string
  }>(),
  {
    content: '',
    pageSize: 200,
    rawUrl: '',
    sourceAvailable: true,
    rows: undefined,
    encodingAvailable: true,
    truncatedMessage: '',
  }
)

const emit = defineEmits<{
  showSource: []
}>()

const { t } = useI18n()
const firstRowIsHeader = ref(true)
const currentPage = ref(1)
const hiddenColumnIndexes = ref<number[]>([])

// Spreadsheet cells arrive as `rows`; without raw-file access the encoding
// selector must not fetch the binary (xlsx) source.
const encodingRawUrl = computed(function computeEncodingRawUrl() {
  return props.encodingAvailable ? props.rawUrl : ''
})

const encoding = useCsvEncoding({
  content: toRef(props, 'content'),
  filePath: toRef(props, 'filePath'),
  rawUrl: encodingRawUrl,
  truncated: toRef(props, 'truncated'),
  t,
  onFileChanged: () => {
    currentPage.value = 1
    filter.reset()
    hiddenColumnIndexes.value = []
  },
})
const {
  selectedEncoding,
  encodingLoading,
  encodingError,
  displayedContent,
  displayedContentIsTruncated,
  changeEncoding,
} = encoding

const parsedRows = computed(function computeParsedRows() {
  // Spreadsheet previews hand over dense rows directly; CSV/TSV parse content.
  if (props.rows !== undefined) return props.rows
  const delimiter = detectCsvDelimiter(displayedContent.value, props.filePath)
  return parseCsvText(displayedContent.value, delimiter)
})

const columnCount = computed(function computeColumnCount() {
  let longestRowLength = 0
  for (let rowIndex = 0; rowIndex < parsedRows.value.length; rowIndex += 1) {
    const currentLength = parsedRows.value[rowIndex].length
    if (currentLength > longestRowLength) longestRowLength = currentLength
  }
  return longestRowLength
})

const visibleColumnIndexes = computed(function computeVisibleColumnIndexes() {
  const columnIndexes: number[] = []
  for (let columnIndex = 0; columnIndex < columnCount.value; columnIndex += 1) {
    if (!hiddenColumnIndexes.value.includes(columnIndex)) columnIndexes.push(columnIndex)
  }
  return columnIndexes
})

function headerText(columnIndex: number): string {
  if (firstRowIsHeader.value && parsedRows.value[0]?.[columnIndex] !== undefined) {
    return parsedRows.value[0][columnIndex]
  }
  return `${t('csvPreview.column')} ${columnIndex + 1}`
}

const filter = useCsvFilter({
  parsedRows,
  columnCount,
  firstRowIsHeader,
  onFilterChanged: () => {
    currentPage.value = 1
  },
})

const {
  searchText,
  filterPanelOpen,
  filterLogicMode,
  filterConditions,
  activeFilterCount,
  filterIsActive,
  filteredRows,
  cellText,
  conditionNeedsValue,
  conditionInputType,
  toggleFilterPanel,
  setFilterLogicMode,
  addFilterCondition,
  removeFilterCondition,
  clearFilter,
} = filter

const pageCount = computed(function computePageCount() {
  return Math.max(1, Math.ceil(filteredRows.value.length / props.pageSize))
})

const pageStart = computed(function computePageStart() {
  return (currentPage.value - 1) * props.pageSize
})

const pageEnd = computed(function computePageEnd() {
  return Math.min(pageStart.value + props.pageSize, filteredRows.value.length)
})

const visibleRows = computed<PaginatedRow[]>(function computeVisibleRows() {
  const currentRows: PaginatedRow[] = []
  for (let rowIndex = pageStart.value; rowIndex < pageEnd.value; rowIndex += 1) {
    currentRows.push(filteredRows.value[rowIndex])
  }
  return currentRows
})

function resetPage(): void {
  currentPage.value = 1
}

function goToPreviousPage(): void {
  if (currentPage.value > 1) currentPage.value -= 1
}

function goToNextPage(): void {
  if (currentPage.value < pageCount.value) currentPage.value += 1
}

function emitShowSource(): void {
  emit('showSource')
}
</script>

<style scoped>
.csv-preview {
  position: relative;
  display: flex;
  flex: 1 1 0;
  min-width: 0;
  min-height: 0;
  flex-direction: column;
  overflow: hidden;
  color: var(--fg, #cccccc);
  background: var(--bg-surface, #141414);
  font-family: var(--font-mono, monospace);
  container-type: inline-size;
}

.csv-preview-toolbar {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--border, #333333);
  background: var(--tab-bg, #252525);
}

.csv-preview-summary,
.csv-preview-header-toggle,
.csv-preview-encoding,
.csv-preview-search,
.csv-preview-pagination {
  display: flex;
  align-items: center;
}

.csv-preview-summary {
  gap: 5px;
  color: var(--fg-muted, #888888);
  font-size: 12px;
  white-space: nowrap;
}

.csv-preview-summary svg {
  color: var(--accent, #89b4fa);
}

.csv-preview-separator {
  opacity: 0.55;
}

.csv-preview-search {
  flex: 1 1 180px;
  min-width: 140px;
  max-width: 320px;
  gap: 6px;
  padding: 0 8px;
  border: 1px solid var(--border, #3c3c3c);
  border-radius: 4px;
  background: var(--bg, #1a1a1a);
  color: var(--fg-muted, #888888);
}

.csv-preview-search:focus-within {
  border-color: var(--accent, #89b4fa);
}

.csv-preview-search input {
  width: 100%;
  min-width: 0;
  height: 28px;
  padding: 0;
  border: 0;
  outline: 0;
  background: transparent;
  color: var(--fg, #cccccc);
  font: inherit;
  font-size: 12px;
}

.csv-preview-header-toggle {
  gap: 5px;
  color: var(--fg-muted, #888888);
  font-size: 12px;
  cursor: pointer;
  white-space: nowrap;
}

.csv-preview-header-toggle input {
  width: 14px;
  height: 14px;
  margin: 0;
  accent-color: var(--accent, #89b4fa);
}

.csv-preview-encoding select {
  box-sizing: border-box;
  height: 28px;
  padding: 0 22px 0 7px;
  border: 1px solid var(--border, #3c3c3c);
  border-radius: 4px;
  outline: 0;
  background: var(--bg, #1a1a1a);
  color: var(--fg-muted, #888888);
  font: inherit;
  font-size: 11px;
}

.csv-preview-encoding select:focus-visible {
  outline: 2px solid var(--accent, #89b4fa);
  outline-offset: 2px;
}

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

.csv-preview-icon-button:focus-visible,
.csv-preview-header-toggle input:focus-visible {
  outline: 2px solid var(--accent, #89b4fa);
  outline-offset: 2px;
}

.csv-preview-icon-button:disabled {
  cursor: default;
  opacity: 0.35;
}

.csv-preview-filter-count {
  position: absolute;
  top: -5px;
  right: -5px;
  display: inline-flex;
  min-width: 14px;
  height: 14px;
  align-items: center;
  justify-content: center;
  padding: 0 3px;
  border: 1px solid var(--tab-bg, #252525);
  border-radius: 7px;
  background: var(--accent, #89b4fa);
  color: var(--bg, #1a1a1a);
  font-size: 9px;
  font-weight: 700;
  line-height: 12px;
}

.csv-preview-filter-panel {
  display: flex;
  min-width: 0;
  max-height: 220px;
  flex-shrink: 0;
  flex-direction: column;
  border-bottom: 1px solid var(--border, #333333);
  background: var(--bg, #1a1a1a);
  color: var(--fg-muted, #888888);
  font-family: var(--font-sans, sans-serif);
  font-size: 12px;
}

.csv-preview-filter-header {
  display: flex;
  min-height: 38px;
  flex-shrink: 0;
  align-items: center;
  gap: 7px;
  padding: 4px 10px;
  border-bottom: 1px solid color-mix(in srgb, var(--border, #333333) 70%, transparent);
}

.csv-preview-logic-switch {
  display: inline-flex;
  flex: 0 0 auto;
}

.csv-preview-logic-switch button {
  height: 28px;
  padding: 0 8px;
  border: 1px solid var(--border, #3c3c3c);
  background: var(--bg-surface, #141414);
  color: var(--fg-muted, #888888);
  font: inherit;
  cursor: pointer;
}

.csv-preview-logic-switch button:first-child {
  border-radius: 4px 0 0 4px;
}

.csv-preview-logic-switch button:last-child {
  margin-left: -1px;
  border-radius: 0 4px 4px 0;
}

.csv-preview-logic-switch button.active {
  z-index: 1;
  border-color: var(--accent, #89b4fa);
  color: var(--accent, #89b4fa);
}

.csv-preview-filter-conditions {
  min-height: 0;
  overflow: auto;
  scrollbar-width: thin;
}

.csv-preview-filter-condition {
  display: grid;
  min-width: 620px;
  align-items: center;
  gap: 7px;
  padding: 5px 10px;
  border-bottom: 1px solid color-mix(in srgb, var(--border, #333333) 55%, transparent);
  grid-template-columns:
    22px auto minmax(110px, 160px) minmax(100px, 140px) minmax(120px, 1fr)
    28px;
}

.csv-preview-filter-condition:last-child {
  border-bottom: 0;
}

.csv-preview-condition-number {
  color: var(--fg-muted, #888888);
  font-variant-numeric: tabular-nums;
  text-align: right;
}

.csv-preview-filter-negate {
  display: flex;
  align-items: center;
  gap: 4px;
  color: var(--fg-muted, #888888);
  cursor: pointer;
}

.csv-preview-filter-negate input {
  width: 14px;
  height: 14px;
  margin: 0;
  accent-color: var(--accent, #89b4fa);
}

.csv-preview-filter-condition select,
.csv-preview-filter-value input {
  box-sizing: border-box;
  width: 100%;
  height: 28px;
  border: 1px solid var(--border, #3c3c3c);
  border-radius: 4px;
  outline: 0;
  background: var(--bg-surface, #141414);
  color: var(--fg, #cccccc);
  font: inherit;
}

.csv-preview-filter-condition select {
  padding: 0 24px 0 8px;
}

.csv-preview-filter-value {
  min-width: 0;
}

.csv-preview-filter-value input {
  padding: 0 8px;
}

.csv-preview-filter-condition select:focus-visible,
.csv-preview-filter-value input:focus-visible,
.csv-preview-filter-negate input:focus-visible,
.csv-preview-logic-switch button:focus-visible,
.csv-preview-text-button:focus-visible {
  outline: 2px solid var(--accent, #89b4fa);
  outline-offset: 2px;
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

.csv-preview-notice {
  flex-shrink: 0;
  padding: 5px 10px;
  border-bottom: 1px solid color-mix(in srgb, var(--color-orange, #d19a66) 35%, transparent);
  background: color-mix(in srgb, var(--color-orange, #d19a66) 8%, transparent);
  color: var(--color-orange, #d19a66);
  font-family: var(--font-sans, sans-serif);
  font-size: 12px;
}

.csv-preview-notice.error {
  border-bottom-color: color-mix(in srgb, var(--color-red, #f44747) 35%, transparent);
  background: color-mix(in srgb, var(--color-red, #f44747) 8%, transparent);
  color: var(--color-red, #f44747);
}

.csv-preview-empty {
  display: flex;
  flex: 1 1 0;
  align-items: center;
  justify-content: center;
  min-height: 120px;
  padding: 16px;
  color: var(--fg-muted, #888888);
  font-family: var(--font-sans, sans-serif);
  font-size: 13px;
  text-align: center;
}

.csv-preview-table-scroll {
  flex: 1 1 0;
  min-height: 0;
  overflow: auto;
}

.csv-preview table {
  width: max-content;
  min-width: 100%;
  border-collapse: separate;
  border-spacing: 0;
  font-size: 12px;
  line-height: 18px;
}

.csv-preview th,
.csv-preview td {
  box-sizing: border-box;
  max-width: 420px;
  padding: 6px 9px;
  overflow: hidden;
  border-right: 1px solid var(--border, #333333);
  border-bottom: 1px solid var(--border, #333333);
  text-align: left;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.csv-preview th:last-child,
.csv-preview td:last-child {
  border-right: 0;
}

.csv-preview thead th {
  position: sticky;
  z-index: 2;
  top: 0;
  background: var(--tab-bg, #252525);
  color: var(--fg-bright, #eeeeee);
  font-weight: 600;
}

.csv-preview tbody tr:hover th,
.csv-preview tbody tr:hover td {
  background: var(--bg-hover, #2a2a2a);
}

.csv-preview .csv-preview-row-number {
  position: sticky;
  z-index: 1;
  left: 0;
  width: 52px;
  min-width: 52px;
  max-width: 52px;
  background: var(--tab-bg, #252525);
  color: var(--fg-muted, #888888);
  text-align: right;
  user-select: none;
}

.csv-preview thead .csv-preview-row-number {
  z-index: 3;
}

.csv-preview-footer {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 34px;
  padding: 3px 10px;
  border-top: 1px solid var(--border, #333333);
  background: var(--tab-bg, #252525);
  color: var(--fg-muted, #888888);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}

.csv-preview-pagination {
  gap: 7px;
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

@container (max-width: 560px) {
  .csv-preview-toolbar {
    flex-wrap: nowrap;
    overflow-x: auto;
    scrollbar-width: thin;
  }

  .csv-preview-search {
    flex: 0 0 150px;
    max-width: 150px;
  }

  .csv-preview-summary,
  .csv-preview-header-toggle,
  .csv-preview-encoding,
  .csv-preview-icon-button {
    flex-shrink: 0;
  }

  .csv-preview-filter-header {
    overflow-x: auto;
    scrollbar-width: thin;
  }

  .csv-preview-filter-header > * {
    flex-shrink: 0;
  }
}
</style>
