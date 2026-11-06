<template>
  <div ref="rootRef" class="git-diff-view">
    <div class="git-diff-header">
      <span class="git-diff-status" :class="`status-${props.target.status}`">
        {{ statusLetter(props.target.status) }}
      </span>
      <span class="git-diff-path" :title="props.target.path">{{ props.target.path }}</span>
      <span v-if="props.target.origPath" class="git-diff-orig" :title="props.target.origPath">
        {{ t('workspaceChanges.renamed', { path: props.target.origPath }) }}
      </span>
      <span
        v-else-if="props.target.status === 'added' || props.target.status === 'untracked'"
        class="git-diff-note"
      >
        {{ t('workspaceChanges.added') }}
      </span>
      <span v-else-if="props.target.status === 'deleted'" class="git-diff-note">
        {{ t('workspaceChanges.deleted') }}
      </span>
      <span v-if="hasCounts" class="git-diff-counts">
        <span class="add">+{{ additions }}</span>
        <span class="del">−{{ deletions }}</span>
      </span>
      <span class="git-diff-spacer"></span>
      <span v-if="hunkTotal > 0" class="git-diff-hunk-pos">{{ hunkPosition }}</span>
      <button
        type="button"
        class="git-diff-btn"
        :title="t('workspaceChanges.prevHunk')"
        :aria-label="t('workspaceChanges.prevHunk')"
        :disabled="hunkTotal === 0"
        @click="stepHunk(-1)"
      >
        ↑
      </button>
      <button
        type="button"
        class="git-diff-btn"
        :title="t('workspaceChanges.nextHunk')"
        :aria-label="t('workspaceChanges.nextHunk')"
        :disabled="hunkTotal === 0"
        @click="stepHunk(1)"
      >
        ↓
      </button>
      <button
        v-if="canShowLayoutToggle"
        type="button"
        class="git-diff-btn"
        :title="sideBySide ? t('workspaceChanges.inline') : t('workspaceChanges.sideBySide')"
        :aria-label="sideBySide ? t('workspaceChanges.inline') : t('workspaceChanges.sideBySide')"
        @click="preferSideBySide = !preferSideBySide"
      >
        {{ sideBySide ? '⇄' : '⇅' }}
      </button>
      <button
        type="button"
        class="git-diff-btn"
        :title="t('workspaceChanges.refresh')"
        :aria-label="t('workspaceChanges.refresh')"
        :disabled="loading"
        @click="reload"
      >
        ⟳
      </button>
      <button
        type="button"
        class="git-diff-btn"
        :title="t('workspaceChanges.openInEditor')"
        :aria-label="t('workspaceChanges.openInEditor')"
        @click="openInEditor"
      >
        ↗
      </button>
      <button
        type="button"
        class="git-diff-btn"
        :title="t('workspaceChanges.closeDiff')"
        :aria-label="t('workspaceChanges.closeDiff')"
        @click="close"
      >
        ✕
      </button>
    </div>

    <div v-if="props.editorDirty" class="git-diff-warning">
      {{ t('workspaceChanges.dirtyWarning') }}
    </div>
    <div v-if="error && data" class="git-diff-warning err">
      {{ t('workspaceChanges.diffFailed') }}
    </div>

    <div class="git-diff-body">
      <div v-show="showMonaco" ref="diffContainerRef" class="git-diff-editor"></div>

      <div v-if="stateKind === 'loading'" class="git-diff-state">
        {{ t('filePreview.loading') }}
      </div>
      <div v-else-if="stateKind === 'error'" class="git-diff-state">
        <span class="err">{{ t('workspaceChanges.diffFailed') }}</span>
        <div class="git-diff-state-actions">
          <button type="button" class="git-diff-action" @click="reload">
            {{ t('workspaceChanges.retry') }}
          </button>
          <button type="button" class="git-diff-action" @click="openInEditor">
            {{ t('workspaceChanges.openInEditor') }}
          </button>
        </div>
      </div>
      <div v-else-if="stateKind === 'notRepo'" class="git-diff-state">
        <span>{{ t('workspaceChanges.notRepo') }}</span>
        <button type="button" class="git-diff-action" @click="openInEditor">
          {{ t('workspaceChanges.openInEditor') }}
        </button>
      </div>
      <div v-else-if="stateKind === 'special'" class="git-diff-state">
        <span>{{ t(specialKey) }}</span>
        <button v-if="specialCanOpen" type="button" class="git-diff-action" @click="openInEditor">
          {{ t('workspaceChanges.openInEditor') }}
        </button>
      </div>
      <div v-else-if="stateKind === 'noChanges'" class="git-diff-state">
        <span>{{ t('workspaceChanges.noChangesForFile') }}</span>
        <button type="button" class="git-diff-action" @click="openInEditor">
          {{ t('workspaceChanges.openInEditor') }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import * as monaco from 'monaco-editor'
import { useI18n } from '../../composables/useI18n'
import { onThemeChange } from '../../composables/useSettings'
import { clearDiffTarget, useDiffEpoch } from '../../composables/useDiffView'
import { useGitFileDiff } from '../../composables/useGitFileDiff'
import type { DiffTarget, WorkspaceGitFileDiffResponse } from '../../types/workspaceChanges'
import {
  SIDE_BY_SIDE_MIN_WIDTH,
  clampHunkIndex,
  hunkRevealLine,
  resolveDiffSpecialState,
  sameDiffContent,
  specialStateCanOpenInEditor,
  specialStateMessageKey,
  statusLetter,
  stepHunkIndex,
} from '../../utils/gitDiffHunks'

const props = defineProps<{
  paneId: string
  leafId: string
  target: DiffTarget
  editorDirty: boolean
  active: boolean
}>()

const emit = defineEmits<{
  close: []
  'open-in-editor': []
}>()

const { t } = useI18n()
const epoch = useDiffEpoch()

const { data, loading, error, load, cancel } = useGitFileDiff({
  paneId: () => props.paneId,
  target: () => props.target,
})

const rootRef = ref<HTMLElement | null>(null)
const diffContainerRef = ref<HTMLElement | null>(null)
const containerWidth = ref(0)
const preferSideBySide = ref(true)
const lineChanges = ref<monaco.editor.ILineChange[]>([])
const hunkIndex = ref(-1)

let diffEditor: monaco.editor.IStandaloneDiffEditor | null = null
let originalModel: monaco.editor.ITextModel | null = null
let modifiedModel: monaco.editor.ITextModel | null = null
let modelKey = ''
let diffListener: monaco.IDisposable | null = null
let resizeObserver: ResizeObserver | null = null
let refreshTimer: ReturnType<typeof setTimeout> | null = null
let closed = false

const hasCounts = computed(() => props.target.additions != null || props.target.deletions != null)
const additions = computed(() => props.target.additions ?? 0)
const deletions = computed(() => props.target.deletions ?? 0)

const specialState = computed(() => resolveDiffSpecialState(data.value))
const specialKey = computed(() =>
  specialState.value ? specialStateMessageKey(specialState.value) : ''
)
const specialCanOpen = computed(() =>
  specialState.value ? specialStateCanOpenInEditor(specialState.value) : false
)
const unchanged = computed(
  () => !!data.value && sameDiffContent(data.value.original, data.value.modified)
)

type StateKind = 'loading' | 'error' | 'notRepo' | 'special' | 'noChanges' | null

const stateKind = computed<StateKind>(() => {
  if (!data.value) return error.value ? 'error' : 'loading'
  if (!data.value.is_git_repo) return 'notRepo'
  if (specialState.value) return 'special'
  if (unchanged.value) return 'noChanges'
  return null
})
const showMonaco = computed(() => stateKind.value === null)

const hunkTotal = computed(() => lineChanges.value.length)
const hunkPosition = computed(() => `${Math.max(hunkIndex.value + 1, 0)}/${hunkTotal.value}`)
const sideBySide = computed(
  () => preferSideBySide.value && containerWidth.value >= SIDE_BY_SIDE_MIN_WIDTH
)
const canShowLayoutToggle = computed(() => containerWidth.value >= SIDE_BY_SIDE_MIN_WIDTH)

function currentTheme(): string {
  const root = document.documentElement
  const bg = getComputedStyle(root).getPropertyValue('--bg').trim()
  if (!bg) return 'vs-dark'
  const r = parseInt(bg.slice(1, 3), 16) || 0
  const g = parseInt(bg.slice(3, 5), 16) || 0
  const b = parseInt(bg.slice(5, 7), 16) || 0
  return (r + g + b) / 3 < 128 ? 'vs-dark' : 'vs'
}

const languageByExtension = new Map<string, string>()

/** Monaco knows its own extension table, so reuse it instead of a second map. */
function languageForPath(path: string): string {
  const dot = path.lastIndexOf('.')
  if (dot < 0) return 'plaintext'
  const extension = path.slice(dot).toLowerCase()
  const cached = languageByExtension.get(extension)
  if (cached) return cached
  const match = monaco.languages
    .getLanguages()
    .find((language) => language.extensions?.some((ext) => ext.toLowerCase() === extension))
  const id = match?.id ?? 'plaintext'
  languageByExtension.set(extension, id)
  return id
}

function createEditor(): void {
  const container = diffContainerRef.value
  if (!container || diffEditor) return
  diffEditor = monaco.editor.createDiffEditor(container, {
    theme: currentTheme(),
    readOnly: true,
    originalEditable: false,
    automaticLayout: true,
    minimap: { enabled: false },
    scrollBeyondLastLine: false,
    renderSideBySide: sideBySide.value,
    useInlineViewWhenSpaceIsLimited: false,
    glyphMargin: false,
    folding: false,
    renderOverviewRuler: false,
    overviewRulerLanes: 0,
    scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10 },
    fontSize: 13,
    lineNumbers: 'on',
    wordWrap: 'on',
  })
  diffListener = diffEditor.onDidUpdateDiff(onDiffUpdated)
  diffEditor.getModifiedEditor().addCommand(monaco.KeyCode.Escape, onEscape)
  diffEditor.getOriginalEditor().addCommand(monaco.KeyCode.Escape, onEscape)
}

