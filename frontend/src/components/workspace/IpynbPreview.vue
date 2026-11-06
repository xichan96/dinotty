<template>
  <div class="ipynb-preview">
    <div class="ipynb-toolbar">
      <span v-if="editorDirty" class="ipynb-dirty">{{ t('filePreview.modified') }}</span>
      <button
        type="button"
        class="ipynb-tab"
        :class="{ active: activeTab === 'notebook' }"
        data-testid="ipynb-notebook-tab"
        :aria-pressed="activeTab === 'notebook'"
        @click="activeTab = 'notebook'"
      >
        {{ t('ipynb.notebook') }}
      </button>
      <button
        type="button"
        class="ipynb-tab"
        :class="{ active: activeTab === 'source' }"
        data-testid="ipynb-source-tab"
        :aria-pressed="activeTab === 'source'"
        @click="activeTab = 'source'"
      >
        {{ t('ipynb.source') }}
      </button>
      <span class="ipynb-spacer"></span>
      <button
        v-if="showSave"
        type="button"
        class="ipynb-save"
        :disabled="!canSaveEditor"
        @click="emit('saveEditor')"
      >
        {{ t('filePreview.save') }}
      </button>
    </div>

    <div v-if="truncatedBannerVisible" class="ipynb-banner" role="status">
      {{ activeTab === 'notebook' && fullLoading ? t('ipynb.loadingFull') : t('ipynb.truncated') }}
    </div>
    <div v-if="fullError && activeTab === 'notebook'" class="ipynb-banner error" role="alert">
      {{ t('ipynb.fullLoadFailed') }}
    </div>

    <div v-if="activeTab === 'notebook'" ref="notebookEl" class="ipynb-notebook">
      <div v-if="parsed.status === 'unsupported-version'" class="ipynb-placeholder error">
        <div>{{ t('ipynb.unsupportedVersion', { version: parsed.version ?? '' }) }}</div>
        <div class="ipynb-error-detail">{{ parsed.error }}</div>
      </div>
      <div v-else-if="parsed.error" class="ipynb-placeholder error">
        <div>{{ t('ipynb.parseError') }}</div>
        <div class="ipynb-error-detail">{{ parsed.error }}</div>
      </div>
      <div v-else-if="parsed.cells.length === 0" class="ipynb-placeholder">
        {{ t('ipynb.empty') }}
      </div>
      <template v-else>
        <section
          v-for="(cell, cellIndex) in parsed.cells"
          :key="cellIndex"
          class="ipynb-cell"
          :class="`ipynb-cell-${cell.type}`"
          :data-cell-type="cell.type"
        >
          <div
            v-if="cell.type === 'markdown' && cell.source.trim()"
            :ref="(el) => setMarkdownContainer(cellIndex, el)"
            class="ipynb-markdown"
            @click="onPreviewClick"
            v-html="markdownHtml[cellIndex] ?? ''"
          ></div>

          <div v-else-if="cell.type === 'code'" class="ipynb-code">
            <div class="ipynb-code-head">
              <span class="ipynb-lang">{{ codeLabel(cell) }}</span>
              <span
                v-if="cell.executionCount !== null && cell.executionCount !== undefined"
                class="ipynb-exec"
              >
                In [{{ cell.executionCount }}]
              </span>
            </div>
            <pre
              class="ipynb-code-body"
            ><code class="hljs" v-html="codeHtml[cellIndex] ?? escapeHtml(cell.source)"></code></pre>
          </div>

          <pre v-else-if="cell.type === 'raw' && cell.source.trim()" class="ipynb-raw">{{
            cell.source
          }}</pre>

          <div
            v-for="(output, outputIndex) in cell.outputs"
            :key="outputIndex"
            class="ipynb-output"
            :class="{ stderr: output.stream === 'stderr', 'is-error': output.kind === 'error' }"
          >
            <div v-if="isRasterImage(output)" class="ipynb-output-image-wrap">
              <img
                class="ipynb-output-image"
                :src="imageDataUrl(output) ?? ''"
                :alt="t('ipynb.imageOutput')"
                loading="lazy"
              />
            </div>
            <div
              v-else
              class="ipynb-output-body"
              :class="{
                'is-collapsed':
                  !isOutputExpanded(outputKey(cellIndex, outputIndex)) && canExpandOutput(output),
              }"
            >
              <div
                v-if="isHtmlOutput(output) && outputHtml[outputKey(cellIndex, outputIndex)]"
                class="ipynb-output-html"
                v-html="outputHtml[outputKey(cellIndex, outputIndex)]"
              ></div>
              <pre v-else class="ipynb-output-text">{{ outputDisplayText(output) }}</pre>
            </div>
            <button
              v-if="canExpandOutput(output)"
              type="button"
              class="ipynb-output-toggle"
              @click="toggleOutput(outputKey(cellIndex, outputIndex))"
            >
              {{
                isOutputExpanded(outputKey(cellIndex, outputIndex))
                  ? t('ipynb.collapseOutput')
                  : t('ipynb.expandOutput')
              }}
            </button>
          </div>
        </section>
      </template>
    </div>

    <MonacoEditor
      v-else
      :model-value="editorText"
      language="json"
      :readonly="readOnly || truncated"
      :file-path="filePath"
      :pane-id="paneId"
      :leaf-id="leafId"
      @update:model-value="emit('update:editorText', $event)"
      @save="emit('saveEditor')"
      @selection-change="(payload) => emit('selection-change', payload)"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, defineAsyncComponent, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import type { ComponentPublicInstance } from 'vue'
