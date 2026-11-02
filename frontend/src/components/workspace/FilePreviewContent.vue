<template>
  <div ref="rootEl" class="file-workspace-preview">
    <div v-if="previewLoading" class="file-workspace-placeholder">
      {{ t('filePreview.loading') }}
    </div>
    <div v-else-if="previewErr" class="file-workspace-placeholder err">{{ previewErr }}</div>
    <div v-else-if="!selectedRel || selectedIsDir" class="file-workspace-placeholder">
      {{ t('filePreview.pickFile') }}
    </div>
    <template v-else>
      <img v-if="meta?.kind === 'image'" class="file-media" :src="rawUrl" alt="" />
      <video
        v-else-if="meta?.kind === 'video'"
        class="file-media"
        controls
        playsinline
        preload="metadata"
        :src="rawUrl"
      ></video>
      <div v-else-if="meta?.kind === 'audio'" class="file-audio-player">
        <audio
          ref="audioRef"
          class="file-audio-el"
          preload="metadata"
          :src="rawUrl"
          @timeupdate="$emit('audioTimeUpdate', $event)"
          @loadedmetadata="$emit('audioLoadedMetadata', $event)"
          @ended="$emit('audioEnded', $event)"
        />
        <div class="file-audio-head">
          <div class="file-audio-cover">♪</div>
          <div class="file-audio-meta">
            <div class="file-audio-title" :title="audioTitle">{{ audioTitle }}</div>
            <div class="file-audio-sub" :title="audioSub">{{ audioSub }}</div>
          </div>
        </div>
        <div class="file-audio-bar">
          <span class="file-audio-time">{{ audioTimeNow }}</span>
          <input
            class="file-audio-seek"
            type="range"
            min="0"
            max="1000"
            step="1"
            :value="audioSeekValue"
            @input="$emit('audioSeekInput', $event)"
          />
          <span class="file-audio-time">{{ audioTimeTotal }}</span>
        </div>
        <div class="file-audio-controls">
          <button type="button" class="file-audio-btn" @click="$emit('seekAudio', -15)">⟲15</button>
          <button type="button" class="file-audio-btn play" @click="$emit('toggleAudio')">
            {{ audioPlaying ? '❚❚' : '▶' }}
          </button>
          <button type="button" class="file-audio-btn" @click="$emit('seekAudio', 15)">15⟳</button>
          <div class="file-audio-spacer"></div>
          <span class="file-audio-vol-ico">🔊</span>
          <input
            class="file-audio-vol"
            type="range"
            min="0"
            max="100"
            step="1"
            :value="audioVolValue"
            @input="$emit('audioVolumeInput', $event)"
          />
        </div>
      </div>
      <iframe v-else-if="meta?.kind === 'pdf'" class="file-pdf" :src="rawUrl"></iframe>
      <CsvPreview
        v-else-if="
          isCsvFile && csvShowTable && (meta?.kind === 'text' || meta?.kind === 'unsupported')
        "
        :content="meta?.content ?? editorText"
        :file-path="csvFilePath"
        :raw-url="rawUrl"
        :source-available="meta?.kind === 'text'"
        :truncated="!!meta?.truncated"
        @show-source="showCsvSource"
      />
      <template v-else-if="meta?.kind === 'html'">
        <div class="file-editor-root">
          <div class="file-editor-chrome">
            <span v-if="editorDirty" class="file-editor-dirty">{{
              t('filePreview.modified')
            }}</span>
            <button
              type="button"
              class="file-editor-tab"
              @click="$emit('update:htmlShowPreview', false)"
            >
              {{ t('filePreview.source') }}
            </button>
            <button
              type="button"
              class="file-editor-tab"
              @click="$emit('update:htmlShowPreview', true)"
            >
              {{ t('filePreview.preview') }}
            </button>
            <span class="file-editor-spacer"></span>
            <button
              v-if="showSave"
              type="button"
              class="file-editor-save"
              :disabled="!canSaveEditor"
              @click="$emit('saveEditor')"
            >
              {{ t('filePreview.save') }}
            </button>
          </div>
          <iframe
            v-if="htmlShowPreview"
            class="file-pdf"
            :title="t('filePreview.preview')"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
            :srcdoc="htmlPreviewSrcdoc"
          ></iframe>
          <MonacoEditor
            v-else
            :model-value="editorText"
            :language="language"
            :readonly="!!meta?.truncated"
            :file-path="filePath"
            :pane-id="paneId"
            :leaf-id="leafId"
            @update:model-value="$emit('update:editorText', $event)"
            @save="$emit('saveEditor')"
            @selection-change="(p) => $emit('selection-change', p)"
          />
        </div>
      </template>
      <LogPreview
        v-else-if="isLogFile && meta?.kind === 'text'"
        :meta="meta"
        :raw-url="rawUrl"
        :file-path="filePath"
        :pane-id="paneId"
        :leaf-id="leafId"
        :editor-text="editorText"
        :editor-dirty="editorDirty"
        :show-save="showSave"
        :can-save-editor="canSaveEditor"
        @update:editor-text="$emit('update:editorText', $event)"
        @save-editor="$emit('saveEditor')"
        @selection-change="(p) => $emit('selection-change', p)"
      />
      <template v-else-if="meta?.kind === 'text' || meta?.kind === 'markdown'">
        <div class="file-editor-root">
          <div class="file-editor-chrome">
            <span v-if="editorDirty" class="file-editor-dirty">{{
              t('filePreview.modified')
            }}</span>
            <template v-if="isCsvFile">
              <button
                type="button"
                class="file-editor-tab"
                data-testid="csv-table-button"
                @click="showCsvTable"
              >
                {{ t('csvPreview.table') }}
              </button>
              <button type="button" class="file-editor-tab active">
                {{ t('filePreview.source') }}
              </button>
            </template>
            <template v-else-if="meta?.kind === 'markdown'">
              <button
                type="button"
                class="file-editor-tab"
                @click="$emit('update:mdShowPreview', false)"
              >
                {{ t('filePreview.source') }}
              </button>
              <button
                type="button"
                class="file-editor-tab"
                @click="$emit('update:mdShowPreview', true)"
              >
                {{ t('filePreview.preview') }}
              </button>
            </template>
            <span class="file-editor-spacer"></span>
            <button
              v-if="outlineAvailable"
              type="button"
              class="file-editor-outline"
              :class="{ active: outlineOpen }"
              :aria-pressed="outlineOpen ? 'true' : 'false'"
              :aria-controls="outlinePanelId"
              :title="t('outline.toggle')"
              :aria-label="t('outline.toggle')"
              @click="$emit('toggle-outline')"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="1.75"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path d="M8 6h13M8 12h13M8 18h13" />
                <path d="M3 6h.01M3 12h.01M3 18h.01" />
              </svg>
            </button>
            <button
              v-if="showSave"
              type="button"
              class="file-editor-save"
              :disabled="!canSaveEditor"
              @click="$emit('saveEditor')"
            >
              {{ t('filePreview.save') }}
            </button>
          </div>
          <div
            v-if="meta?.kind === 'markdown' && mdShowPreview"
            ref="mdPreviewEl"
            class="file-md file-md-body file-editor-preview"
            @click="onMarkdownPreviewClick"
            v-html="markdownEditorHtml"
          ></div>
          <MonacoEditor
            v-else
            :model-value="editorText"
            :language="language"
            :readonly="!!meta?.truncated"
            :file-path="filePath"
            :pane-id="paneId"
            :leaf-id="leafId"
            @update:model-value="$emit('update:editorText', $event)"
            @save="$emit('saveEditor')"
            @selection-change="(p) => $emit('selection-change', p)"
          />
        </div>
      </template>
      <div v-else-if="meta?.kind === 'office'" class="file-office">
        <div v-if="officeLoading" class="file-workspace-placeholder">
          {{ t('filePreview.loading') }}
        </div>
        <div v-else-if="officeErr" class="file-workspace-placeholder err">{{ officeErr }}</div>
        <div v-else class="file-office-body" v-html="officeHtml"></div>
      </div>
      <div v-else class="file-workspace-placeholder">
        {{ meta?.message || t('filePreview.unsupported') }}
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, defineAsyncComponent, onMounted, watch } from 'vue'
import { useI18n } from '../../composables/useI18n'
import { apiUrl, getAuthToken } from '../../composables/apiBase'
import { isTauri } from '../../composables/useTransport'
import { isCsvPreviewFile } from '../../utils/csvPreview'
import { rewriteHtmlPreview } from '../../utils/htmlPreview'
import { renderMermaidBlocks } from '../../composables/mermaidPreview'
import {
  enhanceMarkdownBlocks,
  handleMarkdownPreviewClick,
} from '../../composables/markdownEnhance'
import CsvPreview from './CsvPreview.vue'
const MonacoEditor = defineAsyncComponent(() => import('./MonacoEditor.vue'))
const LogPreview = defineAsyncComponent(() => import('./LogPreview.vue'))