function onDiffUpdated(): void {
  if (!diffEditor) return
  const next = diffEditor.getLineChanges() ?? []
  lineChanges.value = next
  if (next.length === 0) {
    hunkIndex.value = -1
    return
  }
  if (hunkIndex.value < 0) return
  const clamped = clampHunkIndex(hunkIndex.value, next.length)
  hunkIndex.value = clamped
  revealHunk(clamped)
}

function revealHunk(index: number): void {
  const change = lineChanges.value[index]
  if (!change || !diffEditor) return
  const modified = diffEditor.getModifiedEditor()
  const maxLine = Math.max(1, modified.getModel()?.getLineCount() ?? 1)
  const line = Math.min(hunkRevealLine(change), maxLine)
  modified.revealLineInCenter(line)
  modified.setPosition({ lineNumber: line, column: 1 })
}

function stepHunk(direction: 1 | -1): void {
  const total = lineChanges.value.length
  if (!total) return
  const next = stepHunkIndex(hunkIndex.value, total, direction)
  hunkIndex.value = next
  revealHunk(next)
}

function disposeModels(): void {
  diffEditor?.setModel(null)
  originalModel?.dispose()
  modifiedModel?.dispose()
  originalModel = null
  modifiedModel = null
  modelKey = ''
  lineChanges.value = []
  hunkIndex.value = -1
}

