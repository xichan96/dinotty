<template>
  <div v-if="visible && embedded" class="file-workspace-embedded">
    <input ref="ops.fileInputRef" type="file" multiple class="sr-only" @change="ops.onFilePick" />
    <div ref="fileWorkspaceBodyRef" class="file-workspace-body" :class="{ embedded }"
      @dragover.prevent
      @dragenter.prevent="ops.onWorkspaceDragEnter()"
      @dragleave="ops.onWorkspaceDragLeave()"
      @drop.prevent="ops.onWorkspaceDrop($event)"
    >
      <div v-if="ops.dragging.value" class="file-workspace-drop-overlay">{{ t('filePreview.dropHint') }}</div>
      <div
        v-if="!treeCollapsed"
        class="file-workspace-tree-wrap"
        :class="{ narrow: layout.narrow.value }"
        :style="layout.treeWrapStyle.value"
      >
        <div class="file-workspace-tree tree-host" @click.stop @pointerdown.capture="bumpTreePointerTs" @contextmenu.prevent="ctxMenu.onTreeBgContextMenu">
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
            @context-menu="ctxMenu.onTreeContextMenu"
            @long-press="ctxMenu.onTreeLongPress"
            @move-entry="ctxMenu.onMoveEntry"
            @swipe-action="onSwipeAction"
            @upload-to-dir="onUploadToDir"
            :on-dir-drag-enter="ops.setHoveredDir"
            :on-dir-drag-leave="ops.clearHoveredDir"
          />
        </div>
      </div>
      <div
        v-if="!treeCollapsed"
        class="file-workspace-tree-splitter"
        @mousedown.prevent="(e) => layout.startTreeWidthDrag(e, fileWorkspaceBodyRef)"
        @touchstart.prevent="(e) => layout.startTreeWidthDragTouch(e, fileWorkspaceBodyRef)"
      ></div>
      <div class="file-workspace-preview-wrap">
        <button
          type="button"
          class="tree-collapse-btn"
          :title="treeCollapsed ? t('previewPanel.expandTree') : t('previewPanel.collapseTree')"
          @click="treeCollapsed = !treeCollapsed"
        >
          <component :is="treeCollapsed ? PanelLeftOpen : PanelLeftClose" :size="12" />
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
          :raw-url="ops.rawUrl.value"
          :show-save="false"
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
          @audio-time-update="audio.onAudioTimeUpdate(audioRef)"
          @audio-loaded-metadata="audio.onAudioLoadedMetadata(audioRef)"
          @audio-ended="audio.onAudioEnded()"
          @audio-seek-input="(ev) => audio.onAudioSeekInput(audioRef, ev)"
          @seek-audio="(d) => audio.seekAudio(audioRef, d)"
          @toggle-audio="audio.toggleAudio(audioRef)"
          @audio-volume-input="(ev) => audio.onAudioVolumeInput(audioRef, ev)"
          @update:md-show-preview="editor.mdShowPreview.value = $event"
          @update:html-show-preview="editor.htmlShowPreview.value = $event"
          @update:editor-text="editor.editorText.value = $event"
          @save-editor="editor.saveEditor"
          @selection-change="editor.onEditorSelectionChange"
        />
      </div>
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
        <button type="button" :disabled="!nav.canGoBack.value" @click="doGoBack" title="Back">←</button>
        <button type="button" :disabled="!nav.canGoForward.value" @click="doGoForward" title="Forward">→</button>
        <button type="button" @click="reloadAll" title="Refresh">↻</button>
        <div class="file-workspace-cwd-wrap">
          <span class="file-workspace-cwd" :title="cwdLabel" @click="recentDropdownOpen = !recentDropdownOpen">{{ cwdShort }}</span>
          <div v-if="recentDropdownOpen" class="file-workspace-cwd-backdrop" @click="recentDropdownOpen = false"></div>
          <FileRecentDropdown
            :visible="recentDropdownOpen"
            @select="onRecentSelect"
            @close="recentDropdownOpen = false"
          />
        </div>
        <button
          type="button"
          :class="{ 'star-active': isSelectedBookmarked }"
          :disabled="!selectedRel || selectedIsDir"
          :title="isSelectedBookmarked ? t('fileBookmark.removeFrom') : t('fileBookmark.addTo')"
          @click="onToggleBookmark"
        >
          <Star :size="14" :fill="isSelectedBookmarked ? 'currentColor' : 'none'" />
        </button>
        <div class="file-workspace-add-menu">
          <button type="button" @click="ctxMenu.addMenuOpen.value = !ctxMenu.addMenuOpen.value" title="New">+</button>
          <div v-if="ctxMenu.addMenuOpen.value" class="file-workspace-add-backdrop" @click="ctxMenu.addMenuOpen.value = false"></div>
          <div v-if="ctxMenu.addMenuOpen.value" class="file-workspace-add-dropdown">
            <button type="button" @click="ctxMenu.addMenuOpen.value = false; startNewFile()">{{ t('filePreview.ctxNewFile') }}</button>
            <button type="button" @click="ctxMenu.addMenuOpen.value = false; startNewFolder()">{{ t('filePreview.ctxNewFolder') }}</button>
          </div>
        </div>
        <button type="button" @click="close" title="Close">✕</button>
      </div>
      <input ref="ops.fileInputRef" type="file" multiple class="sr-only" @change="ops.onFilePick" />
      <div ref="fileWorkspaceBodyRef" class="file-workspace-body"
        @dragover.prevent
        @dragenter.prevent="ops.dragCounter.value++"
        @dragleave="ops.dragCounter.value = Math.max(0, ops.dragCounter.value - 1)"
        @drop.prevent="ops.dragCounter.value = 0; ops.onDrop($event)"
      >
        <div v-if="ops.dragging.value" class="file-workspace-drop-overlay">{{ t('filePreview.dropHint') }}</div>
        <div
          v-if="!treeCollapsed"
          class="file-workspace-tree-wrap"
          :class="{ narrow: layout.narrow.value }"
          :style="layout.treeWrapStyle.value"
        >
          <div class="file-workspace-tree tree-host" @click.stop @pointerdown.capture="bumpTreePointerTs" @contextmenu.prevent="ctxMenu.onTreeBgContextMenu">
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
              @context-menu="ctxMenu.onTreeContextMenu"
              @long-press="ctxMenu.onTreeLongPress"
              @move-entry="ctxMenu.onMoveEntry"
              @swipe-action="onSwipeAction"
              @upload-to-dir="onUploadToDir"
              :on-dir-drag-enter="ops.setHoveredDir"
              :on-dir-drag-leave="ops.clearHoveredDir"
            />
          </div>
        </div>
        <div
          v-if="!treeCollapsed"
          class="file-workspace-tree-splitter"
          @mousedown.prevent="(e) => layout.startTreeWidthDrag(e, fileWorkspaceBodyRef)"
          @touchstart.prevent="(e) => layout.startTreeWidthDragTouch(e, fileWorkspaceBodyRef)"
        ></div>
          <div class="file-workspace-preview-wrap">
            <button
              type="button"
              class="tree-collapse-btn"
              :title="treeCollapsed ? t('previewPanel.expandTree') : t('previewPanel.collapseTree')"
              @click="treeCollapsed = !treeCollapsed"
            >
              <component :is="treeCollapsed ? PanelLeftOpen : PanelLeftClose" :size="12" />
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
              :raw-url="ops.rawUrl.value"
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
              @audio-time-update="audio.onAudioTimeUpdate(audioRef)"
              @audio-loaded-metadata="audio.onAudioLoadedMetadata(audioRef)"
              @audio-ended="audio.onAudioEnded()"
              @audio-seek-input="(ev) => audio.onAudioSeekInput(audioRef, ev)"
              @seek-audio="(d) => audio.seekAudio(audioRef, d)"
              @toggle-audio="audio.toggleAudio(audioRef)"
              @audio-volume-input="(ev) => audio.onAudioVolumeInput(audioRef, ev)"
              @update:md-show-preview="editor.mdShowPreview.value = $event"
              @update:html-show-preview="editor.htmlShowPreview.value = $event"
              @save-editor="editor.saveEditor"
              @update:editor-text="editor.editorText.value = $event"
              @selection-change="editor.onEditorSelectionChange"
            />
          </div>
      </div>
    </div>
  </div>
  <Teleport to="body">
    <div
      v-if="ctxMenu.contextMenu.value && visible"
      class="tree-ctx-backdrop"
      @mousedown="ctxMenu.closeContextMenu"
      @touchstart="ctxMenu.closeContextMenu"
    ></div>
    <div
      v-if="ctxMenu.contextMenu.value && visible"
      class="tree-ctx-menu"
      :class="{ 'tree-ctx-menu--bottom': layout.narrow.value }"
      role="menu"
      :style="ctxMenu.contextMenuStyle.value"
      @mousedown.stop
      @touchstart.stop
    >
      <button type="button" class="tree-ctx-item" role="menuitem" @click="ctxMenu.ctxNewFile">
        <span class="tree-ctx-label">{{ t('filePreview.ctxNewFile') }}</span>
      </button>
      <button type="button" class="tree-ctx-item" role="menuitem" @click="ctxMenu.ctxNewFolder">
        <span class="tree-ctx-label">{{ t('filePreview.ctxNewFolder') }}</span>
      </button>
      <template v-if="ctxMenu.contextMenu.value?.rel || selectedRel">
        <div class="tree-ctx-sep" />
        <button
          type="button"
          class="tree-ctx-item"
          role="menuitem"
          :disabled="!ctxMenu.contextMenu.value?.rel && !selectedRel"
          @click="ctxMenu.ctxRename"
        >
          <span class="tree-ctx-label">{{ t('filePreview.ctxRename') }}</span>
          <span class="tree-ctx-kbd">F2</span>
        </button>
        <div class="tree-ctx-sep" />
        <button
          type="button"
          class="tree-ctx-item"
          role="menuitem"
          @click="ctxMenu.ctxCopyPath"
        >
          <span class="tree-ctx-label">{{ t('filePreview.ctxCopyPath') }}</span>
        </button>
        <button
          type="button"
          class="tree-ctx-item"
          role="menuitem"
          @click="ctxMenu.ctxInsertToTerminal"
        >
          <span class="tree-ctx-label">{{ t('filePreview.ctxInsertToTerminal') }}</span>
        </button>
        <button
          type="button"
          class="tree-ctx-item"
          role="menuitem"
          @click="ctxMenu.ctxUpload"
        >
          <span class="tree-ctx-label">{{ t('filePreview.ctxUpload') }}</span>
        </button>
        <button
          v-if="!ctxMenu.contextMenu.value?.isDir"
          type="button"
          class="tree-ctx-item"
          role="menuitem"
          @click="ctxMenu.ctxDownload"
        >
          <span class="tree-ctx-label">{{ t('filePreview.ctxDownload') }}</span>
        </button>
        <button
          type="button"
          class="tree-ctx-item"
          role="menuitem"
          @click="ctxToggleBookmark"
        >
          <span class="tree-ctx-label">{{ ctxIsBookmarked ? t('fileBookmark.removeFrom') : t('fileBookmark.addTo') }}</span>
        </button>
        <div class="tree-ctx-sep" />
        <button
          type="button"
          class="tree-ctx-item tree-ctx-item-danger"
          role="menuitem"
          :disabled="!ctxMenu.contextMenu.value?.rel && !selectedRel"
          @click="ctxMenu.ctxDelete"
        >
          <span class="tree-ctx-label">{{ t('filePreview.ctxDelete') }}</span>
          <span class="tree-ctx-kbd">{{ ctxMenu.ctxDeleteKeyHint.value }}</span>
        </button>
      </template>
    </div>
  </Teleport>
  <ConfirmModal
    :visible="!!ctxMenu.moveConfirm.value"
    :title="t('filePreview.moveTitle')"
    :message="t('filePreview.moveConfirmMsg')"
    :target="ctxMenu.moveConfirm.value ? (ctxMenu.moveConfirm.value.destDir || t('filePreview.moveToRoot')) : ''"
    :confirm-text="t('filePreview.moveTitle')"
    :cancel-text="t('filePreview.cancel')"
    @confirm="ctxMenu.onMoveConfirm"
    @cancel="ctxMenu.onMoveCancel"
  />
  <SelectionToolbar
    :selected-text="editor.editorSelection.value?.text ?? ''"
    :anchor-rect="editor.editorSelection.value?.rect ?? null"
    @dismiss="editor.onSelectionDismiss"
  />
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { useI18n } from '../../composables/useI18n'
import { getApiBase, apiUrl, authFetch } from '../../composables/apiBase'
import { isTauri } from '../../composables/useTransport'
import { copyToClipboard } from '../../utils/clipboard'
import { usePaneResize } from '../../composables/usePaneResize'
import { useFileNavigation, useSelectedPath } from '../../composables/useFileNavigation'
import { useAudioPlayer } from '../../composables/useAudioPlayer'
import { useFileWorkspaceLayout } from '../../composables/useFileWorkspaceLayout'
import { useFileWatch } from '../../composables/useFileWatch'
import { useFileEditor } from '../../composables/useFileEditor'
import { useOfficePreview } from '../../composables/useOfficePreview'
import { useFileOperations } from '../../composables/useFileOperations'
import { useTreeContextMenu } from '../../composables/useTreeContextMenu'
import { TreeRows } from '../workspace/TreeRows'
import type { DirEntry } from '../workspace/TreeRows'
import FilePreviewContent from '../workspace/FilePreviewContent.vue'
import SelectionToolbar from '../workspace/SelectionToolbar.vue'
import ConfirmModal from '../ui/ConfirmModal.vue'
import { useRecentFiles } from '../../composables/useRecentAccess'
import { useWorkspaceBookmarks } from '../../composables/useWorkspaceBookmarks'
import FileRecentDropdown from '../workspace/FileRecentDropdown.vue'
import { Star, PanelLeftClose, PanelLeftOpen } from 'lucide-vue-next'