const { t } = useI18n()

const audioRef = ref<HTMLAudioElement | null>(null)
const rootEl = ref<HTMLElement | null>(null)
const csvShowTable = ref(true)

const props = defineProps<{
  previewLoading: boolean
  previewErr: string | null
  selectedRel: string | null
  selectedIsDir: boolean
  meta: {
    kind: string
    content?: string
    language?: string
    message?: string
    truncated?: boolean
  } | null
  rawUrl: string
  showSave: boolean
  audioTitle: string
  audioSub: string
  audioTimeNow: string
  audioTimeTotal: string
  audioSeekValue: number
  audioVolValue: number
  audioPlaying: boolean
  editorDirty: boolean
  editorText: string
  canSaveEditor: boolean
  mdShowPreview: boolean
  htmlShowPreview: boolean
  markdownEditorHtml: string
  officeLoading: boolean
  officeErr: string | null
  officeHtml: string
  paneId?: string
  filePath?: string
  leafId?: string
  outlineOpen?: boolean
  outlineAvailable?: boolean
  outlinePanelId?: string
}>()

const language = computed(() => props.meta?.language || 'plaintext')
const csvFilePath = computed(function computeCsvFilePath() {
  // 步骤1：优先使用编辑器文件路径，缺失时使用导航器选中路径。
  return props.filePath || props.selectedRel || ''
})
const isCsvFile = computed(function computeIsCsvFile() {
  // 步骤1：按当前文件路径判断是否启用 CSV 预览。
  return isCsvPreviewFile(csvFilePath.value)
})
const isLogFile = computed(function computeIsLogFile() {
  // Only the explicit `.log` extension gets the ANSI log viewer; every other
  // text file keeps the generic editor branch.
  return csvFilePath.value.toLowerCase().endsWith('.log')
})

