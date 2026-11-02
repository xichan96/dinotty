<template>
  <div
    ref="paneEl"
    class="editor-pane"
    :class="{ active: isActive, 'drag-over': !!dropZone }"
    :data-leaf-id="leaf.id"
    @mousedown="$emit('focus', leaf.id)"
    @dragover.prevent="onPaneDragOver"
    @dragleave="onPaneDragLeave"
    @drop.prevent="onPaneDrop"
  >
    <div v-if="dropZone" class="editor-pane-drop-zone" :class="`zone-${dropZone}`">
      {{ dropHint }}
    </div>

    <EditorTabBar
      :leaf-id="leaf.id"
      :tabs="leaf.tabs"
      :active-tab-id="leaf.activeTabId"
      :can-close-group="showHeader"
      @activate="(tabId: string) => $emit('activate-tab', leaf.id, tabId)"
      @request-close="requestCloseTab"
      @pin="(tabId: string) => $emit('set-tab-preview', leaf.id, tabId, false)"
      @split="() => $emit('split', leaf.id)"
      @close-group="() => $emit('close-group', leaf.id)"
      @reorder="
        (tabId: string, targetId: string, after: boolean) =>
          $emit('reorder-tab', leaf.id, tabId, targetId, after)
      "
      @drop-on-strip="
        (sourceLeafId: string, tabId: string) => $emit('move-tab', sourceLeafId, tabId, leaf.id)
      "
      @command="onTabCommand"
    />

    <EditorBreadcrumbs
      :file-path="activeFilePath"
      :disk-changed="diskChanged"
      @reload-disk="onDiskChangedClick"
    />

    <div class="preview-wrap">
      <FilePreviewContent
        ref="previewContentRef"
        :pane-id="paneId"
        :file-path="activeFilePath ?? undefined"
        :leaf-id="leaf.id"
        :preview-loading="previewLoading"
        :preview-err="previewErr"
        :selected-rel="activeFilePath"
        :selected-is-dir="activeIsDir"
        :meta="meta"
        :raw-url="rawUrl"
        :show-save="true"
        :audio-title="audioTitle"
        :audio-sub="audioSub"
        :audio-time-now="audio.audioTimeNow.value"
        :audio-time-total="audio.audioTimeTotal.value"
        :audio-seek-value="audio.audioSeekValue.value"
        :audio-vol-value="audio.audioVolValue.value"
        :audio-playing="audio.audioPlaying.value"
        :editor-dirty="editor.editorDirty.value"
        :editor-text="editor.editorText.value"
        :can-save-editor="editor.canSaveEditor.value"
        :md-show-preview="editor.mdShowPreview.value"
        :html-show-preview="editor.htmlShowPreview.value"
        :markdown-editor-html="editor.markdownEditorHtml.value"
        :office-loading="office.officeLoading.value"
        :office-err="office.officeErr.value"
        :office-html="office.officeHtml.value"
        :outline-open="outlineOpen"
        :outline-available="outlineAvailable"
        :outline-panel-id="outlinePanelId"
        @audio-time-update="audio.onAudioTimeUpdate(audioRef)"
        @audio-loaded-metadata="audio.onAudioLoadedMetadata(audioRef)"
        @audio-ended="audio.onAudioEnded()"
        @audio-seek-input="(ev: Event) => audio.onAudioSeekInput(audioRef, ev)"
        @seek-audio="(d: number) => audio.seekAudio(audioRef, d)"
        @toggle-audio="audio.toggleAudio(audioRef)"
        @audio-volume-input="(ev: Event) => audio.onAudioVolumeInput(audioRef, ev)"
        @update:md-show-preview="editor.mdShowPreview.value = $event"
        @update:html-show-preview="editor.htmlShowPreview.value = $event"
        @update:editor-text="editor.editorText.value = $event"
        @save-editor="onSaveEditor"
        @toggle-outline="toggleOutline"
        @selection-change="editor.onEditorSelectionChange"
      />
      <OutlinePanel
        v-if="outlineAvailable"
        :open="outlineOpen"
        :mobile="outlineMobile"
        :source="outlineSource"
        :mode="outlinePanelMode"
        :active-id="outlineActiveId"
        :file-path="activeFilePath ?? ''"
        :language-label="outlineLanguageLabel"
        :panel-id="outlinePanelId"
        @open="outlineOpen = true"
        @close="outlineOpen = false"
        @reveal="onOutlineReveal"
        @retry="rescanOutline"
        @update:active-id="outlineActiveId = $event"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from '../../composables/useI18n'