import { useI18n } from '../../composables/useI18n'
import { authFetch } from '../../composables/apiBase'
import { getDOMPurify, getMarked, rewriteImageSrcs } from '../../composables/useFileEditor'
import {
  enhanceMarkdownBlocks,
  handleMarkdownPreviewClick,
  loadHighlight,
} from '../../composables/markdownEnhance'
import { esc } from '../../utils/markdownCode'
import {
  IPYNB_MAX_FULL_BYTES,
  fallbackText,
  imageDataUrl,
  mimeText,
  outputText,
  parseIpynb,
  type IpynbCell,
  type IpynbOutput,
} from '../../utils/ipynb'

const MonacoEditor = defineAsyncComponent(() => import('./MonacoEditor.vue'))

const props = withDefaults(
  defineProps<{
    content: string
    filePath: string
    rawUrl?: string
    truncated?: boolean
    paneId?: string
    leafId?: string
    showSave?: boolean
    editorText?: string
    editorDirty?: boolean
    canSaveEditor?: boolean
    readOnly?: boolean
  }>(),
  {
    rawUrl: '',
    truncated: false,
    paneId: '',
    leafId: undefined,
    showSave: false,
    editorText: '',
    editorDirty: false,
    canSaveEditor: false,
    readOnly: false,
  }
)

const emit = defineEmits<{
  'update:editorText': [value: string]
  saveEditor: []
  'selection-change': [payload: { text: string; rect: DOMRect | null }]
}>()

const { t } = useI18n()

const activeTab = ref<'notebook' | 'source'>('notebook')
const notebookEl = ref<HTMLElement | null>(null)
const fullText = ref<string | null>(null)
const fullLoading = ref(false)
const fullError = ref(false)

const markdownHtml = ref<Record<number, string>>({})
const codeHtml = ref<Record<number, string>>({})
const outputHtml = ref<Record<string, string>>({})
const expandedOutputs = ref<Record<string, boolean>>({})

/** The zone that markdown cells are rendered into, by cell index. */
const markdownContainers = new Map<number, HTMLElement>()

const sourceText = computed(() => props.editorText || props.content)
// The full-file fetch wins once it lands: the metadata preview is cut at
// 512 KB, which is not valid JSON for most real notebooks.
const notebookText = computed(() => fullText.value ?? sourceText.value)
const parsed = computed(() => parseIpynb(notebookText.value))

const truncatedBannerVisible = computed(
  () => props.truncated && (activeTab.value === 'source' || !fullText.value)
)

let fullLoadToken = 0

async function readCapped(response: Response): Promise<string> {
  const rawLength = response.headers?.get?.('content-length')
  const declared = rawLength ? Number(rawLength) : Number.NaN
  if (Number.isFinite(declared) && declared > IPYNB_MAX_FULL_BYTES) {
    throw new Error('notebook exceeds the full-preview size cap')
  }
  if (typeof response.arrayBuffer === 'function') {
    const buffer = await response.arrayBuffer()
    if (buffer.byteLength > IPYNB_MAX_FULL_BYTES) {
      throw new Error('notebook exceeds the full-preview size cap')
    }
    return new TextDecoder('utf-8').decode(buffer)
  }
  const text = await response.text()
  if (new TextEncoder().encode(text).byteLength > IPYNB_MAX_FULL_BYTES) {
    throw new Error('notebook exceeds the full-preview size cap')
  }
  return text
}