const htmlPreviewSrcdoc = computed(function buildHtmlPreview() {
  if (props.meta?.kind !== 'html') return ''
  // Relative refs in the document resolve against the Dinotty page, not the
  // HTML file's directory, so point them at the workspace raw endpoint.
  return rewriteHtmlPreview(props.editorText, csvFilePath.value, function toRawUrl(rel) {
    const q = new URLSearchParams({ pane_id: props.paneId ?? '', path: rel })
    if (isTauri()) {
      const token = getAuthToken()
      if (token) q.set('token', token)
    }
    return apiUrl(`/api/workspace/raw?${q}`)
  })
})

watch(csvFilePath, function resetCsvViewForFile() {
  // 步骤1：选择新文件时恢复默认的表格视图。
  csvShowTable.value = true
})

function showCsvSource() {
  // 步骤1：切换到现有的 Monaco 源码视图。
  csvShowTable.value = false
}

function showCsvTable() {
  // 步骤1：切回 CSV 表格视图。
  csvShowTable.value = true
}

// Mermaid/code/math placeholders are inert until the DOM exists, so enhance
// them after v-html has committed (and again whenever the preview toggles on).
const mdPreviewEl = ref<HTMLElement | null>(null)

// The outline overlay lives in EditorPane, outside this scroll container.
defineExpose({ audioRef, scrollEl: rootEl, mdPreviewEl })

