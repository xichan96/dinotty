<template>
  <div v-if="visible && embedded" class="file-workspace-embedded">
    <input ref="fileInputRef" type="file" multiple class="sr-only" @change="onFilePick" />
    <div ref="fileWorkspaceBodyRef" class="file-workspace-body" :class="{ embedded }"
      @dragover.prevent
      @dragenter.prevent="dragCounter++"
      @dragleave="dragCounter = Math.max(0, dragCounter - 1)"
      @drop.prevent="dragCounter = 0; onDrop($event)"
    >
      <div v-if="dragging" class="file-workspace-drop-overlay">{{ t('filePreview.dropHint') }}</div>
      <div
        v-if="!treeCollapsed"
        class="file-workspace-tree-wrap"
        :class="{ narrow: layout.narrow.value }"
        :style="layout.treeWrapStyle.value"
      >
        <div class="file-workspace-tree tree-host" @click.stop @pointerdown.capture="bumpTreePointerTs" @contextmenu.prevent="onTreeBgContextMenu">
          <TreeRows
            :pane-id="paneId"
            :depth="0"
            rel-path=""
            :workspace-root="cwdLabel"
            :cache="childCache"
            :expanded="expanded"
            :selected-rel="selectedRel ?? undefined"
            :inline-create="inlineCreateForTree"
            :inline-placeholder="inlineInputPlaceholder"
            :inline-rename="inlineRename ?? undefined"
            :git-status="gitStatusMap"
            @toggle="onToggle"
            @select-file="trySelectFile"
            @select-dir="trySelectDir"
            @inline-create-commit="onInlineCreateCommit"
            @inline-create-cancel="onInlineCreateCancel"
            @inline-rename-commit="onInlineRenameCommit"
            @inline-rename-cancel="onInlineRenameCancel"
            @context-menu="onTreeContextMenu"
            @long-press="onTreeLongPress"
            @move-entry="onMoveEntry"
            @swipe-action="onSwipeAction"
          />
        </div>
      </div>
      <div
        v-if="!treeCollapsed"
        class="file-workspace-tree-splitter"
        @mousedown.prevent="(e) => layout.startTreeWidthDrag(e, fileWorkspaceBodyRef)"
        @touchstart.prevent="(e) => layout.startTreeWidthDragTouch(e, fileWorkspaceBodyRef)"
      ></div>
      <button
        v-if="treeCollapsed"
        type="button"
        class="file-workspace-tree-reveal"
        :title="t('previewPanel.expandTree')"
        @click="treeCollapsed = false"
      >
        ▶
      </button>
      <FilePreviewContent
        ref="previewContentRef1"
        :pane-id="paneId"
        :file-path="selectedRel ?? undefined"
        :preview-loading="previewLoading"
        :preview-err="previewErr"
        :selected-rel="selectedRel"
        :selected-is-dir="selectedIsDir"
        :meta="meta"
        :raw-url="rawUrl"
        :show-save="false"
        :audio-title="audioTitle"
        :audio-sub="audioSub"
        :audio-time-now="audio.audioTimeNow.value"
        :audio-time-total="audio.audioTimeTotal.value"
        :audio-seek-value="audio.audioSeekValue.value"
        :audio-vol-value="audio.audioVolValue.value"
        :audio-playing="audio.audioPlaying.value"
        :editor-dirty="editorDirty"
        :editor-text="editorText"
        :can-save-editor="canSaveEditor"
        :md-show-preview="mdShowPreview"
        :html-show-preview="htmlShowPreview"
        :markdown-editor-html="markdownEditorHtml"
        :office-loading="officeLoading"
        :office-err="officeErr"
        :office-html="officeHtml"
        @audio-time-update="audio.onAudioTimeUpdate(audioRef)"
        @audio-loaded-metadata="audio.onAudioLoadedMetadata(audioRef)"
        @audio-ended="audio.onAudioEnded()"
        @audio-seek-input="(ev) => audio.onAudioSeekInput(audioRef, ev)"
        @seek-audio="(d) => audio.seekAudio(audioRef, d)"
        @toggle-audio="audio.toggleAudio(audioRef)"
        @audio-volume-input="(ev) => audio.onAudioVolumeInput(audioRef, ev)"
        @update:md-show-preview="mdShowPreview = $event"
        @update:html-show-preview="htmlShowPreview = $event"
        @update:editor-text="editorText = $event"
        @save-editor="saveEditor"
        @selection-change="onEditorSelectionChange"
      />
    </div>
  </div>
  <div v-else-if="visible" class="file-workspace" :class="layout.direction.value">
    <div
      class="file-workspace-divider"
      @mousedown.prevent="startDrag"
      @touchstart.prevent="startDrag"
    ></div>
    <div class="file-workspace-panel">
      <div class="file-workspace-toolbar">
        <button
          v-if="!layout.narrow.value"
          type="button"
          class="file-workspace-drawer-btn"
          :title="treeCollapsed ? t('previewPanel.expandTree') : t('previewPanel.collapseTree')"
          @click="treeCollapsed = !treeCollapsed"
        >
          {{ treeCollapsed ? '▶' : '◀' }}
        </button>
        <button
          v-if="layout.narrow.value"
          type="button"
          class="file-workspace-drawer-btn"
          :title="treeCollapsed ? t('previewPanel.expandTree') : t('previewPanel.collapseTree')"
          @click="treeCollapsed = !treeCollapsed"
        >
          {{ treeCollapsed ? '▶' : '◀' }}
        </button>
        <button type="button" :disabled="!nav.canGoBack.value" @click="doGoBack" title="Back">←</button>
        <button type="button" :disabled="!nav.canGoForward.value" @click="doGoForward" title="Forward">→</button>
        <button type="button" @click="reloadAll" title="Refresh">↻</button>
        <span class="file-workspace-cwd" :title="cwdLabel">{{ cwdShort }}</span>
        <div class="file-workspace-add-menu">
          <button type="button" @click="addMenuOpen = !addMenuOpen" title="New">+</button>
          <div v-if="addMenuOpen" class="file-workspace-add-backdrop" @click="addMenuOpen = false"></div>
          <div v-if="addMenuOpen" class="file-workspace-add-dropdown">
            <button type="button" @click="addMenuOpen = false; startNewFile()">{{ t('filePreview.ctxNewFile') }}</button>
            <button type="button" @click="addMenuOpen = false; startNewFolder()">{{ t('filePreview.ctxNewFolder') }}</button>
          </div>
        </div>
        <button type="button" @click="triggerUpload()" title="Upload">↑</button>
        <button type="button" :disabled="!canDownload" @click="downloadSelected" title="Download">↓</button>
        <button type="button" @click="close" title="Close">✕</button>
      </div>
      <input ref="fileInputRef" type="file" multiple class="sr-only" @change="onFilePick" />
      <div ref="fileWorkspaceBodyRef" class="file-workspace-body"
        @dragover.prevent
        @dragenter.prevent="dragCounter++"
        @dragleave="dragCounter = Math.max(0, dragCounter - 1)"
        @drop.prevent="dragCounter = 0; onDrop($event)"
      >
        <div v-if="dragging" class="file-workspace-drop-overlay">{{ t('filePreview.dropHint') }}</div>
        <div
          v-if="!treeCollapsed"
          class="file-workspace-tree-wrap"
          :class="{ narrow: layout.narrow.value }"
          :style="layout.treeWrapStyle.value"
        >
          <div class="file-workspace-tree tree-host" @click.stop @pointerdown.capture="bumpTreePointerTs" @contextmenu.prevent="onTreeBgContextMenu">
            <TreeRows
              :pane-id="paneId"
              :depth="0"
              rel-path=""
              :workspace-root="cwdLabel"
              :cache="childCache"
              :expanded="expanded"
              :selected-rel="selectedRel ?? undefined"
              :inline-create="inlineCreateForTree"
              :inline-placeholder="inlineInputPlaceholder"
              :git-status="gitStatusMap"
              @toggle="onToggle"
              @select-file="trySelectFile"
              @select-dir="trySelectDir"
              @inline-create-commit="onInlineCreateCommit"
              @inline-create-cancel="onInlineCreateCancel"
              @context-menu="onTreeContextMenu"
              @long-press="onTreeLongPress"
              @move-entry="onMoveEntry"
              @swipe-action="onSwipeAction"
            />
          </div>
        </div>
        <div
          v-if="!treeCollapsed"
          class="file-workspace-tree-splitter"
          @mousedown.prevent="(e) => layout.startTreeWidthDrag(e, fileWorkspaceBodyRef)"
          @touchstart.prevent="(e) => layout.startTreeWidthDragTouch(e, fileWorkspaceBodyRef)"
        ></div>
        <button
          v-if="treeCollapsed"
          type="button"
          class="file-workspace-tree-reveal"
          :title="t('previewPanel.expandTree')"
          @click="treeCollapsed = false"
        >
          ▶
        </button>
          <FilePreviewContent
          ref="previewContentRef2"
          :pane-id="paneId"
          :file-path="selectedRel ?? undefined"
          :preview-loading="previewLoading"
          :preview-err="previewErr"
          :selected-rel="selectedRel"
          :selected-is-dir="selectedIsDir"
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
          :editor-dirty="editorDirty"
          :editor-text="editorText"
          :can-save-editor="canSaveEditor"
          :md-show-preview="mdShowPreview"
          :html-show-preview="htmlShowPreview"
          :markdown-editor-html="markdownEditorHtml"
          :office-loading="officeLoading"
          :office-err="officeErr"
          :office-html="officeHtml"
          @audio-time-update="audio.onAudioTimeUpdate(audioRef)"
          @audio-loaded-metadata="audio.onAudioLoadedMetadata(audioRef)"
          @audio-ended="audio.onAudioEnded()"
          @audio-seek-input="(ev) => audio.onAudioSeekInput(audioRef, ev)"
          @seek-audio="(d) => audio.seekAudio(audioRef, d)"
          @toggle-audio="audio.toggleAudio(audioRef)"
          @audio-volume-input="(ev) => audio.onAudioVolumeInput(audioRef, ev)"
          @update:md-show-preview="mdShowPreview = $event"
          @update:html-show-preview="htmlShowPreview = $event"
          @save-editor="saveEditor"
          @update:editor-text="editorText = $event"
          @selection-change="onEditorSelectionChange"
        />
      </div>
    </div>
  </div>
  <Teleport to="body">
    <div
      v-if="contextMenu && visible"
      class="tree-ctx-backdrop"
      @mousedown="closeContextMenu"
      @touchstart="closeContextMenu"
    ></div>
    <div
      v-if="contextMenu && visible"
      class="tree-ctx-menu"
      :class="{ 'tree-ctx-menu--bottom': layout.narrow.value }"
      role="menu"
      :style="contextMenuStyle"
      @mousedown.stop
      @touchstart.stop
    >
      <button type="button" class="tree-ctx-item" role="menuitem" @click="ctxNewFile">
        <span class="tree-ctx-label">{{ t('filePreview.ctxNewFile') }}</span>
      </button>
      <button type="button" class="tree-ctx-item" role="menuitem" @click="ctxNewFolder">
        <span class="tree-ctx-label">{{ t('filePreview.ctxNewFolder') }}</span>
      </button>
      <template v-if="contextMenu?.rel || selectedRel">
        <div class="tree-ctx-sep" />
        <button
          type="button"
          class="tree-ctx-item"
          role="menuitem"
          :disabled="!contextMenu?.rel && !selectedRel"
          @click="ctxRename"
        >
          <span class="tree-ctx-label">{{ t('filePreview.ctxRename') }}</span>
          <span class="tree-ctx-kbd">F2</span>
        </button>
        <div class="tree-ctx-sep" />
        <button
          type="button"
          class="tree-ctx-item"
          role="menuitem"
          @click="ctxCopyPath"
        >
          <span class="tree-ctx-label">{{ t('filePreview.ctxCopyPath') }}</span>
        </button>
        <button
          type="button"
          class="tree-ctx-item"
          role="menuitem"
          @click="ctxInsertToTerminal"
        >
          <span class="tree-ctx-label">{{ t('filePreview.ctxInsertToTerminal') }}</span>
        </button>
        <div class="tree-ctx-sep" />
        <button
          type="button"
          class="tree-ctx-item tree-ctx-item-danger"
          role="menuitem"
          :disabled="!contextMenu?.rel && !selectedRel"
          @click="ctxDelete"
        >
          <span class="tree-ctx-label">{{ t('filePreview.ctxDelete') }}</span>
          <span class="tree-ctx-kbd">{{ ctxDeleteKeyHint }}</span>
        </button>
      </template>
    </div>
  </Teleport>
  <ConfirmModal
    :visible="!!moveConfirm"
    :title="t('filePreview.moveTitle')"
    :message="t('filePreview.moveConfirmMsg')"
    :target="moveConfirm ? (moveConfirm.destDir || t('filePreview.moveToRoot')) : ''"
    :confirm-text="t('filePreview.moveTitle')"
    :cancel-text="t('filePreview.cancel')"
    @confirm="onMoveConfirm"
    @cancel="onMoveCancel"
  />
  <SelectionToolbar
    :selected-text="editorSelection?.text ?? ''"
    :anchor-rect="editorSelection?.rect ?? null"
    @dismiss="onSelectionDismiss"
  />
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { useI18n } from '../../composables/useI18n'
import { getApiBase, apiUrl, authFetch, getAuthToken } from '../../composables/apiBase'
import { usePaneResize } from '../../composables/usePaneResize'
import { useFileNavigation } from '../../composables/useFileNavigation'
import { useAudioPlayer } from '../../composables/useAudioPlayer'
import { useFileWorkspaceLayout } from '../../composables/useFileWorkspaceLayout'
import { useFileWatch } from '../../composables/useFileWatch'
import { TreeRows } from '../workspace/TreeRows'
import type { DirEntry } from '../workspace/TreeRows'
import FilePreviewContent from '../workspace/FilePreviewContent.vue'
import SelectionToolbar from '../workspace/SelectionToolbar.vue'
import ConfirmModal from '../ui/ConfirmModal.vue'
import { useSelectedPath } from '../../composables/useFileNavigation'
import { copyToClipboard } from '../../utils/clipboard'