/** One attempt per file: truncated metadata content cannot be parsed as JSON. */
async function loadFullNotebook(): Promise<void> {
  if (!props.truncated || !props.rawUrl) return
  const token = ++fullLoadToken
  fullLoading.value = true
  fullError.value = false
  try {
    const response = await authFetch(props.rawUrl)
    if (token !== fullLoadToken) return
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const text = await readCapped(response)
    if (token !== fullLoadToken) return
    fullText.value = text
  } catch {
    if (token === fullLoadToken) fullError.value = true
  } finally {
    if (token === fullLoadToken) fullLoading.value = false
  }
}

watch(
  () => [props.filePath, props.truncated, props.rawUrl] as const,
  () => {
    fullLoadToken += 1
    fullText.value = null
    fullError.value = false
    fullLoading.value = false
    markdownContainers.clear()
    expandedOutputs.value = {}
    void loadFullNotebook()
  },
  { immediate: true }
)

watch(
  () => props.filePath,
  () => {
    activeTab.value = 'notebook'
    notebookEl.value?.scrollTo?.({ top: 0 })
  }
)

const HIGHLIGHT_ALIASES: Record<string, string> = {
  python: 'python',
  python3: 'python',
  py: 'python',
  ipython: 'python',
  ipython3: 'python',
  javascript: 'javascript',
  js: 'javascript',
  node: 'javascript',
  typescript: 'typescript',
  ts: 'typescript',
  r: 'r',
  ir: 'r',
  sql: 'sql',
  bash: 'bash',
  sh: 'bash',
  shell: 'bash',
  zsh: 'bash',
  ruby: 'ruby',
  rb: 'ruby',
  rust: 'rust',
  rs: 'rust',
  go: 'go',
  golang: 'go',
  java: 'java',
  c: 'c',
  'c++': 'cpp',
  cpp: 'cpp',
  'c#': 'csharp',
  csharp: 'csharp',
  php: 'php',
  swift: 'swift',
  kotlin: 'kotlin',
  scala: 'scala',
  julia: 'julia',
  html: 'xml',
  xml: 'xml',
  css: 'css',
  scss: 'scss',
  json: 'json',
  yaml: 'yaml',
  yml: 'yaml',
  markdown: 'markdown',
  md: 'markdown',
  lua: 'lua',
  perl: 'perl',
  powershell: 'powershell',
  matlab: 'matlab',
  latex: 'latex',
  tex: 'latex',
}

function highlightLanguage(language: string | undefined): string {
  const name = (language ?? '').trim().toLowerCase()
  if (!name) return ''
  if (HIGHLIGHT_ALIASES[name]) return HIGHLIGHT_ALIASES[name]
  const base = name.split(/[-\s]/)[0]
  return HIGHLIGHT_ALIASES[base] ?? base
}

function codeLabel(cell: IpynbCell): string {
  return cell.language?.trim() || t('ipynb.codeCell')
}

function escapeHtml(value: string): string {
  return esc(value)
}

function outputKey(cellIndex: number, outputIndex: number): string {
  return `${cellIndex}:${outputIndex}`
}

function isRasterImage(output: IpynbOutput): boolean {
  return output.mime === 'image/png' || output.mime === 'image/jpeg'
}

function isHtmlOutput(output: IpynbOutput): boolean {
  return output.mime === 'text/html' || output.mime === 'image/svg+xml'
}

function outputDisplayText(output: IpynbOutput): string {
  if (!isHtmlOutput(output)) return outputText(output)
  return fallbackText(output)
}

function canExpandOutput(output: IpynbOutput): boolean {
  if (isRasterImage(output) || output.mime === 'image/svg+xml') return false
  const payload = outputDisplayText(output)
  return payload.length > 1200 || payload.split('\n').length > 14
}

function isOutputExpanded(key: string): boolean {
  return expandedOutputs.value[key] === true
}

function toggleOutput(key: string): void {
  expandedOutputs.value = { ...expandedOutputs.value, [key]: !expandedOutputs.value[key] }
}

