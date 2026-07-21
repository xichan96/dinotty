<template>
  <div class="file-workspace-preview">
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
          <iframe v-if="htmlShowPreview" class="file-pdf" :srcdoc="editorText"></iframe>
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
            class="file-md file-md-body file-editor-preview"
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
import { ref, computed, defineAsyncComponent, watch } from 'vue'
import { useI18n } from '../../composables/useI18n'
import { isCsvPreviewFile } from '../../utils/csvPreview'
import CsvPreview from './CsvPreview.vue'
const MonacoEditor = defineAsyncComponent(() => import('./MonacoEditor.vue'))

const { t } = useI18n()

const audioRef = ref<HTMLAudioElement | null>(null)
const csvShowTable = ref(true)
defineExpose({ audioRef })

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

.file-editor-save {
  margin-left: auto;
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
.file-md-body :deep(input[type='checkbox']) {
  margin-right: 0.35em;
  vertical-align: middle;
}
</style>