// Lazy-loaded heavy libraries (promise-cache avoids concurrent-init races)
let _markedPromise: Promise<typeof import('marked')> | null = null
let _domPurifyPromise: Promise<typeof import('dompurify')> | null = null

function getMarked() {
  if (!_markedPromise) {
    _markedPromise = import('marked').then((m) => {
      m.use({
        gfm: true,
        breaks: true,
        renderer: {
          code({ text, lang }: { text: string; lang?: string }) {
            const language = (lang || 'plaintext').trim() || 'plaintext'
            const safeLang = language.replace(/[^a-z0-9_-]/gi, '') || 'plaintext'
            return `<pre><code class="language-${safeLang}">${esc(text)}</code></pre>`
          },
        },
      })
      return m
    })
  }
  return _markedPromise
}

function getDOMPurify() {
  if (!_domPurifyPromise) _domPurifyPromise = import('dompurify')
  return _domPurifyPromise
}

const props = withDefaults(
  defineProps<{ visible: boolean; paneId: string; embedded?: boolean }>(),
  { embedded: false },
)
const treeCollapsed = defineModel<boolean>('treeCollapsed', { default: false })
const emit = defineEmits<{ close: []; navigate: [path: string]; 'update:canGoBack': [v: boolean]; 'update:canGoForward': [v: boolean] }>()