function renderPreviewEnhancements() {
  const container = mdPreviewEl.value
  if (!container || props.meta?.kind !== 'markdown' || !props.mdShowPreview) return
  void renderMermaidBlocks(container, { errorLabel: t('filePreview.mermaidError') })
  void enhanceMarkdownBlocks(container, {
    copyLabel: t('filePreview.copyCode'),
    copiedLabel: t('filePreview.copied'),
  })
}

function onMarkdownPreviewClick(event: MouseEvent) {
  handleMarkdownPreviewClick(event, {
    copyLabel: t('filePreview.copyCode'),
    copiedLabel: t('filePreview.copied'),
  })
}

watch(
  () => [props.markdownEditorHtml, props.mdShowPreview, props.meta?.kind] as const,
  renderPreviewEnhancements,
  { flush: 'post' }
)

onMounted(renderPreviewEnhancements)

defineEmits<{
  audioTimeUpdate: [e: Event]
  audioLoadedMetadata: [e: Event]
  audioEnded: [e: Event]
  audioSeekInput: [e: Event]
  seekAudio: [delta: number]
  toggleAudio: []
  audioVolumeInput: [e: Event]
  'update:mdShowPreview': [value: boolean]
  'update:htmlShowPreview': [value: boolean]
  saveEditor: []
  'update:editorText': [value: string]
  'toggle-outline': []
  'selection-change': [payload: { text: string; rect: DOMRect | null }]
}>()
</script>