function applyData(next: WorkspaceGitFileDiffResponse | null): void {
  if (!diffEditor) return
  const special = resolveDiffSpecialState(next)
  if (!next || !next.is_git_repo || special) {
    if (modelKey !== '') disposeModels()
    return
  }

  const original = next.original ?? ''
  const modified = next.modified ?? ''
  const language = languageForPath(next.path || props.target.path)
  const key = `${next.path}|${next.orig_path ?? ''}|${language}`

  if (key !== modelKey) {
    disposeModels()
    originalModel = monaco.editor.createModel(original, language)
    modifiedModel = monaco.editor.createModel(modified, language)
    diffEditor.setModel({ original: originalModel, modified: modifiedModel })
    modelKey = key
    return
  }

  if (originalModel?.getValue() === original && modifiedModel?.getValue() === modified) return

  const modifiedEditor = diffEditor.getModifiedEditor()
  const viewState = modifiedEditor.saveViewState()
  originalModel?.setValue(original)
  modifiedModel?.setValue(modified)
  if (viewState) modifiedEditor.restoreViewState(viewState)
}

function scheduleRefresh(): void {
  if (refreshTimer) clearTimeout(refreshTimer)
  refreshTimer = setTimeout(() => {
    refreshTimer = null
    void load()
  }, 500)
}

function reload(): void {
  if (refreshTimer) {
    clearTimeout(refreshTimer)
    refreshTimer = null
  }
  void load()
}

function close(): void {
  if (closed) return
  closed = true
  clearDiffTarget(props.leafId)
  emit('close')
}

function openInEditor(): void {
  if (closed) return
  closed = true
  clearDiffTarget(props.leafId)
  emit('open-in-editor')
}

function onEscape(): void {
  if (!props.active) return
  close()
}

function onWindowKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Escape') return
  onEscape()
}

function observeWidth(element: HTMLElement): void {
  containerWidth.value = element.clientWidth
  if (typeof ResizeObserver === 'undefined') return
  resizeObserver = new ResizeObserver(() => {
    containerWidth.value = element.clientWidth
  })
  resizeObserver.observe(element)
}

const unsubscribeTheme = onThemeChange(() => {
  if (diffEditor) monaco.editor.setTheme(currentTheme())
})

watch([data, () => props.target.path, () => props.target.origPath], () => applyData(data.value), {
  flush: 'post',
})

watch([() => props.target.path, () => props.target.origPath], () => {
  hunkIndex.value = -1
  reload()
})

watch(showMonaco, (shown) => {
  if (shown) void nextTick(() => diffEditor?.layout())
})