const { t } = useI18n()

interface Meta {
  kind: string
  content?: string
  language?: string
  truncated?: boolean
  message?: string
}

// --- Composables ---
const nav = useFileNavigation()
const audio = useAudioPlayer()
const layout = useFileWorkspaceLayout()

watch(nav.canGoBack, v => emit('update:canGoBack', v), { immediate: true })
watch(nav.canGoForward, v => emit('update:canGoForward', v), { immediate: true })

// --- State ---
const cwdLabel = ref('')
const childCache = ref<Record<string, DirEntry[]>>({})
const expanded = ref<Set<string>>(new Set())
const selectedRel = ref<string | null>(null)
const selectedIsDir = ref(false)
const meta = ref<Meta | null>(null)
const previewLoading = ref(false)
const previewErr = ref('')
const fileInputRef = ref<HTMLInputElement>()
const dragCounter = ref(0)
const dragging = computed(() => dragCounter.value > 0)
const lastTreePointerTs = ref(0)
const officeLoading = ref(false)
const officeErr = ref('')
const officeHtml = ref('')
const gitStatusMap = ref<Record<string, string>>({})
const inlineCreate = ref<{ parentRel: string; kind: 'file' | 'dir' } | null>(null)
const inlineRename = ref<{ rel: string; isDir: boolean } | null>(null)
const editorText = ref('')
const editorBaseline = ref('')
const mdShowPreview = ref(false)
const htmlShowPreview = ref(false)
const contextMenu = ref<{ x: number; y: number; rel: string; isDir: boolean } | null>(null)
const addMenuOpen = ref(false)
const moveConfirm = ref<{ src: string; destDir: string } | null>(null)
const fileWorkspaceBodyRef = ref<HTMLElement | null>(null)
const cacheBustTs = ref<number | null>(null)
const editorSelection = ref<{ text: string; rect: DOMRect | null } | null>(null)

// --- File Watch ---
const fileWatch = useFileWatch({
  paneId: () => props.paneId,
  cwdLabel,
  expanded,
  childCache,
  selectedRel,
  selectedIsDir,
  meta,
  editorDirty: () => editorDirty.value,
  onFileDeleted: () => {
    selectedRel.value = null
    selectedIsDir.value = false
    meta.value = null
    previewErr.value = ''
  },
  onFileChanged: (newMeta) => {
    meta.value = newMeta
    editorText.value = newMeta.content ?? ''
    editorBaseline.value = newMeta.content ?? ''
    fetchGitStatus()
  },
  onBinaryChanged: () => {
    cacheBustTs.value = Date.now()
  },
  fetchList,
})

// --- Audio ---
const previewContentRef1 = ref<InstanceType<typeof FilePreviewContent> | null>(null)
const previewContentRef2 = ref<InstanceType<typeof FilePreviewContent> | null>(null)
const audioRef = computed(() => previewContentRef1.value?.audioRef ?? previewContentRef2.value?.audioRef ?? null)

const audioTitle = computed(() => (selectedRel.value ? selectedRel.value.split('/').pop() || selectedRel.value : ''))
const audioSub = computed(() => '')

// --- Computed ---
const cwdShort = computed(() => {
  const s = cwdLabel.value
  if (s.length <= 36) return s
  return '…' + s.slice(-34)
})

const rawUrl = computed(() => {
  if (!selectedRel.value || selectedIsDir.value) return ''
  const q = new URLSearchParams({ pane_id: props.paneId, path: selectedRel.value })
  const token = getAuthToken()
  if (token) q.set('token', token)
  if (cacheBustTs.value) q.set('_t', String(cacheBustTs.value))
  return apiUrl(`/api/workspace/raw?${q}`)
})

const inlineCreateForTree = computed(() => inlineCreate.value ?? undefined)

const inlineInputPlaceholder = computed(() => {
  if (!inlineCreate.value) return ''
  return inlineCreate.value.kind === 'dir' ? t('filePreview.nameFolder') : t('filePreview.nameFile')
})

const editorDirty = computed(() => editorText.value !== editorBaseline.value)

const canSaveEditorContext = computed(
  () =>
    !!selectedRel.value &&
    !selectedIsDir.value &&
    !meta.value?.truncated &&
    (meta.value?.kind === 'text' || meta.value?.kind === 'markdown'),
)

const canSaveEditor = computed(() => canSaveEditorContext.value && editorDirty.value)

const canDownload = computed(
  () => !!selectedRel.value && !selectedIsDir.value && meta.value?.kind !== 'unsupported',
)