import { getApiBase, apiUrl, authFetch, getAuthToken } from '../../composables/apiBase'
import type { DropPosition } from '../../types/pane'
import { isTauri } from '../../composables/useTransport'
import { uiConfirm } from '../../composables/useConfirm'
import { createFileEditor, isEditableTextKind } from '../../composables/useFileEditor'
import { useOfficePreview } from '../../composables/useOfficePreview'
import { useAudioPlayer } from '../../composables/useAudioPlayer'
import {
  whenEditorReady,
  registerEditorPaneState,
  unregisterEditorPaneState,
} from '../../composables/useEditorRegistry'
import { useCursorGroup, isCursorBroadcasting } from '../../composables/useCursorGroup'
import { useTabBufferStore, type TabBuffer } from '../../composables/useTabBufferStore'
import {
  endTabDrag,
  getTabDrag,
  isTabDragEvent,
  tabDropPosition,
} from '../../composables/useEditorTabDrag'
import type { EditorLeafPane } from '../../types/editorPane'
import {
  getActiveTab,
  savedTabs,
  tabsExcept,
  tabsRightOf,
  type EditorTab,
} from '../../types/editorTabs'
import type { EditorDropPosition } from '../../composables/useEditorSplit'
import type { TabMenuCommand } from './EditorTabContextMenu.vue'
import FilePreviewContent from './FilePreviewContent.vue'
import OutlinePanel from './OutlinePanel.vue'
import EditorTabBar from './EditorTabBar.vue'
import EditorBreadcrumbs from './EditorBreadcrumbs.vue'
import { useFileOutline } from '../../composables/useFileOutline'
import { useMonacoOutlineSymbols } from '../../composables/useMonacoOutlineSymbols'
import { normalizeCodeLanguage } from '../../utils/codeSymbols'
import { flattenOutline, outlineAtLine } from '../../utils/outlineTree'
import type { OutlineItem, OutlineMode } from '../../types/outline'
import type * as monaco from 'monaco-editor'

export interface EditorRevealTarget {
  path: string
  line: number
  column?: number
  seq: number
}

const props = defineProps<{
  leaf: EditorLeafPane
  paneId: string
  isActive: boolean
  showHeader: boolean
  reveal?: EditorRevealTarget | null
}>()

const emit = defineEmits<{
  focus: [leafId: string]
  'activate-tab': [leafId: string, tabId: string]
  'close-tab': [leafId: string, tabId: string]
  'close-tabs': [leafId: string, tabIds: string[]]
  'set-tab-preview': [leafId: string, tabId: string, preview: boolean]
  split: [leafId: string]
  'close-group': [leafId: string]
  'copy-tab-path': [leafId: string, tabId: string]
  'reorder-tab': [leafId: string, tabId: string, targetTabId: string, after: boolean]
  'move-tab': [sourceLeafId: string, tabId: string, targetLeafId: string]
  'split-tab': [
    sourceLeafId: string,
    tabId: string,
    targetLeafId: string,
    position: Exclude<EditorDropPosition, 'center'>,
  ]
  'file-drop': [leafId: string, rel: string, position: DropPosition]
}>()

const { t } = useI18n()
const buffers = useTabBufferStore()

const dropZone = ref<DropPosition | null>(null)
const draggingTab = ref(false)

const activeTab = computed(() => getActiveTab(props.leaf))
const activeFilePath = computed(() => activeTab.value?.filePath ?? null)
const activeIsDir = computed(() => activeTab.value?.isDir ?? false)

const dropHint = computed(() => {
  if (draggingTab.value) {
    return dropZone.value === 'center' ? t('editorTabs.dropMoveHere') : t('editorTabs.dropSplit')
  }
  return dropZone.value === 'center' ? t('filePreview.dropReplace') : t('filePreview.dropSplit')
})

// --- Per-pane file state (the active tab's live buffer) ---
const meta = ref<any | null>(null)
const previewLoading = ref(false)
const previewErr = ref('')
const diskChanged = ref(false)
const rawBust = ref(0)

const selectedRel = computed(() => activeFilePath.value)
const selectedIsDir = computed(() => activeIsDir.value)

const cursorGroup = useCursorGroup()
const isInActiveGroup = computed(() => {
  const id = cursorGroup.activeGroupId.value
  if (!id) return false
  const g = cursorGroup.groups.value.find((x) => x.id === id)
  return !!g?.entries.some((e) => e.leafId === props.leaf.id)
})

const editor = createFileEditor({
  paneId: () => props.paneId,
  selectedRel,
  selectedIsDir,
  meta,
})

const office = useOfficePreview({ paneId: () => props.paneId })
const audio = useAudioPlayer()

const previewContentRef = ref<InstanceType<typeof FilePreviewContent> | null>(null)
const audioRef = computed(() => previewContentRef.value?.audioRef ?? null)

const audioTitle = computed(() => activeFilePath.value?.split('/').pop() || '')
const audioSub = computed(() => '')