<style scoped>
.file-workspace-preview {
  --preview-code-fs: clamp(10px, 2.35vmin, 18px);
  --preview-prose-fs: clamp(12px, 2.55vmin, 17px);
  flex: 1 1 0;
  min-width: 0;
  min-height: 0;
  overflow: auto;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  background: var(--bg-surface, #141414);
}

.file-workspace-placeholder {
  flex: 1 1 0;
  min-height: min(120px, 35vh);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--fg-muted, #888);
  font-size: clamp(12px, 2.6vmin, 17px);
  padding: clamp(8px, 2vmin, 16px);
  text-align: center;
}

.file-workspace-placeholder.err {
  color: var(--color-red, #c91b00);
}

.file-media {
  flex: 1 1 0;
  min-height: 0;
  width: 100%;
  height: 100%;
  max-width: 100%;
  max-height: 100%;
  align-self: stretch;
  object-fit: contain;
}

video.file-media {
  background: #000;
}

.file-audio-player {
  flex: 1 1 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 14px;
  padding: clamp(12px, 2.4vmin, 22px);
  box-sizing: border-box;
  color: var(--fg);
}

.file-audio-el {
  display: none;
}

.file-audio-head {
  display: flex;
  gap: 14px;
  align-items: center;
}

.file-audio-cover {
  width: clamp(64px, 9vmin, 92px);
  height: clamp(64px, 9vmin, 92px);
  border-radius: 14px;
  background: var(--bg-hover);
  border: 1px solid var(--border);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: clamp(26px, 4.6vmin, 36px);
  color: var(--fg-bright);
  flex: 0 0 auto;
}

.file-audio-meta {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.file-audio-title {
  font-size: clamp(15px, 3vmin, 20px);
  font-weight: 650;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--fg-bright);
}

.file-audio-sub {
  font-size: clamp(12px, 2.3vmin, 14px);
  color: var(--fg-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.file-audio-bar {
  display: grid;
  grid-template-columns: auto 1fr auto;
  gap: 10px;
  align-items: center;
  width: 100%;
  max-width: 400px;
}

.file-audio-time {
  font-variant-numeric: tabular-nums;
  font-size: 12px;
  color: var(--fg-muted);
}
.file-audio-seek {
  width: 100%;
  accent-color: var(--accent);
}

.file-audio-controls {
  display: flex;
  align-items: center;
  gap: 10px;
}

.file-audio-btn {
  border: 1px solid var(--border);
  background: var(--bg-hover);
  color: var(--fg);
  border-radius: 12px;
  padding: 8px 10px;
  line-height: 1;
  cursor: pointer;
  user-select: none;
}

.file-audio-btn.play {
  padding: 10px 14px;
  font-weight: 650;
}
.file-audio-spacer {
  flex: 1 1 0;
  min-width: 0;
}
.file-audio-vol-ico {
  color: var(--fg-muted);
  font-size: 12px;
}
.file-audio-vol {
  width: 140px;
  max-width: 30vw;
  accent-color: var(--accent);
}

.file-office {
  flex: 1 1 0;
  min-height: 0;
  overflow: auto;
  padding: clamp(10px, 2.2vmin, 18px);
  color: var(--fg);
}

.file-office-body :deep(p) {
  margin: 0.55em 0;
  line-height: 1.55;
}
.file-office-body :deep(h1),
.file-office-body :deep(h2),
.file-office-body :deep(h3),
.file-office-body :deep(h4),
.file-office-body :deep(h5),
.file-office-body :deep(h6) {
  margin: 1.05em 0 0.45em;
  font-weight: 600;
  line-height: 1.25;
  color: var(--fg-bright, #e8e8e8);
}
.file-office-body :deep(table) {
  border-collapse: collapse;
  width: 100%;
  margin: 0.75em 0;
  font-size: 0.92em;
}
.file-office-body :deep(td),
.file-office-body :deep(th) {
  border: 1px solid var(--border, #444);
  padding: 0.35em 0.55em;
  text-align: left;
  vertical-align: top;
}
.file-office-body :deep(th) {
  background: var(--tab-bg);
}

.file-pdf {
  flex: 1 1 0;
  min-height: min(240px, 45vh);
  width: 100%;
  border: none;
  background: #222;
}

.file-editor-root {
  flex: 1 1 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.file-editor-chrome {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--border);
  background: var(--tab-bg);
  flex-shrink: 0;
}

.file-editor-dirty {
  font-size: 12px;
  color: var(--color-orange, #d19a66);
}

.file-editor-tab {
  border: none;
  background: var(--bg, #1a1a1a);
  color: var(--fg-muted, #888);
  font-size: 12px;
  padding: 3px 8px;
  border-radius: 3px;
  cursor: pointer;
}

.file-editor-tab:hover {
  color: var(--fg);
}

.file-editor-tab.active {
  background: var(--bg-hover, #333);
  color: var(--fg-bright, #eee);
}

.file-editor-spacer {
  flex: 1 1 auto;
}

.file-editor-outline {
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  border: none;
  border-radius: 3px;
  background: transparent;
  color: var(--fg-muted, #888);
  cursor: pointer;
  flex: 0 0 auto;
}

.file-editor-outline:hover {
  background: var(--bg-hover, #333);
  color: var(--fg-bright, #eee);
}

.file-editor-outline.active {
  background: var(--bg-hover, #333);
  color: var(--fg-bright, #eee);
}

.file-editor-outline:focus-visible {
  outline: 1px solid var(--border-focus, #8a8a8a);
  outline-offset: -1px;
}

.file-editor-outline svg {
  width: 14px;
  height: 14px;
}

.file-editor-save {
  border: none;
  background: var(--accent, #0e639c);
  color: #fff;
  font-size: 12px;
  padding: 4px 12px;
  border-radius: 3px;
  cursor: pointer;
}

.file-editor-save:disabled {
  opacity: 0.4;
  cursor: default;
}

.file-editor-preview {
  flex: 1 1 0;
  min-height: 0;
  overflow: auto;
}

.file-md {
  flex: 1 1 0;
  min-height: 0;
  overflow: auto;
  margin: 0;
  padding: clamp(8px, 2vmin, 16px);
  font-family: var(--font-mono);
  font-size: var(--preview-code-fs, clamp(11px, 2.5vw, 15px));
  color: var(--fg);
  white-space: pre-wrap;
  word-break: break-word;
}

.file-md-body {
  font-family:
    system-ui,
    -apple-system,
    BlinkMacSystemFont,
    'Segoe UI',
    Roboto,
    sans-serif;
  font-size: var(--preview-prose-fs, clamp(13px, 2.8vw, 16px));
  line-height: 1.55;
  white-space: normal;
  word-break: break-word;
}

.file-md-body :deep(h1),
.file-md-body :deep(h2),
.file-md-body :deep(h3),
.file-md-body :deep(h4) {
  margin: 1.1em 0 0.45em;
  font-weight: 600;
  line-height: 1.25;
  color: var(--fg-bright, #e8e8e8);
}
.file-md-body :deep(h1) {
  font-size: 1.45em;
  border-bottom: 1px solid var(--border);
  padding-bottom: 0.25em;
}
.file-md-body :deep(h2) {
  font-size: 1.25em;
}
.file-md-body :deep(h3) {
  font-size: 1.08em;
}
.file-md-body :deep(p) {
  margin: 0.55em 0;
}
.file-md-body :deep(a) {
  color: var(--accent, #89b4fa);
  text-decoration: none;
}
.file-md-body :deep(a:hover) {
  text-decoration: underline;
}
.file-md-body :deep(ul),
.file-md-body :deep(ol) {
  margin: 0.5em 0;
  padding-left: 1.5em;
}
.file-md-body :deep(li) {
  margin: 0.18em 0;
}
.file-md-body :deep(blockquote) {
  margin: 0.6em 0;
  padding: 0.2em 0 0.2em 0.85em;
  border-left: 3px solid var(--border, #555);
  color: var(--fg-muted, #aaa);
}
.file-md-body :deep(hr) {
  border: none;
  border-top: 1px solid var(--border);
  margin: 1em 0;
}
.file-md-body :deep(table) {
  border-collapse: collapse;
  width: 100%;
  margin: 0.75em 0;
  font-size: 0.92em;
}
.file-md-body :deep(th),
.file-md-body :deep(td) {
  border: 1px solid var(--border, #444);
  padding: 0.35em 0.55em;
  text-align: left;
}
.file-md-body :deep(th) {
  background: var(--tab-bg);
}
.file-md-body :deep(pre) {
  margin: 0.65em 0;
  padding: 10px 12px;
  overflow: auto;
  background: var(--bg, #1a1a1a);
  border: 1px solid var(--border);
  border-radius: 4px;
  font-family: var(--font-mono);
  font-size: var(--preview-code-fs);
  line-height: 1.45;
}
.file-md-body :deep(pre code) {
  font-family: inherit;
  font-size: inherit;
  background: none;
  padding: 0;
}
.file-md-body :deep(code:not(pre code)) {
  font-family: var(--font-mono);
  font-size: 0.88em;
  padding: 0.12em 0.38em;
  background: var(--tab-bg);
  border-radius: 3px;
}
.file-md-body :deep(img) {
  max-width: 100%;
  height: auto;
  vertical-align: middle;
}

/* Mermaid: the source stays visible until the diagram (or its error) is ready. */
.file-md-body :deep(.md-mermaid) {
  margin: 0.75em 0;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--bg-surface, #141414);
  text-align: center;
  overflow-x: auto;
}

.file-md-body :deep(.md-mermaid-src) {
  margin: 0;
  padding: 0;
  border: 0;
  background: none;
  font-family: var(--font-mono);
  font-size: var(--preview-code-fs);
  line-height: 1.45;
  text-align: left;
}

.file-md-body :deep(.md-mermaid[data-mermaid-state='done'] .md-mermaid-src) {
  display: none;
}

/* Must be a block: mermaid emits `width="100%"` SVGs, and a percentage width
   inside a shrink-to-fit inline-block falls back to the 300px replaced-element
   default instead of filling the preview. */
.file-md-body :deep(.md-mermaid-canvas) {
  display: block;
  max-width: 100%;
}

.file-md-body :deep(.md-mermaid-canvas svg) {
  max-width: 100%;
  height: auto;
}

.file-md-body :deep(.md-mermaid-error) {
  margin-bottom: 8px;
  color: var(--color-red, #c91b00);
  font-size: 0.92em;
  text-align: left;
}
/* Code blocks: header with language label + copy button, highlighted body. */
.file-md-body :deep(.md-code-block) {
  margin: 0.65em 0;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--bg, #1a1a1a);
  overflow: hidden;
}

.file-md-body :deep(.md-code-block pre) {
  margin: 0;
  border: 0;
  border-radius: 0;
  background: none;
}

.file-md-body :deep(.md-code-head) {
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

.file-md-body :deep(.md-code-lang) {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.file-md-body :deep(.md-code-copy) {
  flex: 0 0 auto;
  border: 1px solid transparent;
  border-radius: 3px;
  background: none;
  color: var(--fg-muted);
  font: inherit;
  padding: 0 6px;
  cursor: pointer;
}

.file-md-body :deep(.md-code-copy:hover) {
  border-color: var(--border);
  color: var(--fg-bright);
}

/* highlight.js tokens mapped onto the app's theme colours. */
.file-md-body :deep(.hljs-comment),
.file-md-body :deep(.hljs-quote) {
  color: var(--fg-muted);
  font-style: italic;
}

.file-md-body :deep(.hljs-keyword),
.file-md-body :deep(.hljs-selector-tag),
.file-md-body :deep(.hljs-literal),
.file-md-body :deep(.hljs-doctag),
.file-md-body :deep(.hljs-name) {
  color: var(--color-magenta);
}

.file-md-body :deep(.hljs-string),
.file-md-body :deep(.hljs-regexp),
.file-md-body :deep(.hljs-addition),
.file-md-body :deep(.hljs-attribute) {
  color: var(--color-green);
}

.file-md-body :deep(.hljs-number),
.file-md-body :deep(.hljs-symbol),
.file-md-body :deep(.hljs-bullet),
.file-md-body :deep(.hljs-variable),
.file-md-body :deep(.hljs-template-variable),
.file-md-body :deep(.hljs-link),
.file-md-body :deep(.hljs-selector-attr),
.file-md-body :deep(.hljs-selector-pseudo) {
  color: var(--color-yellow);
}

.file-md-body :deep(.hljs-title),
.file-md-body :deep(.hljs-section),
.file-md-body :deep(.hljs-selector-id),
.file-md-body :deep(.hljs-built_in),
.file-md-body :deep(.hljs-type) {
  color: var(--color-blue);
}

.file-md-body :deep(.hljs-attr),
.file-md-body :deep(.hljs-params),
.file-md-body :deep(.hljs-property),
.file-md-body :deep(.hljs-tag) {
  color: var(--color-cyan);
}

.file-md-body :deep(.hljs-meta),
.file-md-body :deep(.hljs-deletion) {
  color: var(--color-red);
}

.file-md-body :deep(.hljs-emphasis) {
  font-style: italic;
}

.file-md-body :deep(.hljs-strong) {
  font-weight: 600;
}

/* ```math fences */
.file-md-body :deep(.md-math) {
  margin: 0.75em 0;
  padding: 8px 12px;
  overflow-x: auto;
  text-align: center;
}

.file-md-body :deep(.md-math-src) {
  margin: 0;
  border: 1px solid var(--border);
  text-align: left;
}

.file-md-body :deep(.md-math[data-md-state='done'] .md-math-src) {
  display: none;
}

.file-md-body :deep(.md-math-canvas .katex-display) {
  margin: 0;
}

/* Inline KaTeX inherits the prose size; display math may overflow horizontally. */
.file-md-body :deep(.katex) {
  font-size: 1.05em;
}

.file-md-body :deep(.katex-display) {
  overflow-x: auto;
  overflow-y: hidden;
  padding: 0.2em 0;
}

.file-md-body :deep(input[type='checkbox']) {
  margin-right: 0.35em;
  vertical-align: middle;
}
</style>