const ctxDeleteKeyHint = computed(() =>
  typeof navigator !== 'undefined' && /Mac|iPhone|iPod|iPad/i.test(navigator.platform) ? '⌘⌫' : 'Del',
)

const contextMenuStyle = computed(() => {
  const m = contextMenu.value
  if (!m) return {}
  if (layout.narrow.value) return { left: '0', right: '0', bottom: '0' }
  const pad = 8
  const mw = 220
  const mh = 140
  let left = m.x
  let top = m.y
  if (typeof window !== 'undefined') {
    if (left + mw > window.innerWidth - pad) left = Math.max(pad, window.innerWidth - mw - pad)
    if (top + mh > window.innerHeight - pad) top = Math.max(pad, window.innerHeight - mh - pad)
  }
  return { left: `${left}px`, top: `${top}px` }
})

function esc(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

const markdownEditorHtml = ref('')
let mdDebounceTimer: ReturnType<typeof setTimeout> | null = null

watch(editorText, (src) => {
  if (mdDebounceTimer) { clearTimeout(mdDebounceTimer); mdDebounceTimer = null }
  if (!src) { markdownEditorHtml.value = ''; return }
  mdDebounceTimer = setTimeout(async () => {
    try {
      const [m, dp] = await Promise.all([getMarked(), getDOMPurify()])
      const html = m.parse(src, { async: false }) as string
      markdownEditorHtml.value = dp.default.sanitize(html)
    } catch { markdownEditorHtml.value = '' }
  }, 300)
})

// --- Navigation ---
function ensureParentsExpanded(rel: string) {
  const parts = rel.split('/')
  const next = new Set(expanded.value)
  next.add('')
  for (let i = 1; i < parts.length; i++) {
    const ancestor = parts.slice(0, i).join('/')
    if (!next.has(ancestor)) {
      next.add(ancestor)
      void ensureChildren(ancestor)
    }
  }
  expanded.value = next
}

function doGoBack() {
  const entry = nav.goBack()
  if (!entry) return
  ensureParentsExpanded(entry.rel)
  if (entry.isDir) onSelectDir(entry.rel)
  else void onSelectFile(entry.rel)
}

function doGoForward() {
  const entry = nav.goForward()
  if (!entry) return
  ensureParentsExpanded(entry.rel)
  if (entry.isDir) onSelectDir(entry.rel)
  else void onSelectFile(entry.rel)
}

// --- Tree interactions ---
function bumpTreePointerTs() { lastTreePointerTs.value = Date.now() }

function shouldBlockNavigate(): boolean {
  if (!editorDirty.value || !meta.value || (meta.value.kind !== 'text' && meta.value.kind !== 'markdown')) return false
  return !confirm(t('filePreview.discardChanges'))
}

async function trySelectFile(rel: string) {
  if (shouldBlockNavigate()) return
  await onSelectFile(rel)
}

function trySelectDir(rel: string) {
  if (shouldBlockNavigate()) return
  onSelectDir(rel)
}

function parentRelPath(rel: string): string {
  const i = rel.lastIndexOf('/')
  return i === -1 ? '' : rel.slice(0, i)
}

function absolutePath(rel: string): string {
  const root = cwdLabel.value.replace(/\/+$/, '')
  return rel ? `${root}/${rel}` : root
}

const { selectedPath: globalSelectedPath } = useSelectedPath()

function onSelectDir(rel: string) {
  selectedRel.value = rel
  selectedIsDir.value = true
  meta.value = null
  previewErr.value = ''
  nav.pushNav(rel, true)
  globalSelectedPath.value = absolutePath(rel)
  emit('navigate', absolutePath(rel))
}

async function onSelectFile(rel: string) {
  selectedRel.value = rel
  selectedIsDir.value = false
  previewErr.value = ''
  previewLoading.value = true
  meta.value = null
  officeLoading.value = false
  officeErr.value = ''
  officeHtml.value = ''
  nav.pushNav(rel, false)
  globalSelectedPath.value = absolutePath(rel)
  emit('navigate', absolutePath(rel))
  try {
    await getApiBase()
    const q = new URLSearchParams({ pane_id: props.paneId, path: rel })
    const res = await authFetch(apiUrl(`/api/workspace/meta?${q}`))
    if (!res.ok) {
      const j = await res.json().catch(() => ({}))
      previewErr.value = j.error || 'error'
      return
    }
    meta.value = await res.json()
    if (meta.value?.kind === 'office') void loadOfficePreview(rel)
  } catch {
    previewErr.value = 'network'
  } finally {
    previewLoading.value = false
  }
}

// --- Tree data ---
async function fetchList(rel: string): Promise<DirEntry[]> {
  await getApiBase()
  const q = new URLSearchParams({ pane_id: props.paneId, path: rel })
  const res = await authFetch(apiUrl(`/api/workspace/list?${q}`))
  if (!res.ok) throw new Error('list failed')
  const data = await res.json()
  cwdLabel.value = data.cwd || ''
  return data.entries || []
}

async function fetchGitStatus() {
  try {
    await getApiBase()
    const q = new URLSearchParams({ pane_id: props.paneId })
    const res = await authFetch(apiUrl(`/api/workspace/git-status?${q}`))
    if (!res.ok) return
    const data = await res.json()
    if (!data.is_git_repo) { gitStatusMap.value = {}; return }
    const map: Record<string, string> = {}
    for (const f of data.files || []) {
      map[f.path] = f.status
    }
    gitStatusMap.value = map
  } catch {
    gitStatusMap.value = {}
  }
}

async function ensureChildren(rel: string) {
  if (childCache.value[rel]) return
  const entries = await fetchList(rel)
  childCache.value = { ...childCache.value, [rel]: entries }
}

function onToggle(rel: string) {
  const next = new Set(expanded.value)
  if (next.has(rel)) next.delete(rel)
  else next.add(rel)
  expanded.value = next
  if (next.has(rel)) void ensureChildren(rel)
}

// --- Inline create/rename ---
function newItemParentRel(): string {
  if (selectedIsDir.value && selectedRel.value) return selectedRel.value
  if (!selectedIsDir.value && selectedRel.value) return parentRelPath(selectedRel.value)
  return ''
}

function startNewFile() {
  if (shouldBlockNavigate()) return
  const parentRel = newItemParentRel()
  inlineCreate.value = { parentRel, kind: 'file' }
  expanded.value = new Set([...expanded.value, parentRel])
  void ensureChildren(parentRel)
}

function startNewFolder() {
  if (shouldBlockNavigate()) return
  const parentRel = newItemParentRel()
  inlineCreate.value = { parentRel, kind: 'dir' }
  expanded.value = new Set([...expanded.value, parentRel])
  void ensureChildren(parentRel)
}

async function onInlineCreateCommit(name: string) {
  if (!inlineCreate.value) return
  if (!name) { inlineCreate.value = null; return }
  const { parentRel, kind } = inlineCreate.value
  inlineCreate.value = null
  await getApiBase()
  const q = new URLSearchParams({ pane_id: props.paneId, parent: parentRel })
  const res = await authFetch(apiUrl(`/api/workspace/create?${q}`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind, name }),
  })
  if (!res.ok) {
    previewErr.value = res.status === 409 ? 'exists' : 'create failed'
    return
  }
  previewErr.value = ''
  const data = await res.json()
  const rel = data.rel as string
  const next = { ...childCache.value }
  delete next[parentRel]
  childCache.value = next
  try { await ensureChildren(parentRel) } catch {}
  if (kind === 'file') await onSelectFile(rel)
  else {
    expanded.value = new Set([...expanded.value, rel])
    onSelectDir(rel)
    void ensureChildren(rel)
  }
}