const rawUrl = computed(() => {
  if (!activeFilePath.value) return ''
  const q = new URLSearchParams({ pane_id: props.paneId, path: activeFilePath.value })
  if (isTauri()) {
    const token = getAuthToken()
    if (token) q.set('token', token)
  }
  if (rawBust.value) q.set('_t', String(rawBust.value))
  return apiUrl(`/api/workspace/raw?${q}`)
})

// --- Outline panel ---
// The toggle and active row are per pane; the width is global and owned by
// OutlinePanel (localStorage). Scroll-spy drives `outlineActiveId` from the
// rendered Markdown preview or from Monaco's visible range.
const OUTLINE_READING_OFFSET = 88
const OUTLINE_SUPPRESS_MS = 1200
const OUTLINE_MOBILE_QUERY = '(max-width: 720px)'

const outlineOpen = ref(false)
const outlineActiveId = ref('')
const outlineMobile = ref(false)
const outlinePanelId = computed(() => `outline-panel-${props.leaf.id}`)

const outlineLanguage = computed(() => meta.value?.language ?? '')

// Only TS/JS get Monaco's navigation tree; Rust/Python/Go and non-code files
// keep the regex extractor. The composable handles debounce, worker timeouts
// and discarding results whose model version or file changed mid-flight.
const monacoSymbolLanguage = computed<'typescript' | 'javascript' | null>(() => {
  if (!isEditableTextKind(meta.value?.kind)) return null
  const language = normalizeCodeLanguage(meta.value?.language)
  return language === 'typescript' || language === 'javascript' ? language : null
})
const { symbols: monacoSymbols, refresh: refreshMonacoSymbols } = useMonacoOutlineSymbols({
  leafId: props.leaf.id,
  enabled: outlineOpen,
  language: monacoSymbolLanguage,
  filePath: activeFilePath,
  revision: editor.editorText,
})

const { source: outlineSource, rescan: rescanFileOutline } = useFileOutline({
  kind: computed(() => meta.value?.kind ?? null),
  language: outlineLanguage,
  text: editor.editorText,
  markdownTokens: editor.markdownOutline,
  markdownTokensSource: editor.markdownOutlineSource,
  codeSymbols: monacoSymbols,
})

/** Retry from the panel: re-scan the regex source and refetch Monaco symbols. */
function rescanOutline(): void {
  rescanFileOutline()
  refreshMonacoSymbols()
}

const outlineAvailable = computed(
  () => isEditableTextKind(meta.value?.kind) && outlineSource.value.mode !== 'none'
)
const outlinePanelMode = computed<Exclude<OutlineMode, 'none'>>(() =>
  outlineSource.value.mode === 'none' ? 'code' : outlineSource.value.mode
)

const outlineLanguageLabel = computed(() => {
  if (outlineSource.value.mode === 'markdown') return t('outline.typeMarkdown')
  if (outlineSource.value.mode === 'json') return t('outline.typeJson')
  if (outlineSource.value.mode === 'yaml') return t('outline.typeYaml')
  if (outlineSource.value.mode === 'toml') return t('outline.typeToml')
  const labels: Record<string, string> = {
    typescript: 'TypeScript',
    javascript: 'JavaScript',
    rust: 'Rust',
    python: 'Python',
    go: 'Go',
  }
  const language = outlineSource.value.language
  return language ? (labels[language] ?? language) : t('outline.typeCode')
})

const outlineFlat = computed(() => flattenOutline(outlineSource.value.items))
const outlineAnchorIds = computed(() => {
  const ids = new Map<string, string>()
  for (const entry of outlineFlat.value) {
    if (entry.item.anchor) ids.set(entry.item.anchor, entry.item.id)
  }
  return ids
})

let outlineMediaQuery: MediaQueryList | null = null
let outlineSpyToken = 0
let outlineSpyRaf = 0
let disposeOutlineSpy: (() => void) | null = null
let outlineSpySuppressedUntil = 0
let outlineFlashTimer: ReturnType<typeof setTimeout> | null = null
let outlineFlashEl: HTMLElement | null = null

function syncOutlineMobile(): void {
  outlineMobile.value = outlineMediaQuery?.matches ?? false
}

function toggleOutline(): void {
  outlineOpen.value = !outlineOpen.value
}

function stopOutlineSpy(): void {
  outlineSpyToken++
  if (outlineSpyRaf) {
    cancelAnimationFrame(outlineSpyRaf)
    outlineSpyRaf = 0
  }
  if (disposeOutlineSpy) {
    disposeOutlineSpy()
    disposeOutlineSpy = null
  }
}

function setOutlineActive(id: string): void {
  if (id && outlineActiveId.value !== id) outlineActiveId.value = id
}