const props = withDefaults(
  defineProps<{ visible: boolean; paneId: string; embedded?: boolean }>(),
  { embedded: false },
)
const treeCollapsed = defineModel<boolean>('treeCollapsed', { default: false })
const emit = defineEmits<{ close: []; navigate: [path: string]; 'update:canGoBack': [v: boolean]; 'update:canGoForward': [v: boolean] }>()

const { t } = useI18n()

// --- Shared state ---
const cwdLabel = ref('')
const childCache = ref<Record<string, DirEntry[]>>({})
const expanded = ref<Set<string>>(new Set())
const selectedRel = ref<string | null>(null)
const selectedIsDir = ref(false)
const meta = ref<any | null>(null)
const previewLoading = ref(false)
const previewErr = ref('')
const lastTreePointerTs = ref(0)
const gitStatusMap = ref<Record<string, string>>({})
const inlineCreate = ref<{ parentRel: string; kind: 'file' | 'dir' } | null>(null)
const inlineRename = ref<{ rel: string; isDir: boolean } | null>(null)
const recentDropdownOpen = ref(false)
const fileWorkspaceBodyRef = ref<HTMLElement | null>(null)

// --- Composables ---
const nav = useFileNavigation()
const audio = useAudioPlayer()
const layout = useFileWorkspaceLayout()
const recentFiles = useRecentFiles()
const workspaceBookmarks = useWorkspaceBookmarks()