function onInlineCreateCancel() { inlineCreate.value = null }

async function onInlineRenameCommit(newName: string) {
  if (!inlineRename.value) return
  if (!newName) { inlineRename.value = null; return }
  const { rel, isDir } = inlineRename.value
  inlineRename.value = null
  await getApiBase()
  const q = new URLSearchParams({ pane_id: props.paneId, path: rel })
  const res = await authFetch(apiUrl(`/api/workspace/rename?${q}`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ new_name: newName }),
  })
  if (!res.ok) {
    const j = await res.json().catch(() => ({}))
    previewErr.value = j.error || 'rename failed'
    return
  }
  previewErr.value = ''
  const data = await res.json()
  const newRel = data.rel as string
  const parentRel = parentRelPath(rel)
  const next = { ...childCache.value }
  delete next[parentRel]
  if (isDir) {
    for (const k of Object.keys(next)) {
      if (k === rel || k.startsWith(`${rel}/`)) delete next[k]
    }
  }
  childCache.value = next
  try { await ensureChildren(parentRel) } catch {}
  if (selectedRel.value === rel) {
    if (isDir) onSelectDir(newRel)
    else await onSelectFile(newRel)
  }
}

function onInlineRenameCancel() { inlineRename.value = null }

function onMoveEntry(payload: { src: string; destDir: string }) {
  const { src, destDir } = payload
  if (!src) return
  const srcParent = parentRelPath(src)
  if (srcParent === destDir) return
  moveConfirm.value = { src, destDir }
}

async function executeMove() {
  const info = moveConfirm.value
  if (!info) return
  moveConfirm.value = null
  const { src, destDir } = info
  const srcParent = parentRelPath(src)
  await getApiBase()
  const q = new URLSearchParams({ pane_id: props.paneId, path: src })
  const res = await authFetch(apiUrl(`/api/workspace/move?${q}`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dest: destDir }),
  })
  if (!res.ok) {
    const j = await res.json().catch(() => ({}))
    previewErr.value = j.error || 'move failed'
    return
  }
  previewErr.value = ''
  const next = { ...childCache.value }
  delete next[srcParent]
  delete next[destDir]
  for (const k of Object.keys(next)) {
    if (k === src || k.startsWith(`${src}/`)) delete next[k]
  }
  childCache.value = next
  try { await Promise.all([ensureChildren(srcParent), ensureChildren(destDir)]) } catch {}
}

function onMoveConfirm() { executeMove() }
function onMoveCancel() { moveConfirm.value = null }

// --- Context menu ---
function closeContextMenu() { contextMenu.value = null }

function onTreeContextMenu(payload: { ev: MouseEvent; rel: string; isDir: boolean }) {
  payload.ev.preventDefault()
  contextMenu.value = { x: payload.ev.clientX, y: payload.ev.clientY, rel: payload.rel, isDir: payload.isDir }
}

function onTreeBgContextMenu(ev: MouseEvent) {
  ev.preventDefault()
  contextMenu.value = { x: ev.clientX, y: ev.clientY, rel: '', isDir: true }
}

function onTreeLongPress(pos: { clientX: number; clientY: number }, rel: string, isDir: boolean) {
  contextMenu.value = { x: pos.clientX, y: pos.clientY, rel, isDir }
}

function ctxNewFile() {
  if (!contextMenu.value) return
  const { rel, isDir } = contextMenu.value
  closeContextMenu()
  if (shouldBlockNavigate()) return
  const parentRel = isDir ? rel : parentRelPath(rel)
  inlineCreate.value = { parentRel, kind: 'file' }
  expanded.value = new Set([...expanded.value, parentRel])
  void ensureChildren(parentRel)
}

function ctxNewFolder() {
  if (!contextMenu.value) return
  const { rel, isDir } = contextMenu.value
  closeContextMenu()
  if (shouldBlockNavigate()) return
  const parentRel = isDir ? rel : parentRelPath(rel)
  inlineCreate.value = { parentRel, kind: 'dir' }
  expanded.value = new Set([...expanded.value, parentRel])
  void ensureChildren(parentRel)
}

function ctxRename() {
  if (!contextMenu.value) return
  const { rel, isDir } = contextMenu.value
  closeContextMenu()
  const targetRel = rel || selectedRel.value
  if (!targetRel) return
  const targetIsDir = rel ? isDir : selectedIsDir.value
  inlineRename.value = { rel: targetRel, isDir: targetIsDir }
}

async function ctxDelete() {
  if (!contextMenu.value) return
  const { rel, isDir } = contextMenu.value
  closeContextMenu()
  const targetRel = rel || selectedRel.value
  const targetIsDir = rel ? isDir : selectedIsDir.value
  if (!targetRel) return
  const discardNeeded = editorDirty.value && meta.value && (meta.value.kind === 'text' || meta.value.kind === 'markdown')
  const prevRel = selectedRel.value
  const prevIsDir = selectedIsDir.value
  const prevMeta = meta.value
  const deleteMsg = targetIsDir ? t('filePreview.confirmDeleteFolder') : t('filePreview.confirmDeleteFile')
  if (discardNeeded) {
    if (!confirm(`${t('filePreview.discardChanges')}\n\n${deleteMsg}`)) return
    editorText.value = editorBaseline.value
  }
  selectedRel.value = targetRel
  selectedIsDir.value = targetIsDir
  meta.value = null
  const ok = await deleteSelected(discardNeeded ?? false)
  if (!ok) {
    selectedRel.value = prevRel
    selectedIsDir.value = prevIsDir
    meta.value = prevMeta
  }
}

function ctxCopyPath() {
  if (!contextMenu.value) return
  const { rel } = contextMenu.value
  closeContextMenu()
  const targetRel = rel || selectedRel.value
  if (!targetRel) return
  void copyToClipboard(absolutePath(targetRel))
}