function setMarkdownContainer(
  index: number,
  element: Element | ComponentPublicInstance | null
): void {
  if (typeof HTMLElement !== 'undefined' && element instanceof HTMLElement) {
    markdownContainers.set(index, element)
  } else {
    markdownContainers.delete(index)
  }
}

function onPreviewClick(event: MouseEvent): void {
  handleMarkdownPreviewClick(event, {
    copyLabel: t('filePreview.copyCode'),
    copiedLabel: t('filePreview.copied'),
  })
}

async function enhanceRenderedMarkdown(): Promise<void> {
  if (activeTab.value !== 'notebook') return
  const containers = Array.from(markdownContainers.values())
  await Promise.all(
    containers.map((container) =>
      enhanceMarkdownBlocks(container, {
        copyLabel: t('filePreview.copyCode'),
        copiedLabel: t('filePreview.copied'),
      })
    )
  )
}

watch(markdownHtml, () => void enhanceRenderedMarkdown(), { flush: 'post' })

let prepareSequence = 0

/**
 * Render markdown and highlight code/output HTML after the notebook changes.
 * Every HTML string assigned with `v-html` has already been through DOMPurify;
 * code goes through highlight.js (which escapes its input) or `esc()`.
 */
async function prepare(): Promise<void> {
  if (activeTab.value !== 'notebook') return
  const sequence = ++prepareSequence
  const result = parsed.value
  const markdownIndexes: number[] = []
  const codeIndexes: number[] = []
  const htmlOutputs: Array<{ key: string; mime: string; payload: string }> = []

  result.cells.forEach((cell, index) => {
    if (cell.type === 'markdown') markdownIndexes.push(index)
    if (cell.type === 'code') codeIndexes.push(index)
    cell.outputs.forEach((output, outputIndex) => {
      if (output.mime !== 'text/html' && output.mime !== 'image/svg+xml') return
      htmlOutputs.push({
        key: outputKey(index, outputIndex),
        mime: output.mime,
        payload: mimeText(output.data),
      })
    })
  })

  markdownHtml.value = {}
  codeHtml.value = {}
  outputHtml.value = {}

  const [purifier, markedModule, highlighter] = await Promise.all([
    markdownIndexes.length > 0 || codeIndexes.length > 0 || htmlOutputs.length > 0
      ? getDOMPurify().catch(() => null)
      : Promise.resolve(null),
    markdownIndexes.length > 0 ? getMarked().catch(() => null) : Promise.resolve(null),
    codeIndexes.length > 0 ? loadHighlight().catch(() => null) : Promise.resolve(null),
  ])
  if (sequence !== prepareSequence) return

  const nextMarkdown: Record<number, string> = {}
  if (purifier) {
    for (const index of markdownIndexes) {
      const source = result.cells[index].source
      let html = ''
      if (markedModule) {
        try {
          html = markedModule.parse(source, { async: false }) as string
        } catch {
          html = ''
        }
      }
      if (!html) html = `<pre>${escapeHtml(source)}</pre>`
      html = rewriteImageSrcs(html, props.filePath, props.paneId)
      nextMarkdown[index] = purifier.default.sanitize(html)
    }
  }

  const nextCode: Record<number, string> = {}
  for (const index of codeIndexes) {
    const cell = result.cells[index]
    const language = highlightLanguage(cell.language)
    let html: string | null = null
    if (highlighter && language && highlighter.getLanguage(language)) {
      try {
        html = highlighter.highlight(cell.source, {
          language,
          ignoreIllegals: true,
        }).value
      } catch {
        html = null
      }
    }
    // highlight.js escapes its input; DOMPurify is still applied so every
    // `v-html` sink goes through the same sanitizer.
    const rendered = html ?? escapeHtml(cell.source)
    nextCode[index] = purifier ? purifier.default.sanitize(rendered) : rendered
  }

  const nextOutputHtml: Record<string, string> = {}
  if (purifier) {
    for (const item of htmlOutputs) {
      // SVG only: notebook SVGs are static figures, so filter primitives are
      // unnecessary attack surface for the sanitizer to permit.
      const config = item.mime === 'image/svg+xml' ? { USE_PROFILES: { svg: true } } : undefined
      nextOutputHtml[item.key] = purifier.default.sanitize(item.payload, config)
    }
  }

  if (sequence !== prepareSequence) return
  markdownHtml.value = nextMarkdown
  codeHtml.value = nextCode
  outputHtml.value = nextOutputHtml
  await nextTick()
  await enhanceRenderedMarkdown()
}

