<template>
  <div class="spreadsheet-preview">
    <div v-if="state === 'loading'" class="spreadsheet-placeholder" role="status">
      {{ t('filePreview.loading') }}
    </div>
    <div v-else-if="state === 'legacy'" class="spreadsheet-placeholder" role="status">
      {{ t('spreadsheetPreview.legacyXls') }}
    </div>
    <div v-else-if="state === 'too-large'" class="spreadsheet-placeholder" role="status">
      {{ t('spreadsheetPreview.tooLarge') }}
    </div>
    <div v-else-if="state === 'error'" class="spreadsheet-placeholder error" role="alert">
      {{ t('spreadsheetPreview.parseFailed') }}
    </div>
    <div v-else-if="state === 'empty'" class="spreadsheet-placeholder" role="status">
      {{ t('spreadsheetPreview.empty') }}
    </div>

    <template v-else-if="state === 'ready'">
      <div v-if="sheetsTruncated" class="spreadsheet-notice" role="status">
        {{ t('spreadsheetPreview.sheetsTruncated', { count: sheets.length }) }}
      </div>

      <div class="spreadsheet-tabs" role="tablist">
        <button
          v-for="(sheet, index) in sheets"
          :id="`spreadsheet-sheet-tab-${index}`"
          :key="index"
          type="button"
          role="tab"
          class="spreadsheet-tab"
          :class="{ active: index === activeSheetIndex }"
          :data-testid="`sheet-tab-${index}`"
          :aria-selected="index === activeSheetIndex"
          :aria-controls="`spreadsheet-sheet-panel-${index}`"
          @click="selectSheet(index)"
        >
          {{ sheet.name }}
        </button>
      </div>

      <div
        :id="`spreadsheet-sheet-panel-${activeSheetIndex}`"
        class="spreadsheet-sheet"
        role="tabpanel"
        :aria-labelledby="`spreadsheet-sheet-tab-${activeSheetIndex}`"
      >
        <CsvPreview
          v-if="activeSheet"
          :key="`${rawUrl}:${activeSheetIndex}`"
          :rows="activeSheet.rows"
          content=""
          :file-path="filePath"
          :truncated="activeSheet.truncated"
          :truncated-message="t('spreadsheetPreview.truncated')"
          :encoding-available="false"
          :source-available="false"
        />
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from '../../composables/useI18n'
import { authFetch } from '../../composables/apiBase'
import { SPREADSHEET_LIMITS, buildSpreadsheet, isLegacyXlsPath } from '../../utils/spreadsheet'
import type { SheetTable } from '../../utils/spreadsheet'
import CsvPreview from './CsvPreview.vue'

type PreviewState = 'loading' | 'ready' | 'empty' | 'legacy' | 'too-large' | 'error'

const props = defineProps<{
  rawUrl: string
  filePath: string
  paneId?: string
}>()

const { t } = useI18n()

const state = ref<PreviewState>('loading')
const sheets = ref<SheetTable[]>([])
const sheetsTruncated = ref(false)
const activeSheetIndex = ref(0)

const activeSheet = computed<SheetTable | undefined>(() => sheets.value[activeSheetIndex.value])

/** Discards results that resolve after the file changed. */
let loadToken = 0

function selectSheet(index: number): void {
  if (index < 0 || index >= sheets.value.length) return
  activeSheetIndex.value = index
}

function declaredByteLength(response: Response): number | undefined {
  const raw = response.headers?.get?.('content-length')
  if (!raw) return undefined
  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined
}

async function load(): Promise<void> {
  const token = ++loadToken
  sheets.value = []
  sheetsTruncated.value = false
  activeSheetIndex.value = 0

  // Legacy CFB .xls cannot be parsed by officeparser: say so without fetching.
  if (isLegacyXlsPath(props.filePath)) {
    state.value = 'legacy'
    return
  }
  if (!props.rawUrl) {
    state.value = 'error'
    return
  }

  state.value = 'loading'
  try {
    const response = await authFetch(props.rawUrl)
    if (token !== loadToken) return
    if (!response.ok) throw new Error(`HTTP ${response.status}`)

    const declared = declaredByteLength(response)
    if (declared !== undefined && declared > SPREADSHEET_LIMITS.maxBytes) {
      state.value = 'too-large'
      return
    }
    if (typeof response.arrayBuffer !== 'function') throw new Error('response has no body')

    const buffer = await response.arrayBuffer()
    if (token !== loadToken) return
    if (buffer.byteLength > SPREADSHEET_LIMITS.maxBytes) {
      state.value = 'too-large'
      return
    }

    const { parseOffice } = await import('officeparser')
    if (token !== loadToken) return
    const ast = await parseOffice(buffer, { includeRawContent: true })
    if (token !== loadToken) return

    const data = buildSpreadsheet(ast)
    sheets.value = data.sheets
    sheetsTruncated.value = data.sheetsTruncated
    state.value = data.sheets.length === 0 ? 'empty' : 'ready'
  } catch {
    if (token === loadToken) state.value = 'error'
  }
}

watch(
  () => [props.rawUrl, props.filePath] as const,
  () => {
    void load()
  },
  { immediate: true }
)
</script>

<style scoped>
.spreadsheet-preview {
  display: flex;
  flex: 1 1 0;
  min-width: 0;
  min-height: 0;
  flex-direction: column;
  overflow: hidden;
  color: var(--fg, #cccccc);
  background: var(--bg-surface, #141414);
  font-family: var(--font-mono, monospace);
}

.spreadsheet-placeholder {
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

.spreadsheet-placeholder.error {
  color: var(--color-red, #f44747);
}

.spreadsheet-notice {
  flex-shrink: 0;
  padding: 5px 10px;
  border-bottom: 1px solid color-mix(in srgb, var(--color-orange, #d19a66) 35%, transparent);
  background: color-mix(in srgb, var(--color-orange, #d19a66) 8%, transparent);
  color: var(--color-orange, #d19a66);
  font-family: var(--font-sans, sans-serif);
  font-size: 12px;
}

.spreadsheet-tabs {
  display: flex;
  flex-shrink: 0;
  gap: 4px;
  padding: 5px 10px;
  overflow-x: auto;
  overscroll-behavior-x: contain;
  border-bottom: 1px solid var(--border, #333333);
  background: var(--tab-bg, #252525);
  scrollbar-width: thin;
}

.spreadsheet-tab {
  flex: 0 0 auto;
  height: 28px;
  padding: 0 12px;
  border: 1px solid var(--border, #3c3c3c);
  border-radius: 4px;
  background: var(--bg, #1a1a1a);
  color: var(--fg-muted, #888888);
  font: inherit;
  font-size: 12px;
  white-space: nowrap;
  cursor: pointer;
}

.spreadsheet-tab:hover {
  border-color: var(--accent, #89b4fa);
  color: var(--fg-bright, #eeeeee);
}

.spreadsheet-tab.active {
  border-color: var(--accent, #89b4fa);
  background: color-mix(in srgb, var(--accent, #89b4fa) 12%, var(--bg, #1a1a1a));
  color: var(--accent, #89b4fa);
}

.spreadsheet-tab:focus-visible {
  outline: 2px solid var(--accent, #89b4fa);
  outline-offset: 2px;
}

.spreadsheet-sheet {
  display: flex;
  flex: 1 1 0;
  min-height: 0;
  overflow: hidden;
}
</style>