function ctxInsertToTerminal() {
  if (!contextMenu.value) return
  const { rel } = contextMenu.value
  closeContextMenu()
  const targetRel = rel || selectedRel.value
  if (!targetRel) return
  window.dispatchEvent(new CustomEvent('terminal-insert-path', {
    detail: { path: absolutePath(targetRel) },
  }))
}

function onSwipeAction(payload: { rel: string; action: string }) {
  const { rel, action } = payload
  const absPath = absolutePath(rel)
  if (action === 'copy-path') {
    void copyToClipboard(absPath)
  } else if (action === 'insert-to-terminal') {
    window.dispatchEvent(new CustomEvent('terminal-insert-path', {
      detail: { path: absPath },
    }))
  }
}

// --- Selection Toolbar ---
function onEditorSelectionChange(payload: { text: string; rect: DOMRect | null }) {
  if (payload.text && payload.rect) {
    editorSelection.value = payload
  } else {
    editorSelection.value = null
  }
}

function onSelectionDismiss() {
  editorSelection.value = null
}

// --- Editor ---
async function saveEditor() {
  if (!canSaveEditor.value || !selectedRel.value) return
  await getApiBase()
  const q = new URLSearchParams({ pane_id: props.paneId, path: selectedRel.value })
  const res = await authFetch(apiUrl(`/api/workspace/file?${q}`), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: editorText.value }),
  })
  if (!res.ok) return
  editorBaseline.value = editorText.value
  if (meta.value && (meta.value.kind === 'text' || meta.value.kind === 'markdown')) {
    meta.value = { ...meta.value, content: editorText.value, truncated: false, message: undefined }
  }
}

// --- Office preview ---
function officeNodeToHtml(node: any): string {
  if (!node) return ''
  const type = String(node.type || '')
  if (type === 'table') {
    const rows = Array.isArray(node.children) ? node.children : []
    const tr = rows.map((r: any) => {
      const cells = Array.isArray(r.children) ? r.children : []
      const tds = cells.map((c: any) => `<td>${esc(String(c.text ?? ''))}</td>`).join('')
      return `<tr>${tds}</tr>`
    }).join('')
    return `<table>${tr}</table>`
  }
  if (type === 'list') {
    const items = Array.isArray(node.children) ? node.children : []
    const li = items.map((it: any) => `<li>${officeNodeToHtml(it) || esc(String(it.text ?? ''))}</li>`).join('')
    return `<ul>${li}</ul>`
  }
  if (type === 'heading') {
    const level = Math.max(1, Math.min(6, Number(node?.metadata?.level || 2)))
    return `<h${level}>${esc(String(node.text ?? ''))}</h${level}>`
  }
  if (type === 'paragraph') {
    const txt = String(node.text ?? '').trim()
    if (!txt) return ''
    return `<p>${esc(txt)}</p>`
  }
  const children = Array.isArray(node.children) ? node.children.map(officeNodeToHtml).join('') : ''
  if (children) return children
  const txt = String(node.text ?? '').trim()
  return txt ? `<p>${esc(txt)}</p>` : ''
}

async function loadOfficePreview(rel: string) {
  officeLoading.value = true
  officeErr.value = ''
  officeHtml.value = ''
  try {
    await getApiBase()
    const q = new URLSearchParams({ pane_id: props.paneId, path: rel })
    const res = await authFetch(apiUrl(`/api/workspace/raw?${q}`))
    if (!res.ok) throw new Error('raw')
    const buf = await res.arrayBuffer()
    const [officeMod, dp] = await Promise.all([import('officeparser'), getDOMPurify()])
    const ast: any = await (officeMod.default as any).parseOffice(buf)
    const nodes = Array.isArray(ast?.content) ? ast.content : []
    const html = nodes.map(officeNodeToHtml).join('') || `<pre>${esc(ast?.toText?.() || '')}</pre>`
    officeHtml.value = dp.default.sanitize(html)
  } catch {
    officeErr.value = 'unsupported'
  } finally {
    officeLoading.value = false
  }
}

// --- Upload/Download/Delete ---
function triggerUpload() { fileInputRef.value?.click() }

async function uploadFiles(files: { file: File; path: string }[]) {
  if (!files.length) return
  await getApiBase()
  const dir = selectedIsDir.value && selectedRel.value ? selectedRel.value : ''
  const q = new URLSearchParams({ pane_id: props.paneId, dir })
  const fd = new FormData()
  for (const { file, path } of files) {
    fd.append('path', path)
    fd.append('file', file)
  }
  try {
    const res = await authFetch(apiUrl(`/api/workspace/upload?${q}`), { method: 'POST', body: fd })
    if (!res.ok) console.error('[upload] server error:', res.status)
  } catch (e) {
    console.error('[upload] request failed:', e)
  }
  const next = { ...childCache.value }
  delete next[dir]
  childCache.value = next
  try { await ensureChildren(dir) } catch {}
}

async function onFilePick(ev: Event) {
  const inp = ev.target as HTMLInputElement
  const fileList = inp.files
  if (!fileList?.length) return
  const files: { file: File; path: string }[] = []
  for (let i = 0; i < fileList.length; i++) {
    const f = fileList[i]
    files.push({ file: f, path: f.webkitRelativePath || f.name })
  }
  inp.value = ''
  try { await uploadFiles(files) } catch (e) { console.error('[upload]', e) }
}

async function traverseEntry(entry: FileSystemEntry, basePath: string): Promise<{ file: File; path: string }[]> {
  if (entry.isFile) {
    const fileEntry = entry as FileSystemFileEntry
    try {
      const file = await new Promise<File>((resolve, reject) => fileEntry.file(resolve, reject))
      return [{ file, path: basePath + entry.name }]
    } catch { return [] }
  }
  if (entry.isDirectory) {
    const dirEntry = entry as FileSystemDirectoryEntry
    const reader = dirEntry.createReader()
    const entries: FileSystemEntry[] = []
    try {
      let batch: FileSystemEntry[]
      do {
        batch = await new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject))
        entries.push(...batch)
      } while (batch.length > 0)
    } catch { return [] }
    const results: { file: File; path: string }[] = []
    const childResults = await Promise.all(entries.map(child => traverseEntry(child, basePath + entry.name + '/')))
    for (const r of childResults) results.push(...r)
    return results
  }
  return []
}

async function onDrop(ev: DragEvent) {
  const items = ev.dataTransfer?.items
  if (!items) return
  const allFiles: { file: File; path: string }[] = []
  const promises: Promise<void>[] = []
  for (let i = 0; i < items.length; i++) {
    const entry = items[i].webkitGetAsEntry?.()
    if (entry) promises.push(traverseEntry(entry, '').then(files => { allFiles.push(...files) }))
  }
  try { await Promise.all(promises) } catch {}
  if (!allFiles.length) return
  await uploadFiles(allFiles)
}