const editor = useFileEditor({
  paneId: () => props.paneId,
  selectedRel,
  selectedIsDir,
  meta,
})

const office = useOfficePreview({ paneId: () => props.paneId })

const ops = useFileOperations({
  paneId: () => props.paneId,
  selectedRel,
  selectedIsDir,
  meta,
  childCache,
  expanded,
  inlineCreate,
  cwdLabel,
  ensureChildren,
  emit: (event, path) => emit(event, path),
})

const ctxMenu = useTreeContextMenu({
  selectedRel,
  selectedIsDir,
  meta,
  editorDirty: editor.editorDirty,
  editorText: editor.editorText,
  editorBaseline: editor.editorBaseline,
  childCache,
  expanded,
  inlineCreate,
  inlineRename,
  narrow: layout.narrow,
  absolutePath: ops.absolutePath,
  parentRelPath: ops.parentRelPath,
  ensureChildren,
  deleteSelected: ops.deleteSelected,
  onSelectFile,
  onSelectDir,
  triggerUpload: ops.triggerUpload,
  downloadFile: ops.downloadFile,
  t,
})

watch(nav.canGoBack, v => emit('update:canGoBack', v), { immediate: true })
watch(nav.canGoForward, v => emit('update:canGoForward', v), { immediate: true })

// --- File Watch ---
const fileWatch = useFileWatch({
  paneId: () => props.paneId,
  cwdLabel,
  expanded,
  childCache,
  selectedRel,
  selectedIsDir,
  meta,
  editorDirty: () => editor.editorDirty.value,
  onFileDeleted: () => {
    selectedRel.value = null
    selectedIsDir.value = false
    meta.value = null
    previewErr.value = ''
  },
  onFileChanged: (newMeta) => {
    meta.value = newMeta
    editor.editorText.value = newMeta.content ?? ''
    editor.editorBaseline.value = newMeta.content ?? ''
    fetchGitStatus()
  },
  onBinaryChanged: () => {
    ops.cacheBustTs.value = Date.now()
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

const inlineCreateForTree = computed(() => inlineCreate.value ?? undefined)

const inlineInputPlaceholder = computed(() => {
  if (!inlineCreate.value) return ''
  return inlineCreate.value.kind === 'dir' ? t('filePreview.nameFolder') : t('filePreview.nameFile')
})

const isSelectedBookmarked = computed(() => {
  if (!selectedRel.value || selectedIsDir.value) return false
  return workspaceBookmarks.isBookmarked(ops.absolutePath(selectedRel.value))
})

function onToggleBookmark() {
  if (!selectedRel.value || selectedIsDir.value) return
  const name = selectedRel.value.split('/').pop() || selectedRel.value
  workspaceBookmarks.toggleBookmark(name, ops.absolutePath(selectedRel.value), false)
}

const ctxIsBookmarked = computed(() => {
  const rel = ctxMenu.contextMenu.value?.rel || selectedRel.value
  if (!rel) return false
  return workspaceBookmarks.isBookmarked(ops.absolutePath(rel))
})

function ctxToggleBookmark() {
  if (!ctxMenu.contextMenu.value) return
  const { rel, isDir } = ctxMenu.contextMenu.value
  ctxMenu.closeContextMenu()
  const targetRel = rel || selectedRel.value
  if (!targetRel) return
  const name = targetRel.split('/').pop() || targetRel
  workspaceBookmarks.toggleBookmark(name, ops.absolutePath(targetRel), isDir)
}

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
  if (!editor.editorDirty.value || !meta.value || (meta.value.kind !== 'text' && meta.value.kind !== 'markdown')) return false
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

const { selectedPath: globalSelectedPath } = useSelectedPath()

function onSelectDir(rel: string) {
  selectedRel.value = rel
  selectedIsDir.value = true
  meta.value = null
  previewErr.value = ''
  nav.pushNav(rel, true)
  globalSelectedPath.value = ops.absolutePath(rel)
  emit('navigate', ops.absolutePath(rel))
}

async function onSelectFile(rel: string) {
  selectedRel.value = rel
  selectedIsDir.value = false
  previewErr.value = ''
  previewLoading.value = true
  meta.value = null
  office.officeLoading.value = false
  office.officeErr.value = ''
  office.officeHtml.value = ''
  nav.pushNav(rel, false)
  globalSelectedPath.value = ops.absolutePath(rel)
  emit('navigate', ops.absolutePath(rel))
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
    if (meta.value) {
      recentFiles.recordFile(ops.absolutePath(rel), rel.split('/').pop() || rel)
    }
    if (meta.value?.kind === 'office') void office.loadOfficePreview(rel)
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
  if (!selectedIsDir.value && selectedRel.value) return ops.parentRelPath(selectedRel.value)
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
  const parentRel = ops.parentRelPath(rel)
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

async function onUploadToDir(dir: string, ev: DragEvent) {
  if (isTauri()) return // handled by file-drop-paths listener
  const items = ev.dataTransfer?.items
  if (!items) return
  const allFiles: { file: File; path: string }[] = []
  const promises: Promise<void>[] = []
  for (let i = 0; i < items.length; i++) {
    const entry = items[i].webkitGetAsEntry?.()
    if (entry) promises.push(ops.traverseEntry(entry, '').then(files => { allFiles.push(...files) }))
  }
  try { await Promise.all(promises) } catch {}
  if (!allFiles.length) return
  await ops.uploadFiles(allFiles, dir)
}

function onSwipeAction(payload: { rel: string; action: string }) {
  const { rel, action } = payload
  const absPath = ops.absolutePath(rel)
  if (action === 'copy-path') {
    void copyToClipboard(absPath)
  } else if (action === 'insert-to-terminal') {
    window.dispatchEvent(new CustomEvent('terminal-insert-path', {
      detail: { path: absPath },
    }))
  }
}

// --- Reload/Boot ---
async function reloadAll() {
  inlineCreate.value = null
  ctxMenu.contextMenu.value = null
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
  ctxMenu.contextMenu.value = null
  childCache.value = {}
  expanded.value = new Set()
  try {
    await ensureChildren('')
    fileWatch.connectTreeWatchSocket()
    fetchGitStatus()
  } catch { previewErr.value = 'list failed' }
}

function close() { emit('close') }

function onRecentSelect(path: string) {
  recentDropdownOpen.value = false
  openFromTerminal(path)
}

// --- Open from terminal ---
async function openFromTerminal(path: string) {
  await getApiBase()
  const q = new URLSearchParams({ pane_id: props.paneId, path })
  const res = await authFetch(apiUrl(`/api/workspace/resolve?${q}`))
  if (!res.ok) return
  const { rel } = await res.json()
  previewErr.value = ''
  inlineCreate.value = null
  ctxMenu.contextMenu.value = null
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
  if (ctxMenu.contextMenu.value && e.key === 'Escape') {
    e.preventDefault()
    ctxMenu.closeContextMenu()
    return
  }
  if (!props.visible) return
  const saveChord = (e.metaKey || e.ctrlKey) && (e.code === 'KeyS' || e.key === 's' || e.key === 'S')
  if (!saveChord) return
  if (!editor.canSaveEditorContext.value) return
  e.preventDefault()
  if (editor.canSaveEditor.value) void editor.saveEditor()
}

function onCloseContextScroll() {
  if (ctxMenu.contextMenu.value) ctxMenu.contextMenu.value = null
}

// --- Watchers ---
watch(layout.narrow, (isNarrow) => {
  if (isNarrow) treeCollapsed.value = false
})

watch(
  () => [selectedRel.value, selectedIsDir.value, meta.value?.kind, meta.value?.content, meta.value?.truncated],
  () => {
    if (selectedIsDir.value || !selectedRel.value) {
      editor.editorText.value = ''
      editor.editorBaseline.value = ''
      return
    }
    const m = meta.value
    if (m?.kind === 'text' || m?.kind === 'markdown') {
      const c = m.content ?? ''
      editor.editorText.value = c
      editor.editorBaseline.value = c
    } else {
      editor.editorText.value = ''
      editor.editorBaseline.value = ''
    }
  },
)

watch(
  () => [ops.rawUrl.value, meta.value?.kind],
  () => {
    if (meta.value?.kind !== 'audio') return
    audio.resetAudio(audioRef.value)
  },
)

watch(selectedRel, () => { editor.mdShowPreview.value = false; editor.htmlShowPreview.value = false; editor.editorSelection.value = null })

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
  ops.setActiveWorkspace()
  void getApiBase()
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', layout.onResize)
  window.removeEventListener('keydown', onEditorSaveKeydown, true)
  window.removeEventListener('scroll', onCloseContextScroll, true)
  ops.clearActiveWorkspace()
  fileWatch.disconnectTreeWatchSocket()
})

defineExpose({
  openFromTerminal,
  reloadAll,
  deleteSelected: ops.deleteSelected,
  startNewFile,
  startNewFolder,
  saveEditor: editor.saveEditor,
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
  cursor: pointer;
}

.file-workspace-cwd:hover {
  color: var(--fg, #ccc);
}

.file-workspace-cwd-wrap {
  flex: 1;
  min-width: 0;
  position: relative;
}

.file-workspace-cwd-backdrop {
  position: fixed;
  inset: 0;
  z-index: 499;
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

.file-workspace-preview-wrap {
  flex: 1;
  min-width: 0;
  min-height: 0;
  position: relative;
  display: flex;
}

.tree-collapse-btn {
  position: absolute;
  top: 4px;
  left: 4px;
  z-index: 10;
  background: var(--bg, #1a1a1a);
  border: 1px solid var(--border, #333);
  color: var(--fg-muted, #888);
  cursor: pointer;
  padding: 2px;
  border-radius: 3px;
  display: inline-flex;
  align-items: center;
}
.tree-collapse-btn:hover {
  color: var(--fg, #ccc);
  background: var(--tab-hover-bg, #333);
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

.file-workspace-tree-wrap.narrow {
  border-right: 1px solid var(--border, #333);
}

.star-active {
  color: var(--accent, #89b4fa) !important;
}

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