function computePreviewSpy(scroller: HTMLElement): void {
  if (!outlineOpen.value || performance.now() < outlineSpySuppressedUntil) return
  const threshold = scroller.getBoundingClientRect().top + OUTLINE_READING_OFFSET
  const headings = scroller.querySelectorAll<HTMLElement>('h1,h2,h3,h4,h5,h6')
  let active = ''
  for (let i = 0; i < headings.length; i++) {
    if (headings[i].getBoundingClientRect().top > threshold) break
    const mapped = outlineAnchorIds.value.get(headings[i].id)
    if (mapped) active = mapped
  }
  if (!active) {
    for (let i = 0; i < headings.length; i++) {
      const mapped = outlineAnchorIds.value.get(headings[i].id)
      if (mapped) {
        active = mapped
        break
      }
    }
  }
  setOutlineActive(active)
}

function computeSourceSpy(monacoEditor: monaco.editor.IStandaloneCodeEditor): void {
  if (!outlineOpen.value || performance.now() < outlineSpySuppressedUntil) return
  const topLine = monacoEditor.getVisibleRanges()[0]?.startLineNumber ?? 1
  const item = outlineAtLine(outlineFlat.value, topLine) ?? outlineFlat.value[0]?.item
  if (item) setOutlineActive(item.id)
}

function schedulePreviewSpy(scroller: HTMLElement): void {
  if (outlineSpyRaf) return
  outlineSpyRaf = requestAnimationFrame(() => {
    outlineSpyRaf = 0
    computePreviewSpy(scroller)
  })
}

function scheduleSourceSpy(monacoEditor: monaco.editor.IStandaloneCodeEditor): void {
  if (outlineSpyRaf) return
  outlineSpyRaf = requestAnimationFrame(() => {
    outlineSpyRaf = 0
    computeSourceSpy(monacoEditor)
  })
}

function setupOutlineSpy(): void {
  stopOutlineSpy()
  if (!outlineOpen.value || !outlineAvailable.value) return

  if (editor.mdShowPreview.value && meta.value?.kind === 'markdown') {
    const scroller = previewContentRef.value?.mdPreviewEl ?? null
    if (!scroller) return
    const onScroll = () => schedulePreviewSpy(scroller)
    scroller.addEventListener('scroll', onScroll, { passive: true })
    disposeOutlineSpy = () => scroller.removeEventListener('scroll', onScroll)
    computePreviewSpy(scroller)
    return
  }

  const token = outlineSpyToken
  void whenEditorReady(props.leaf.id).then((monacoEditor) => {
    if (token !== outlineSpyToken || !outlineOpen.value) return
    const onScroll = () => scheduleSourceSpy(monacoEditor)
    const disposable = monacoEditor.onDidScrollChange(onScroll)
    disposeOutlineSpy = () => disposable.dispose()
    computeSourceSpy(monacoEditor)
  })
}