async function downloadSelected() {
  if (!selectedRel.value || selectedIsDir.value) return
  await getApiBase()
  const q = new URLSearchParams({ pane_id: props.paneId, path: selectedRel.value })
  const res = await authFetch(apiUrl(`/api/workspace/raw?${q}`))
  if (!res.ok) return
  const blob = await res.blob()
  const name = selectedRel.value.split('/').pop() || 'file'
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  a.click()
  URL.revokeObjectURL(a.href)
}

async function deleteSelected(skipConfirm = false): Promise<boolean> {
  const rel = selectedRel.value
  if (!rel) return false
  inlineCreate.value = null
  const wasDir = selectedIsDir.value
  const msg = wasDir ? t('filePreview.confirmDeleteFolder') : t('filePreview.confirmDeleteFile')
  if (!skipConfirm && !confirm(msg)) return false
  await getApiBase()
  const q = new URLSearchParams({ pane_id: props.paneId, path: rel })
  const res = await authFetch(apiUrl(`/api/workspace/delete?${q}`), { method: 'DELETE' })
  if (!res.ok) return false
  const parentRel = parentRelPath(rel)
  if (wasDir) {
    const next: Record<string, DirEntry[]> = { ...childCache.value }
    for (const k of Object.keys(next)) {
      if (k === rel || k.startsWith(`${rel}/`)) delete next[k]
    }
    delete next[parentRel]
    childCache.value = next
    const nextExp = new Set(expanded.value)
    for (const k of [...nextExp]) {
      if (k === rel || k.startsWith(`${rel}/`)) nextExp.delete(k)
    }
    expanded.value = nextExp
  } else {
    const next = { ...childCache.value }
    delete next[parentRel]
    childCache.value = next
  }
  selectedRel.value = null
  selectedIsDir.value = false
  meta.value = null
  previewErr.value = ''
  officeLoading.value = false
  officeErr.value = ''
  officeHtml.value = ''
  emit('navigate', absolutePath(parentRel))
  try { await ensureChildren(parentRel) } catch {}
  return true
}

// --- Reload/Boot ---
async function reloadAll() {
  inlineCreate.value = null
  contextMenu.value = null
  childCache.value = {}
  expanded.value = new Set()
  previewErr.value = ''
  meta.value = null
  try { await ensureChildren('') } catch { previewErr.value = 'list failed' }
}

async function expandFirstLevelDirs() {
  const entries = childCache.value['']
  if (!entries) return
  const dirs = entries.filter(e => e.is_dir)
  if (!dirs.length) return
  const dirPaths = dirs.map(d => d.name)
  expanded.value = new Set(dirPaths)
  await Promise.all(dirPaths.map(p => ensureChildren(p)))
}

async function boot() {
  selectedRel.value = null
  selectedIsDir.value = false
  meta.value = null
  previewErr.value = ''
  inlineCreate.value = null
  contextMenu.value = null
  childCache.value = {}
  expanded.value = new Set()
  try {
    await ensureChildren('')
    fileWatch.connectTreeWatchSocket()
    fetchGitStatus()
  } catch { previewErr.value = 'list failed' }
}

function close() { emit('close') }

// --- Open from terminal ---
async function openFromTerminal(path: string) {
  await getApiBase()
  const q = new URLSearchParams({ pane_id: props.paneId, path })
  const res = await authFetch(apiUrl(`/api/workspace/resolve?${q}`))
  if (!res.ok) return
  const { rel } = await res.json()
  previewErr.value = ''
  inlineCreate.value = null
  contextMenu.value = null
  childCache.value = {}
  expanded.value = new Set()
  try { await ensureChildren('') } catch { previewErr.value = 'list failed'; return }
  const parts = rel.split('/').filter(Boolean)
  if (parts.length === 0) {
    selectedRel.value = null
    selectedIsDir.value = false
    meta.value = null
    return
  }
  let acc = ''
  const nextExpanded = new Set(expanded.value)
  for (let i = 0; i < parts.length - 1; i++) {
    acc = acc ? `${acc}/${parts[i]}` : parts[i]
    nextExpanded.add(acc)
    await ensureChildren(acc)
  }
  expanded.value = nextExpanded
  const base = parts[parts.length - 1]
  const parentRel = parts.slice(0, -1).join('/')
  await ensureChildren(parentRel)
  const full = rel
  const parentEntries = childCache.value[parentRel]
  const entry = parentEntries?.find((e) => e.name === base)
  if (entry?.is_dir) onSelectDir(full)
  else await onSelectFile(full)
}

// --- Keyboard ---
function onEditorSaveKeydown(e: KeyboardEvent) {
  if (contextMenu.value && e.key === 'Escape') {
    e.preventDefault()
    closeContextMenu()
    return
  }
  if (!props.visible) return
  const saveChord = (e.metaKey || e.ctrlKey) && (e.code === 'KeyS' || e.key === 's' || e.key === 'S')
  if (!saveChord) return
  if (!canSaveEditorContext.value) return
  e.preventDefault()
  if (canSaveEditor.value) void saveEditor()
}

function onCloseContextScroll() {
  if (contextMenu.value) contextMenu.value = null
}

// --- Watchers ---
watch(layout.narrow, (isNarrow) => {
  if (isNarrow) treeCollapsed.value = false
})

watch(
  () => [selectedRel.value, selectedIsDir.value, meta.value?.kind, meta.value?.content, meta.value?.truncated],
  () => {
    if (selectedIsDir.value || !selectedRel.value) {
      editorText.value = ''
      editorBaseline.value = ''
      return
    }
    const m = meta.value
    if (m?.kind === 'text' || m?.kind === 'markdown') {
      const c = m.content ?? ''
      editorText.value = c
      editorBaseline.value = c
    } else {
      editorText.value = ''
      editorBaseline.value = ''
    }
  },
)

watch(
  () => [rawUrl.value, meta.value?.kind],
  () => {
    if (meta.value?.kind !== 'audio') return
    audio.resetAudio(audioRef.value)
  },
)

watch(selectedRel, () => { mdShowPreview.value = false; htmlShowPreview.value = false; editorSelection.value = null })

watch(
  () => [props.visible, props.paneId, props.embedded],
  () => {
    if (props.visible && props.paneId) void boot()
  },
  { immediate: true },
)

// --- Lifecycle ---
const { startDrag } = usePaneResize('.file-workspace', layout.direction)