watch(sideBySide, (value) => {
  diffEditor?.updateOptions({ renderSideBySide: value })
})

watch(epoch, scheduleRefresh)

onMounted(() => {
  if (rootRef.value) observeWidth(rootRef.value)
  createEditor()
  window.addEventListener('keydown', onWindowKeydown)
  void load()
})

onBeforeUnmount(() => {
  if (refreshTimer) clearTimeout(refreshTimer)
  refreshTimer = null
  window.removeEventListener('keydown', onWindowKeydown)
  resizeObserver?.disconnect()
  resizeObserver = null
  unsubscribeTheme()
  cancel()
  diffListener?.dispose()
  diffListener = null
  diffEditor?.dispose()
  diffEditor = null
  originalModel?.dispose()
  modifiedModel?.dispose()
  originalModel = null
  modifiedModel = null
})
</script>

<style scoped>
.git-diff-view {
  flex: 1 1 0;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: var(--bg-surface, #141414);
}

.git-diff-header {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
  height: 30px;
  padding: 0 8px 0 10px;
  box-sizing: border-box;
  border-bottom: 1px solid var(--border, #333);
  background: var(--tab-bg, var(--bg, #1e1e1e));
  font-size: 12px;
  overflow: hidden;
}

.git-diff-status {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  flex: 0 0 auto;
  border-radius: 3px;
  font-size: 11px;
  font-weight: 700;
  line-height: 1;
  color: var(--bg, #1e1e1e);
  background: var(--fg-muted, #888);
}

.git-diff-status.status-added,
.git-diff-status.status-untracked {
  background: var(--color-green, #2ea043);
}

.git-diff-status.status-deleted,
.git-diff-status.status-conflicted {
  background: var(--color-red, #c91b00);
  color: #fff;
}

.git-diff-status.status-renamed {
  background: var(--color-blue, #1976d2);
  color: #fff;
}

.git-diff-status.status-modified,
.git-diff-status.status-typechange {
  background: var(--color-yellow, #d19a66);
  color: var(--bg, #1e1e1e);
}

.git-diff-path {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--fg, #c7c7c7);
}

.git-diff-orig,
.git-diff-note {
  flex: 0 0 auto;
  max-width: 40%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--fg-muted, #888);
}

.git-diff-counts {
  display: inline-flex;
  gap: 6px;
  flex: 0 0 auto;
  font-variant-numeric: tabular-nums;
  font-size: 11.5px;
}

.git-diff-counts .add {
  color: var(--color-green, #2ea043);
}

.git-diff-counts .del {
  color: var(--color-red, #c91b00);
}

.git-diff-spacer {
  flex: 1 1 auto;
  min-width: 4px;
}

.git-diff-hunk-pos {
  flex: 0 0 auto;
  font-variant-numeric: tabular-nums;
  font-size: 11px;
  color: var(--fg-muted, #888);
}

.git-diff-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  flex: 0 0 auto;
  padding: 0;
  border: none;
  border-radius: 3px;
  background: transparent;
  color: var(--fg-muted, #888);
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
}

.git-diff-btn:hover:not(:disabled) {
  background: var(--bg-hover, #333);
  color: var(--fg-bright, #eee);
}

.git-diff-btn:disabled {
  opacity: 0.4;
  cursor: default;
}

.git-diff-btn:focus-visible,
.git-diff-action:focus-visible {
  outline: 1px solid var(--border-focus, #8a8a8a);
  outline-offset: -1px;
}

.git-diff-warning {
  flex-shrink: 0;
  padding: 4px 10px;
  border-bottom: 1px solid var(--border, #333);
  background: var(--tab-bg, var(--bg, #1e1e1e));
  color: var(--color-orange, #d19a66);
  font-size: 11.5px;
}

.git-diff-warning.err {
  color: var(--color-red, #c91b00);
}

.git-diff-body {
  position: relative;
  flex: 1 1 0;
  min-width: 0;
  min-height: 0;
  display: flex;
}

.git-diff-editor {
  flex: 1 1 0;
  min-width: 0;
  min-height: 0;
}

.git-diff-state {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 16px;
  box-sizing: border-box;
  text-align: center;
  color: var(--fg-muted, #888);
  font-size: 13px;
}

.git-diff-state .err {
  color: var(--color-red, #c91b00);
}

.git-diff-state-actions {
  display: flex;
  gap: 8px;
}

.git-diff-action {
  border: 1px solid var(--border, #444);
  border-radius: 3px;
  background: var(--bg-hover, #333);
  color: var(--fg, #c7c7c7);
  font-size: 12px;
  padding: 4px 10px;
  cursor: pointer;
}

.git-diff-action:hover {
  background: var(--bg-surface, #141414);
  color: var(--fg-bright, #eee);
}
</style>