function prefersReducedMotion(): boolean {
  return (
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

function flashOutlineTarget(element: HTMLElement): void {
  if (outlineFlashEl) outlineFlashEl.classList.remove('outline-target-flash')
  if (outlineFlashTimer) clearTimeout(outlineFlashTimer)
  void element.offsetWidth
  element.classList.add('outline-target-flash')
  outlineFlashEl = element
  outlineFlashTimer = setTimeout(() => {
    element.classList.remove('outline-target-flash')
    if (outlineFlashEl === element) outlineFlashEl = null
    outlineFlashTimer = null
  }, 1300)
}

function onOutlineReveal(item: OutlineItem): void {
  outlineActiveId.value = item.id
  outlineSpySuppressedUntil = performance.now() + OUTLINE_SUPPRESS_MS

  if (meta.value?.kind === 'markdown' && editor.mdShowPreview.value) {
    const scroller = previewContentRef.value?.mdPreviewEl ?? null
    if (!scroller || !item.anchor) return
    const target = Array.from(scroller.querySelectorAll<HTMLElement>('h1,h2,h3,h4,h5,h6')).find(
      (heading) => heading.id === item.anchor
    )
    if (!target) return
    const top =
      scroller.scrollTop +
      target.getBoundingClientRect().top -
      scroller.getBoundingClientRect().top -
      26
    scroller.scrollTo({
      top: Math.max(0, top),
      behavior: prefersReducedMotion() ? 'auto' : 'smooth',
    })
    flashOutlineTarget(target)
    return
  }

  const path = activeFilePath.value
  void whenEditorReady(props.leaf.id).then((monacoEditor) => {
    if (activeFilePath.value !== path) return
    const model = monacoEditor.getModel()
    const line = Math.max(1, Math.min(item.line, model?.getLineCount() ?? item.line))
    monacoEditor.revealLineInCenter(line)
    monacoEditor.setPosition({ lineNumber: line, column: 1 })
    monacoEditor.focus()
  })
}

watch(
  [
    outlineOpen,
    outlineAvailable,
    () => editor.mdShowPreview.value,
    () => meta.value?.kind,
    () => activeFilePath.value,
    () => outlineSource.value.items,
  ],
  () => void nextTick(setupOutlineSpy),
  { flush: 'post' }
)

// --- Active tab buffer swap ---
const currentTab = ref<{ id: string; path: string } | null>(null)

function liveBuffer(): TabBuffer | null {
  const current = currentTab.value
  return current ? (buffers.get(current.id, current.path) ?? null) : null
}

function saveLiveToStore(): void {
  const buffer = liveBuffer()
  if (!buffer) return
  buffer.loading = previewLoading.value
  buffer.meta = meta.value
  buffer.err = previewErr.value
  buffer.text = editor.editorText.value
  buffer.baseline = editor.editorBaseline.value
  buffer.diskChanged = diskChanged.value
  buffer.rawBust = rawBust.value
  buffer.mdShowPreview = editor.mdShowPreview.value
  buffer.htmlShowPreview = editor.htmlShowPreview.value
}

function applyBuffer(buffer: TabBuffer): void {
  meta.value = buffer.meta
  previewLoading.value = buffer.loading
  previewErr.value = buffer.err
  editor.editorText.value = buffer.text
  editor.editorBaseline.value = buffer.baseline
  diskChanged.value = buffer.diskChanged
  rawBust.value = buffer.rawBust
  editor.mdShowPreview.value = buffer.mdShowPreview
  editor.htmlShowPreview.value = buffer.htmlShowPreview
}

function resetLive(): void {
  meta.value = null
  previewLoading.value = false
  previewErr.value = ''
  diskChanged.value = false
  rawBust.value = 0
  editor.editorText.value = ''
  editor.editorBaseline.value = ''
  editor.mdShowPreview.value = false
  editor.htmlShowPreview.value = false
}

// Declared before the immediate watcher below: on mount with an unloaded tab
// it calls loadFile synchronously, and a `let` declared further down would
// still be in its temporal dead zone.
let loadToken = 0

watch(
  () => [activeTab.value?.id, activeTab.value?.filePath] as const,
  ([tabId, filePath]) => {
    saveLiveToStore()
    if (tabId !== currentTab.value?.id) {
      editor.clearMarkdownOutline()
      outlineActiveId.value = ''
    }
    if (!tabId || !filePath) {
      currentTab.value = null
      resetLive()
      return
    }
    const buffer = buffers.ensure(tabId, filePath)
    currentTab.value = { id: tabId, path: filePath }
    applyBuffer(buffer)
    if (!buffer.loaded) {
      void loadFile(filePath, { reset: true })
    } else if (meta.value?.kind === 'office') {
      void office.loadOfficePreview(filePath)
    }
    void nextTick(maybeReveal)
  },
  { immediate: true, flush: 'pre' }
)

// Mirror live edits back into the active tab's buffer so the tab dot (and
// closing inactive tabs) can see unsaved state after switching away.
watch(
  [
    meta,
    previewLoading,
    previewErr,
    diskChanged,
    rawBust,
    () => editor.editorText.value,
    () => editor.editorBaseline.value,
    () => editor.mdShowPreview.value,
    () => editor.htmlShowPreview.value,
  ],
  () => saveLiveToStore()
)

// Editing a preview tab pins it, matching VS Code: the next preview open must
// no longer replace a tab the user has typed into.
watch(
  () => editor.editorDirty.value,
  (dirty) => {
    const tab = activeTab.value
    if (dirty && tab?.preview) emit('set-tab-preview', props.leaf.id, tab.id, false)
  }
)

// --- Load file when the active tab path changes ---
async function loadFile(
  filePath: string,
  opts: { reset: boolean; skipIfDirty?: boolean }
): Promise<void> {
  const token = ++loadToken
  const tabId = activeTab.value?.id
  previewLoading.value = true
  if (opts.reset) {
    previewErr.value = ''
    meta.value = null
    office.officeLoading.value = false
    office.officeErr.value = ''
    office.officeHtml.value = ''
  }

  try {
    await getApiBase()
    const q = new URLSearchParams({ pane_id: props.paneId, path: filePath })
    const res = await authFetch(apiUrl(`/api/workspace/meta?${q}`))
    if (!isStillActive(token, tabId, filePath)) return
    if (!res.ok) {
      const j = await res.json().catch(() => ({}))
      previewErr.value = j.error || 'error'
      return
    }
    const next = await res.json()
    if (!isStillActive(token, tabId, filePath)) return
    if (opts.skipIfDirty && editor.editorDirty.value) {
      diskChanged.value = true
      return
    }
    previewErr.value = ''
    meta.value = next
    const buffer = liveBuffer()
    if (buffer) buffer.loaded = true
    if (next?.kind === 'office') void office.loadOfficePreview(filePath)
    if (opts.reset) {
      // Markdown/HTML open rendered, mirroring how the file type is meant to be
      // consumed; the source is one click away.
      editor.mdShowPreview.value = next?.kind === 'markdown'
      editor.htmlShowPreview.value = next?.kind === 'html'
    }
    void nextTick(maybeReveal)
  } catch {
    if (isStillActive(token, tabId, filePath)) previewErr.value = 'network'
  } finally {
    if (token === loadToken) previewLoading.value = false
  }
}

function isStillActive(token: number, tabId: string | undefined, filePath: string): boolean {
  return (
    token === loadToken && activeTab.value?.id === tabId && activeTab.value?.filePath === filePath
  )
}

// --- Search result reveal ---
function maybeReveal(): void {
  const target = props.reveal
  if (!target || target.path !== activeFilePath.value) return
  if (!isEditableTextKind(meta.value?.kind)) return
  if (meta.value?.kind === 'markdown' && editor.mdShowPreview.value) {
    // Reveal needs the source editor; switch back from rendered preview first.
    editor.mdShowPreview.value = false
    void nextTick(maybeReveal)
    return
  }
  if (meta.value?.kind === 'html' && editor.htmlShowPreview.value) {
    editor.htmlShowPreview.value = false
    void nextTick(maybeReveal)
    return
  }
  void whenEditorReady(props.leaf.id).then((monaco) => {
    if (target.path !== activeFilePath.value) return
    const model = monaco.getModel()
    const line = Math.max(1, Math.min(target.line, model?.getLineCount() ?? target.line))
    const maxColumn = model?.getLineMaxColumn(line) ?? 1
    const column = Math.max(1, Math.min(target.column ?? 1, maxColumn))
    monaco.revealLineInCenter(line)
    monaco.setPosition({ lineNumber: line, column })
    monaco.focus()
  })
}

watch(
  () => props.reveal?.seq,
  () => void nextTick(maybeReveal)
)

/** Re-read the current file from disk, keeping unsaved buffers untouched. */
async function reloadFromDisk(): Promise<void> {
  const filePath = activeFilePath.value
  if (!filePath || activeIsDir.value) return
  diskChanged.value = false
  await loadFile(filePath, { reset: false, skipIfDirty: true })
  if (meta.value?.kind && !isEditableTextKind(meta.value.kind)) {
    rawBust.value = Date.now()
  }
}

function markDiskChanged(): void {
  diskChanged.value = true
}

async function onDiskChangedClick(): Promise<void> {
  const tabId = activeTab.value?.id
  const filePath = activeFilePath.value
  if (!filePath || activeIsDir.value) return
  if (editor.editorDirty.value) {
    const ok = await uiConfirm(t('filePreview.discardChanges'), {
      confirmText: t('filePreview.discardChanges'),
      cancelText: t('filePreview.cancel'),
    })
    if (!ok) return
  }
  // The confirm dialog is modal, but keep the guard in case focus moved.
  if (activeTab.value?.id !== tabId || activeFilePath.value !== filePath) return
  diskChanged.value = false
  await loadFile(filePath, { reset: true })
  if (meta.value?.kind && !isEditableTextKind(meta.value.kind)) {
    rawBust.value = Date.now()
  }
}

async function onSaveEditor(): Promise<void> {
  // Snapshot the tab before the PUT: the user may switch tabs while it lands.
  const tabId = props.leaf.activeTabId
  const result = await editor.saveEditor()
  if (!result) return
  const tab = props.leaf.tabs.find((item) => item.id === tabId && item.filePath === result.filePath)
  if (!tab) return
  const buffer = buffers.get(tab.id, tab.filePath) ?? buffers.ensure(tab.id, tab.filePath)
  const isLive = tab.id === props.leaf.activeTabId && tab.filePath === activeFilePath.value
  const liveText = isLive ? editor.editorText.value : buffer.text
  buffer.text = liveText
  buffer.baseline = result.content
  if (buffer.meta && isEditableTextKind(buffer.meta.kind)) {
    buffer.meta = { ...buffer.meta, content: result.content, truncated: false, message: undefined }
  }
  if (liveText === result.content) buffer.diskChanged = false

  if (!isLive) return
  // Only the tab that is still active may write the live refs. If edits
  // continued during the request the buffer stays dirty against the snapshot.
  editor.editorBaseline.value = result.content
  if (meta.value && isEditableTextKind(meta.value.kind)) {
    meta.value = { ...meta.value, content: result.content, truncated: false, message: undefined }
  }
  if (editor.editorText.value === result.content) diskChanged.value = false
}

// --- Tab actions ---
function requestCloseTab(tabId: string): void {
  const tab = props.leaf.tabs.find((item) => item.id === tabId)
  if (!tab) return
  if (!buffers.isDirty(tab)) {
    emit('close-tab', props.leaf.id, tabId)
    return
  }
  void uiConfirm(t('editorTabs.confirmClose', { name: baseName(tab.filePath) }), {
    title: t('editorTabs.confirmCloseTitle'),
    confirmText: t('editorTabs.discardClose'),
    cancelText: t('filePreview.cancel'),
  }).then((ok) => {
    if (ok) emit('close-tab', props.leaf.id, tabId)
  })
}

function closeMany(tabs: EditorTab[], title: string): void {
  if (!tabs.length) return
  const dirty = tabs.filter((tab) => buffers.isDirty(tab)).length
  const run = () =>
    emit(
      'close-tabs',
      props.leaf.id,
      tabs.map((tab) => tab.id)
    )
  if (!dirty) {
    run()
    return
  }
  void uiConfirm(t('editorTabs.confirmCloseMany', { count: tabs.length, dirty }), {
    title,
    confirmText: t('editorTabs.discardClose'),
    cancelText: t('filePreview.cancel'),
  }).then((ok) => {
    if (ok) run()
  })
}

function onTabCommand(tabId: string, command: TabMenuCommand): void {
  const tab = props.leaf.tabs.find((item) => item.id === tabId)
  if (!tab) return
  switch (command) {
    case 'close':
      requestCloseTab(tabId)
      break
    case 'toggle-preview':
      emit('set-tab-preview', props.leaf.id, tabId, !tab.preview)
      break
    case 'close-others':
      closeMany(tabsExcept(props.leaf, tabId), t('editorTabs.closeOthers'))
      break
    case 'close-right':
      closeMany(tabsRightOf(props.leaf, tabId), t('editorTabs.closeRight'))
      break
    case 'close-saved': {
      const saved = savedTabs(props.leaf, (item) => buffers.isDirty(item))
      if (saved.length)
        emit(
          'close-tabs',
          props.leaf.id,
          saved.map((item) => item.id)
        )
      break
    }
    case 'copy-path':
      emit('copy-tab-path', props.leaf.id, tabId)
      break
  }
}

function baseName(path: string): string {
  return path.split('/').pop() || path
}

// --- Drop handling ---
function getDropPosition(ev: DragEvent): DropPosition {
  const el = ev.currentTarget as HTMLElement
  const rect = el.getBoundingClientRect()
  const x = ev.clientX - rect.left
  const y = ev.clientY - rect.top
  const edge = Math.min(Math.min(rect.width, rect.height) * 0.25, 40)
  if (x < edge) return 'left'
  if (x > rect.width - edge) return 'right'
  if (y < edge) return 'top'
  if (y > rect.height - edge) return 'bottom'
  return 'center'
}

function isTreeMoveDrag(ev: DragEvent): boolean {
  const types = ev.dataTransfer?.types
  if (!types) return false
  return types.includes
    ? types.includes('application/x-tree-move')
    : (types as any).contains('application/x-tree-move')
}

function onPaneDragOver(ev: DragEvent) {
  if (isTabDragEvent(ev)) {
    const drag = getTabDrag()
    if (!drag) return
    ev.dataTransfer!.dropEffect = 'move'
    draggingTab.value = true
    const position = tabDropPosition(
      (ev.currentTarget as HTMLElement).getBoundingClientRect(),
      ev.clientX,
      ev.clientY
    )
    dropZone.value = drag.leafId === props.leaf.id && position === 'center' ? null : position
    return
  }
  if (!isTreeMoveDrag(ev)) return
  draggingTab.value = false
  ev.dataTransfer!.dropEffect = 'copy'
  dropZone.value = getDropPosition(ev)
}

function onPaneDragLeave(ev: DragEvent) {
  const next = ev.relatedTarget as Node | null
  if (next && (ev.currentTarget as HTMLElement).contains(next)) return
  dropZone.value = null
  draggingTab.value = false
}

function onPaneDrop(ev: DragEvent) {
  const position = dropZone.value ?? getDropPosition(ev)
  dropZone.value = null
  draggingTab.value = false

  if (isTabDragEvent(ev)) {
    const drag = getTabDrag()
    if (!drag) return
    endTabDrag()
    if (position === 'center') {
      if (drag.leafId !== props.leaf.id) {
        emit('move-tab', drag.leafId, drag.tabId, props.leaf.id)
      }
      return
    }
    emit(
      'split-tab',
      drag.leafId,
      drag.tabId,
      props.leaf.id,
      position as Exclude<EditorDropPosition, 'center'>
    )
    return
  }

  const rel = ev.dataTransfer?.getData('application/x-tree-move')
  if (!rel) return
  emit('file-drop', props.leaf.id, rel, position)
}

// Expose this pane's live state to FileWorkspacePreview (navigation guards,
// external-change refresh, close checks) without lifting the editor state up.
registerEditorPaneState(props.leaf.id, {
  filePath: () => activeFilePath.value,
  isDirty: () => editor.editorDirty.value,
  isTabDirty: (tabId: string) => {
    const tab = props.leaf.tabs.find((item) => item.id === tabId)
    return tab ? buffers.isDirty(tab) : false
  },
  meta,
  editorText: editor.editorText,
  editorBaseline: editor.editorBaseline,
  diskChanged,
  reloadFromDisk,
  markDiskChanged,
})

// --- Sync editor text from meta ---
watch(
  () => [meta.value?.kind, meta.value?.content],
  () => {
    const m = meta.value
    if (isEditableTextKind(m?.kind)) {
      // Restoring a dirty tab keeps its unsaved text; the disk content is
      // already mirrored in `baseline`.
      if (editor.editorText.value !== editor.editorBaseline.value) return
      const content = m.content ?? ''
      editor.editorText.value = content
      editor.editorBaseline.value = content
    } else {
      editor.editorText.value = ''
      editor.editorBaseline.value = ''
    }
  }
)

// Reset audio on rawUrl change
watch(
  () => [rawUrl.value, meta.value?.kind],
  () => {
    if (meta.value?.kind !== 'audio') return
    audio.resetAudio(audioRef.value)
  }
)

const paneEl = ref<HTMLElement | null>(null)
const editorEventDisposers = ref<Array<{ dispose: () => void }>>([])

watch(
  () => activeFilePath.value,
  () => {
    editor.editorSelection.value = null
  }
)

onMounted(() => {
  if (typeof window.matchMedia === 'function') {
    outlineMediaQuery = window.matchMedia(OUTLINE_MOBILE_QUERY)
    syncOutlineMobile()
    outlineMediaQuery.addEventListener?.('change', syncOutlineMobile)
  }
  whenEditorReady(props.leaf.id).then((monaco) => {
    editorEventDisposers.value.push(
      monaco.onDidChangeModelContent((e) => {
        if (isCursorBroadcasting(props.leaf.id)) return
        cursorGroup.broadcastChange(props.leaf.id, e.changes)
      }),
      monaco.onKeyDown((e) => {
        if (e.code !== 'KeyZ') return
        if (!(e.ctrlKey || e.metaKey)) return
        if (!isInActiveGroup.value) return
        e.preventDefault()
        e.stopPropagation()
        if (e.shiftKey) cursorGroup.groupRedo()
        else cursorGroup.groupUndo()
      })
    )
  })
})

onBeforeUnmount(() => {
  saveLiveToStore()
  unregisterEditorPaneState(props.leaf.id)
  stopOutlineSpy()
  if (outlineFlashTimer) clearTimeout(outlineFlashTimer)
  outlineMediaQuery?.removeEventListener?.('change', syncOutlineMobile)
  for (const disposer of editorEventDisposers.value) disposer.dispose()
  editorEventDisposers.value = []
})
</script>

<style scoped>
/* Positioning context for the outline overlay: opening the panel never
   changes the preview's width. */
.preview-wrap {
  position: relative;
  flex: 1 1 0;
  min-width: 0;
  min-height: 0;
  display: flex;
  overflow: hidden;
}

.preview-wrap :deep(.outline-target-flash) {
  animation: outline-target-flash 1.25s ease-out;
}

@keyframes outline-target-flash {
  0% {
    background: rgba(138, 138, 138, 0.2);
    box-shadow: 0 0 0 6px rgba(138, 138, 138, 0.08);
  }
  100% {
    background: transparent;
    box-shadow: 0 0 0 6px transparent;
  }
}

@media (prefers-reduced-motion: reduce) {
  .preview-wrap :deep(.outline-target-flash) {
    animation: none;
  }
}

.editor-pane {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  position: relative;
  border: 1px solid transparent;
  transition: border-color 0.15s;
}

.editor-pane.active {
  border-color: var(--accent, #4d80ff);
}

.editor-pane.drag-over {
  border-color: rgba(59, 130, 246, 0.5);
}

.editor-pane-drop-zone {
  position: absolute;
  z-index: 10;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(59, 130, 246, 0.15);
  border: 2px dashed rgba(59, 130, 246, 0.6);
  border-radius: 4px;
  font-size: 12px;
  color: var(--fg, #c7c7c7);
  pointer-events: none;
  transition: all 0.1s ease;
}

.editor-pane-drop-zone.zone-center {
  inset: 4px;
}

.editor-pane-drop-zone.zone-left {
  top: 4px;
  bottom: 4px;
  left: 4px;
  width: 30%;
}

.editor-pane-drop-zone.zone-right {
  top: 4px;
  bottom: 4px;
  right: 4px;
  width: 30%;
}

.editor-pane-drop-zone.zone-top {
  top: 4px;
  left: 4px;
  right: 4px;
  height: 30%;
}

.editor-pane-drop-zone.zone-bottom {
  bottom: 4px;
  left: 4px;
  right: 4px;
  height: 30%;
}
</style>