onMounted(() => {
  window.addEventListener('resize', layout.onResize)
  window.addEventListener('keydown', onEditorSaveKeydown, true)
  window.addEventListener('scroll', onCloseContextScroll, true)
  void getApiBase()
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', layout.onResize)
  window.removeEventListener('keydown', onEditorSaveKeydown, true)
  window.removeEventListener('scroll', onCloseContextScroll, true)
  fileWatch.disconnectTreeWatchSocket()
})

defineExpose({
  openFromTerminal,
  reloadAll,
  triggerUpload,
  downloadSelected,
  deleteSelected,
  startNewFile,
  startNewFolder,
  saveEditor,
  openDrawer: layout.openDrawer,
  toggleDrawer: layout.toggleDrawer,
  drawerOpen: layout.drawerOpen,
  canGoBack: nav.canGoBack,
  canGoForward: nav.canGoForward,
  goBack: doGoBack,
  goForward: doGoForward,
})
</script>

<style scoped>
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  border: 0;
}

.file-workspace-embedded {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  min-height: 0;
  height: 100%;
  overflow: hidden;
}

.file-workspace {
  display: flex;
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.file-workspace.horizontal {
  flex-direction: row;
  height: 100%;
}

.file-workspace.vertical {
  flex-direction: column;
  width: 100%;
}

.file-workspace-divider {
  flex-shrink: 0;
  background: var(--border, #333);
  z-index: 2;
}

.file-workspace.horizontal .file-workspace-divider {
  width: 6px;
  cursor: col-resize;
}

.file-workspace.vertical .file-workspace-divider {
  height: 6px;
  cursor: row-resize;
}

.file-workspace-panel {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.file-workspace-toolbar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  background: var(--tab-bg, #252525);
  border-bottom: 1px solid var(--border, #333);
  flex-shrink: 0;
}

.file-workspace-toolbar button {
  background: none;
  border: none;
  color: var(--fg-muted, #888);
  font-size: 14px;
  padding: 2px 6px;
  border-radius: 3px;
  cursor: pointer;
}

.file-workspace-toolbar button:hover:not(:disabled) {
  color: var(--fg, #ccc);
  background: var(--tab-hover-bg, #333);
}

.file-workspace-toolbar button:disabled {
  opacity: 0.35;
  cursor: default;
}

.file-workspace-add-menu { position: relative; }
.file-workspace-add-backdrop { position: fixed; inset: 0; z-index: 199; }
.file-workspace-add-dropdown {
  position: absolute;
  top: calc(100% + 4px);
  left: 50%;
  transform: translateX(-50%);
  min-width: 120px;
  background: var(--bg-surface, #1A1A1A);
  border: 1px solid var(--border, #333);
  border-radius: 6px;
  box-shadow: 0 8px 24px rgba(0,0,0,0.4);
  z-index: 200;
  padding: 4px 0;
  display: flex;
  flex-direction: column;
}
.file-workspace-add-dropdown button {
  padding: 8px 16px;
  font-size: 13px;
  color: var(--fg, #C7C7C7);
  text-align: left;
  white-space: nowrap;
  border-radius: 0;
}
.file-workspace-add-dropdown button:hover { background: rgba(255,255,255,0.06); }

.file-workspace-cwd {
  flex: 1;
  min-width: 0;
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--fg-muted, #888);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.file-workspace-body {
  flex: 1;
  display: flex;
  min-height: 0;
  min-width: 0;
  overflow: hidden;
  position: relative;
}

.file-workspace-drop-overlay {
  position: absolute;
  inset: 0;
  z-index: 300;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(59, 130, 246, 0.12);
  border: 2px dashed rgba(59, 130, 246, 0.5);
  border-radius: 6px;
  font-size: 14px;
  color: var(--fg, #C7C7C7);
  pointer-events: none;
}

.file-workspace-tree-wrap {
  min-width: 120px;
  overflow: auto;
  flex-shrink: 0;
  background: var(--bg, #1a1a1a);
}

.file-workspace-tree-splitter {
  flex-shrink: 0;
  width: 5px;
  cursor: col-resize;
  background: var(--border, #333);
  align-self: stretch;
  transition: background 0.12s;
}

.file-workspace-tree-splitter:hover { background: var(--accent, #89b4fa); }

.file-workspace-tree-reveal {
  flex-shrink: 0;
  width: 22px;
  align-self: stretch;
  border: none;
  border-right: 1px solid var(--border, #333);
  background: var(--bg, #1a1a1a);
  color: var(--fg-muted, #888);
  cursor: pointer;
  font-size: 11px;
  padding: 0;
  line-height: 1;
}

.file-workspace-tree-reveal:hover {
  color: var(--accent, #89b4fa);
  background: var(--tab-hover-bg, #333);
}

.file-workspace-tree-wrap.narrow {
  border-right: 1px solid var(--border, #333);
}

.file-workspace-body { position: relative; }

</style>

<style>
@import '../../styles/tree-rows.css';

.tree-ctx-backdrop {
  position: fixed;
  inset: 0;
  z-index: 100000;
  background: transparent;
}

.tree-ctx-menu {
  position: fixed;
  z-index: 100001;
  min-width: 216px;
  max-width: 320px;
  padding: 4px 0;
  margin: 0;
  border-radius: 6px;
  background: #252526;
  border: 1px solid #3c3c3c;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
  font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
}

.tree-ctx-menu--bottom {
  left: 0 !important;
  right: 0 !important;
  bottom: 0 !important;
  top: auto !important;
  min-width: 0;
  max-width: none;
  border-radius: 12px 12px 0 0;
  padding: 8px 0;
  padding-bottom: calc(8px + env(safe-area-inset-bottom));
}

.tree-ctx-menu--bottom .tree-ctx-item { padding: 12px 16px; font-size: 15px; }

.tree-ctx-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  width: 100%;
  box-sizing: border-box;
  margin: 0;
  padding: 5px 14px;
  border: none;
  background: transparent;
  color: #cccccc;
  font-size: 13px;
  line-height: 1.35;
  text-align: left;
  cursor: pointer;
}

.tree-ctx-item:hover,
.tree-ctx-item:focus-visible { background: #094771; color: #ffffff; outline: none; }
.tree-ctx-item-danger:hover,
.tree-ctx-item-danger:focus-visible { background: #5a1d1d; color: #ffcccc; }
.tree-ctx-label { flex: 1; min-width: 0; }
.tree-ctx-kbd { flex-shrink: 0; font-size: 11px; color: #888; font-variant-numeric: tabular-nums; }
.tree-ctx-item:hover .tree-ctx-kbd,
.tree-ctx-item:focus-visible .tree-ctx-kbd { color: rgba(255, 255, 255, 0.75); }
.tree-ctx-sep { height: 1px; margin: 4px 0; background: #3c3c3c; border: none; padding: 0; }
</style>