watch(
  // Parse only while the notebook view is visible: the Source tab edits a
  // potentially large JSON buffer, and re-parsing on every keystroke is wasted.
  () => [activeTab.value, activeTab.value === 'notebook' ? parsed.value : null] as const,
  () => void prepare(),
  { immediate: true, flush: 'post' }
)

onBeforeUnmount(() => {
  prepareSequence += 1
  fullLoadToken += 1
  markdownContainers.clear()
})
</script>

<style scoped>
.ipynb-preview {
  --ipynb-code-fs: clamp(10px, 2.35vmin, 18px);
  --ipynb-prose-fs: clamp(12px, 2.55vmin, 17px);
  display: flex;
  flex: 1 1 0;
  min-width: 0;
  min-height: 0;
  flex-direction: column;
  overflow: hidden;
  color: var(--fg);
  background: var(--bg-surface, #141414);
}

.ipynb-toolbar {
  display: flex;
  flex-shrink: 0;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--border);
  background: var(--tab-bg);
}

.ipynb-dirty {
  color: var(--color-orange, #d19a66);
  font-size: 12px;
}

.ipynb-tab {
  border: none;
  border-radius: 3px;
  background: var(--bg, #1a1a1a);
  color: var(--fg-muted, #888);
  cursor: pointer;
  font-size: 12px;
  padding: 3px 8px;
}

.ipynb-tab:hover {
  color: var(--fg);
}

.ipynb-tab.active {
  background: var(--bg-hover, #333);
  color: var(--fg-bright, #eee);
}

.ipynb-spacer {
  flex: 1 1 auto;
}

.ipynb-save {
  border: none;
  border-radius: 3px;
  background: var(--accent, #0e639c);
  color: #fff;
  cursor: pointer;
  font-size: 12px;
  padding: 4px 12px;
}

.ipynb-save:disabled {
  cursor: default;
  opacity: 0.4;
}

.ipynb-banner {
  flex-shrink: 0;
  padding: 5px 10px;
  border-bottom: 1px solid color-mix(in srgb, var(--color-orange, #d19a66) 35%, transparent);
  background: color-mix(in srgb, var(--color-orange, #d19a66) 8%, transparent);
  color: var(--color-orange, #d19a66);
  font-size: 12px;
}

.ipynb-banner.error {
  border-bottom-color: color-mix(in srgb, var(--color-red, #f44747) 35%, transparent);
  background: color-mix(in srgb, var(--color-red, #f44747) 8%, transparent);
  color: var(--color-red, #f44747);
}

.ipynb-notebook {
  flex: 1 1 0;
  min-height: 0;
  overflow: auto;
  padding: clamp(8px, 2vmin, 16px) clamp(10px, 3vmin, 28px) clamp(20px, 5vmin, 48px);
  font-family:
    system-ui,
    -apple-system,
    BlinkMacSystemFont,
    'Segoe UI',
    Roboto,
    sans-serif;
  font-size: var(--ipynb-prose-fs, clamp(13px, 2.8vw, 16px));
  line-height: 1.55;
  overflow-wrap: anywhere;
}

.ipynb-placeholder {
  display: flex;
  min-height: 120px;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 16px;
  color: var(--fg-muted, #888);
  text-align: center;
}

.ipynb-placeholder.error {
  color: var(--color-red, #f44747);
}

.ipynb-error-detail {
  max-width: 100%;
  color: var(--fg-muted, #888);
  font-family: var(--font-mono);
  font-size: 11px;
  overflow-wrap: anywhere;
}

.ipynb-cell + .ipynb-cell {
  margin-top: 12px;
}

/* --- Markdown cells --- */
.ipynb-markdown h1,
.ipynb-markdown h2,
.ipynb-markdown h3,
.ipynb-markdown h4 {
  margin: 1.1em 0 0.45em;
  color: var(--fg-bright, #e8e8e8);
  font-weight: 600;
  line-height: 1.25;
}

.ipynb-markdown h1 {
  border-bottom: 1px solid var(--border);
  font-size: 1.45em;
  padding-bottom: 0.25em;
}

.ipynb-markdown h2 {
  font-size: 1.25em;
}

.ipynb-markdown h3 {
  font-size: 1.08em;
}

.ipynb-markdown p {
  margin: 0.55em 0;
}

.ipynb-markdown a {
  color: var(--accent, #89b4fa);
  text-decoration: none;
}

.ipynb-markdown a:hover {
  text-decoration: underline;
}

.ipynb-markdown ul,
.ipynb-markdown ol {
  margin: 0.5em 0;
  padding-left: 1.5em;
}

.ipynb-markdown li {
  margin: 0.18em 0;
}

.ipynb-markdown blockquote {
  margin: 0.6em 0;
  padding: 0.2em 0 0.2em 0.85em;
  border-left: 3px solid var(--border, #555);
  color: var(--fg-muted, #aaa);
}

.ipynb-markdown hr {
  margin: 1em 0;
  border: none;
  border-top: 1px solid var(--border);
}

.ipynb-markdown table {
  width: 100%;
  margin: 0.75em 0;
  border-collapse: collapse;
  font-size: 0.92em;
}

.ipynb-markdown th,
.ipynb-markdown td {
  padding: 0.35em 0.55em;
  border: 1px solid var(--border, #444);
  text-align: left;
}

.ipynb-markdown th {
  background: var(--tab-bg);
}

.ipynb-markdown img {
  max-width: 100%;
  height: auto;
  vertical-align: middle;
}

.ipynb-markdown code {
  padding: 0.12em 0.38em;
  border-radius: 3px;
  background: var(--tab-bg);
  font-family: var(--font-mono);
  font-size: 0.88em;
}

.ipynb-markdown pre {
  margin: 0.65em 0;
  padding: 10px 12px;
  overflow: auto;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--bg, #1a1a1a);
  font-family: var(--font-mono);
  font-size: var(--ipynb-code-fs);
  line-height: 1.45;
}

.ipynb-markdown pre code {
  padding: 0;
  background: none;
  font-size: inherit;
}

/* Placeholders emitted by `renderMarkdownCode` and completed after sanitizing. */
.ipynb-markdown .md-code-block {
  margin: 0.65em 0;
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--bg, #1a1a1a);
}

.ipynb-markdown .md-code-block pre {
  margin: 0;
  border: 0;
  border-radius: 0;
  background: none;
}

.ipynb-markdown .md-code-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 3px 8px;
  border-bottom: 1px solid var(--border);
  background: var(--tab-bg);
  color: var(--fg-muted);
  font-family: var(--font-mono);
  font-size: 0.78em;
  line-height: 1.6;
}

.ipynb-markdown .md-code-lang {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ipynb-markdown .md-code-copy {
  flex: 0 0 auto;
  padding: 0 6px;
  border: 1px solid transparent;
  border-radius: 3px;
  background: none;
  color: var(--fg-muted);
  font: inherit;
  cursor: pointer;
}

.ipynb-markdown .md-code-copy:hover {
  border-color: var(--border);
  color: var(--fg-bright);
}

.ipynb-markdown .md-math {
  margin: 0.75em 0;
  padding: 8px 12px;
  overflow-x: auto;
  text-align: center;
}

.ipynb-markdown .md-math-src {
  margin: 0;
  border: 1px solid var(--border);
  text-align: left;
}

.ipynb-markdown .md-math[data-md-state='done'] .md-math-src {
  display: none;
}

.ipynb-markdown .katex {
  font-size: 1.05em;
}

.ipynb-markdown .katex-display {
  overflow-x: auto;
  overflow-y: hidden;
  padding: 0.2em 0;
}

/* highlight.js tokens mapped onto the app's theme colours. */
.ipynb-preview :deep(.hljs-comment),
.ipynb-preview :deep(.hljs-quote) {
  color: var(--fg-muted);
  font-style: italic;
}

.ipynb-preview :deep(.hljs-keyword),
.ipynb-preview :deep(.hljs-selector-tag),
.ipynb-preview :deep(.hljs-literal),
.ipynb-preview :deep(.hljs-doctag),
.ipynb-preview :deep(.hljs-name) {
  color: var(--color-magenta);
}

.ipynb-preview :deep(.hljs-string),
.ipynb-preview :deep(.hljs-regexp),
.ipynb-preview :deep(.hljs-addition),
.ipynb-preview :deep(.hljs-attribute) {
  color: var(--color-green);
}

.ipynb-preview :deep(.hljs-number),
.ipynb-preview :deep(.hljs-symbol),
.ipynb-preview :deep(.hljs-bullet),
.ipynb-preview :deep(.hljs-variable),
.ipynb-preview :deep(.hljs-template-variable),
.ipynb-preview :deep(.hljs-link),
.ipynb-preview :deep(.hljs-selector-attr),
.ipynb-preview :deep(.hljs-selector-pseudo) {
  color: var(--color-yellow);
}

.ipynb-preview :deep(.hljs-title),
.ipynb-preview :deep(.hljs-section),
.ipynb-preview :deep(.hljs-selector-id),
.ipynb-preview :deep(.hljs-built_in),
.ipynb-preview :deep(.hljs-type) {
  color: var(--color-blue);
}

.ipynb-preview :deep(.hljs-attr),
.ipynb-preview :deep(.hljs-params),
.ipynb-preview :deep(.hljs-property),
.ipynb-preview :deep(.hljs-tag) {
  color: var(--color-cyan);
}

.ipynb-preview :deep(.hljs-meta),
.ipynb-preview :deep(.hljs-deletion) {
  color: var(--color-red);
}

/* --- Code cells --- */
.ipynb-code {
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--bg, #1a1a1a);
}

.ipynb-code-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 3px 10px;
  border-bottom: 1px solid var(--border);
  background: var(--tab-bg);
  color: var(--fg-muted);
  font-family: var(--font-mono);
  font-size: 0.78em;
  line-height: 1.6;
}

.ipynb-lang {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ipynb-exec {
  color: var(--accent, #89b4fa);
  font-variant-numeric: tabular-nums;
}

.ipynb-code-body {
  margin: 0;
  padding: 10px 12px;
  overflow: auto;
  color: var(--fg, #ddd);
  font-family: var(--font-mono);
  font-size: var(--ipynb-code-fs);
  line-height: 1.45;
  white-space: pre;
}

.ipynb-raw {
  margin: 0;
  padding: 10px 12px;
  overflow: auto;
  border: 1px dashed var(--border);
  border-radius: 4px;
  color: var(--fg-muted);
  font-family: var(--font-mono);
  font-size: var(--ipynb-code-fs);
  white-space: pre-wrap;
}

/* --- Outputs --- */
.ipynb-output {
  position: relative;
  margin-top: 6px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--bg, #1a1a1a);
}

.ipynb-output.stderr,
.ipynb-output.is-error {
  border-color: color-mix(in srgb, var(--color-red, #f44747) 45%, var(--border));
}

.ipynb-output-body {
  overflow: hidden;
}

.ipynb-output-body.is-collapsed {
  max-height: 360px;
}

.ipynb-output-body.is-collapsed::after {
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  height: 40px;
  background: linear-gradient(transparent, var(--bg, #1a1a1a));
  content: '';
  pointer-events: none;
}

.ipynb-output-text {
  margin: 0;
  padding: 8px 10px;
  overflow: auto;
  color: var(--fg, #ddd);
  font-family: var(--font-mono);
  font-size: var(--ipynb-code-fs);
  line-height: 1.45;
  white-space: pre-wrap;
  word-break: break-word;
}

.ipynb-output.stderr .ipynb-output-text,
.ipynb-output.is-error .ipynb-output-text {
  color: var(--color-red, #f44747);
}

.ipynb-output-html {
  padding: 8px 10px;
  overflow: auto;
  font-size: 0.95em;
}

.ipynb-output-html table {
  border-collapse: collapse;
  margin: 0;
}

.ipynb-output-html th,
.ipynb-output-html td {
  padding: 3px 8px;
  border: 1px solid var(--border, #444);
  text-align: left;
}

.ipynb-output-html img,
.ipynb-output-html svg {
  max-width: 100%;
  height: auto;
}

.ipynb-output-image-wrap {
  padding: 8px 10px;
  overflow: auto;
  text-align: center;
}

.ipynb-output-image {
  max-width: 100%;
  height: auto;
  vertical-align: middle;
}

.ipynb-output-toggle {
  display: block;
  width: 100%;
  padding: 3px 8px;
  border: none;
  border-top: 1px solid var(--border);
  background: var(--tab-bg);
  color: var(--fg-muted);
  font-size: 11px;
  cursor: pointer;
}

.ipynb-output-toggle:hover {
  color: var(--fg-bright);
}
</style>
