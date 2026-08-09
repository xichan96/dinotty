<template>
  <div
    v-if="visible"
    class="file-workspace"
    :class="inLeaf ? ['in-leaf'] : [layout.direction.value]"
  >
    <div
      v-if="!inLeaf"
      class="file-workspace-divider"
      @mousedown.prevent="startDrag"
      @touchstart.prevent="startDrag"
    ></div>
    <div class="file-workspace-panel">
      <div class="file-workspace-toolbar">
        <button type="button" :disabled="!nav.canGoBack.value" @click="doGoBack" title="Back">
          ←
        </button>
        <button
          type="button"
          :disabled="!nav.canGoForward.value"
          @click="doGoForward"
          title="Forward"
        >
          →
        </button>
        <button type="button" @click="reloadAll" title="Refresh">↻</button>
        <div class="file-workspace-cwd-wrap">
          <span
            class="file-workspace-cwd"
            :title="cwdLabel"
            @click="recentDropdownOpen = !recentDropdownOpen"
            >{{ cwdShort }}</span
          >
          <div
            v-if="recentDropdownOpen"
            class="file-workspace-cwd-backdrop"
            @click="recentDropdownOpen = false"
          ></div>
          <FileRecentDropdown
            :visible="recentDropdownOpen"
            @select="onRecentSelect"
            @close="recentDropdownOpen = false"
          />
        </div>
        <button v-if="!inLeaf" type="button" @click="close" title="Close">✕</button>
      </div>
      <input ref="ops.fileInputRef" type="file" multiple class="sr-only" @change="ops.onFilePick" />
      <div
        ref="fileWorkspaceBodyRef"
        class="file-workspace-body"
        @dragover.prevent
        @dragenter.prevent="onWorkspaceDragEnter($event)"
        @dragleave="ops.onWorkspaceDragLeave()"
        @drop.prevent="onWorkspaceDrop($event)"
      >
        <div v-if="ops.dragging.value" class="file-workspace-drop-overlay">
          {{ t('filePreview.dropHint') }}
        </div>
        <div
          v-if="!treeCollapsed"
          class="file-workspace-tree-wrap"
          :class="{ narrow: layout.narrow.value }"
          :style="layout.treeWrapStyle.value"
        >
          <div
            class="file-workspace-tree tree-host"
            @click.stop
            @pointerdown.capture="bumpTreePointerTs"
            @contextmenu.prevent="ctxMenu.onTreeBgContextMenu"
          >
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
          <EditorSplitContainer
            :layout="editorSplit.editorLayout.value"
            :active-leaf-id="editorSplit.activeEditorLeafId.value"
            :pane-id="apiPaneId"
            :show-header="editorSplit.isSplit.value"
            @focus="(id: string) => editorSplit.focusEditorPane(id)"
            @close="(id: string) => editorSplit.closeEditorPane(id)"
            @file-drop="onEditorFileDrop"
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
          v-if="!ctxMenu.contextMenu.value?.isDir"
          type="button"
          class="tree-ctx-item"
          role="menuitem"
          @click="ctxOpenToSide"
        >
          <span class="tree-ctx-label">{{ t('filePreview.ctxOpenToSide') }}</span>
        </button>
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
        <button type="button" class="tree-ctx-item" role="menuitem" @click="ctxMenu.ctxCopyPath">
          <span class="tree-ctx-label">{{ t('filePreview.ctxCopyPath') }}</span>
        </button>
        <button
          type="button"
          class="tree-ctx-item"
          role="menuitem"
          :disabled="!ctxMenu.contextMenu.value?.rel && !selectedRel"
          @click="ctxMenu.ctxReveal"
        >
          <span class="tree-ctx-label">{{ t('filePreview.ctxReveal') }}</span>
        </button>
        <button
          v-if="ctxMenu.canRunCode.value"
          type="button"
          class="tree-ctx-item"
          data-testid="tree-context-run-code"
          role="menuitem"
          @click="ctxMenu.ctxRunCode"
        >
          <span class="tree-ctx-label">{{ t('filePreview.ctxRunCode') }}</span>
        </button>
        <button
          type="button"
          class="tree-ctx-item"
          role="menuitem"
          @click="ctxMenu.ctxInsertToTerminal"
        >
          <span class="tree-ctx-label">{{ t('filePreview.ctxInsertToTerminal') }}</span>
        </button>
        <button type="button" class="tree-ctx-item" role="menuitem" @click="ctxMenu.ctxUpload">
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
        <button type="button" class="tree-ctx-item" role="menuitem" @click="ctxToggleBookmark">
          <span class="tree-ctx-label">{{
            ctxIsBookmarked ? t('fileBookmark.removeFrom') : t('fileBookmark.addTo')
          }}</span>
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
    :target="
      ctxMenu.moveConfirm.value
        ? ctxMenu.moveConfirm.value.destDir || t('filePreview.moveToRoot')
        : ''
    "
    :confirm-text="t('filePreview.moveTitle')"
    :cancel-text="t('filePreview.cancel')"
    @confirm="ctxMenu.onMoveConfirm"
    @cancel="ctxMenu.onMoveCancel"
  />
  <ConfirmModal
    :visible="!!ctxMenu.deleteConfirm.value"
    :title="t('filePreview.ctxDelete')"
    :message="deleteConfirmMessage"
    :confirm-text="t('filePreview.ctxDelete')"
    :cancel-text="t('filePreview.cancel')"
    @confirm="ctxMenu.executeDelete"
    @cancel="ctxMenu.cancelDelete"
  />
  <SelectionToolbar
    :selected-text="''"
    :anchor-rect="null"
    @dismiss="() => {}"
  />
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick, toRef } from 'vue'
import { useI18n } from '../../composables/useI18n'
import { getApiBase, apiUrl, authFetch } from '../../composables/apiBase'
import { isTauri } from '../../composables/useTransport'
import { copyToClipboard } from '../../utils/clipboard'
import { usePaneResize } from '../../composables/usePaneResize'
import { useFileNavigation, useSelectedPath } from '../../composables/useFileNavigation'
import { useFileWorkspaceLayout } from '../../composables/useFileWorkspaceLayout'
import { useFileWatch } from '../../composables/useFileWatch'
import { useEditorSplit } from '../../composables/useEditorSplit'
import { setActiveLeaf } from '../../composables/useEditorRegistry'
import {
  saveFileWorkspaceState,
  type PersistedFileWorkspaceState,
} from '../../composables/useFileWorkspaceState'
import { setEditorSplitForCursorGroup } from '../../composables/useCursorGroup'
import { useFileOperations } from '../../composables/useFileOperations'
import type { DropPosition } from '../../types/pane'
import { useTreeContextMenu } from '../../composables/useTreeContextMenu'
import { useInlineCreateRename } from '../../composables/useInlineCreateRename'
import { useFileWorkspaceBoot } from '../../composables/useFileWorkspaceBoot'
import { TreeRows } from '../workspace/TreeRows'
import type { DirEntry } from '../workspace/TreeRows'
import EditorSplitContainer from '../workspace/EditorSplitContainer.vue'
import SelectionToolbar from '../workspace/SelectionToolbar.vue'
import ConfirmModal from '../ui/ConfirmModal.vue'
import { useRecentFiles } from '../../composables/useRecentAccess'
import { useWorkspaceBookmarks } from '../../composables/useWorkspaceBookmarks'
import FileRecentDropdown from '../workspace/FileRecentDropdown.vue'
import { PanelLeftClose, PanelLeftOpen } from 'lucide-vue-next'

const props = withDefaults(
  defineProps<{
    visible: boolean
    paneId: string
    inLeaf?: boolean
    shellType?: string
    initialPath?: string
    sourcePaneId?: string
  }>(),
  { inLeaf: true }
)
const treeCollapsed = defineModel<boolean>('treeCollapsed', { default: false })
const emit = defineEmits<{
  close: []
  navigate: [path: string]
  'update:canGoBack': [v: boolean]
  'update:canGoForward': [v: boolean]
}>()

const { t } = useI18n()

// Terminal paneId that owns this leaf; needed for workspace API calls
// (list/cwd/git-status) which look up the PTY session. Falls back to the
// leaf's own paneId for legacy leaves without sourcePaneId.
const apiPaneId = computed(() => props.sourcePaneId || props.paneId)

// --- Shared state ---
const cwdLabel = ref('')
const childCache = ref<Record<string, DirEntry[]>>({})
const expanded = ref<Set<string>>(new Set())
const lastTreePointerTs = ref(0)
const gitStatusMap = ref<Record<string, string>>({})
const recentDropdownOpen = ref(false)
const fileWorkspaceBodyRef = ref<HTMLElement | null>(null)

// --- Composables ---
const nav = useFileNavigation()
const layout = useFileWorkspaceLayout()
const recentFiles = useRecentFiles()
const workspaceBookmarks = useWorkspaceBookmarks()
const editorSplit = useEditorSplit({ paneId: () => apiPaneId.value })

// Derived from active editor pane — keeps tree highlight and context menu working
const selectedRel = ref<string | null>(null)
const selectedIsDir = ref(false)
const meta = ref<any | null>(null)
const previewErr = ref('')

// Keep selectedRel in sync with active editor pane. When focus moves to a
// different pane (or the displayed file is deleted), the tree highlight
// follows the active leaf and selectedIsDir resets - clicking a directory
// only sets selectedIsDir temporarily until focus shifts.
watch(
  () => editorSplit.activeLeaf.value?.filePath,
  (fp) => {
    selectedRel.value = fp ?? null
    selectedIsDir.value = false
  }
)
watch(
  () => editorSplit.activeEditorLeafId.value,
  () => { setActiveLeaf(editorSplit.activeEditorLeafId.value ?? null) },
  { immediate: true }
)

// Forward declaration: ops is declared below, but parentRelPath wraps it.
// Function declarations are hoisted; ops will be defined by the time this is called.
function parentRelPath(rel: string): string {
  return ops.parentRelPath(rel)
}

const {
  inlineCreate,
  inlineRename,
  startNewFile,
  startNewFolder,
  onInlineCreateCommit,
  onInlineCreateCancel,
  onInlineRenameCommit,
  onInlineRenameCancel,
} = useInlineCreateRename({
  paneId: apiPaneId,
  cwdLabel,
  selectedRel,
  selectedIsDir,
  childCache,
  expanded,
  previewErr,
  parentRelPath,
  ensureChildren,
  onSelectFile,
  onSelectDir,
})

const ops = useFileOperations({
  paneId: () => apiPaneId.value,
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
  editorDirty: ref(false),
  editorText: ref(''),
  editorBaseline: ref(''),
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
  paneId: () => apiPaneId.value,
  t,
})

watch(nav.canGoBack, (v) => emit('update:canGoBack', v), { immediate: true })
watch(nav.canGoForward, (v) => emit('update:canGoForward', v), { immediate: true })

// --- File Watch ---
// File watch tracks the file currently displayed in the active editor pane,
// not the tree selection - so clicking a directory doesn't stop the right
// pane from refreshing when the displayed file changes on disk.
const displayedFileRel = computed(() => editorSplit.activeLeaf.value?.filePath ?? null)
const displayedFileIsDir = computed(() => editorSplit.activeLeaf.value?.isDir ?? false)
const fileWatch = useFileWatch({
  paneId: () => apiPaneId.value,
  cwdLabel,
  expanded,
  childCache,
  selectedRel: displayedFileRel,
  selectedIsDir: displayedFileIsDir,
  meta,
  editorDirty: () => false,
  onFileDeleted: () => {
    const leaf = editorSplit.activeLeaf.value
    if (leaf) {
      leaf.filePath = null
      leaf.isDir = false
    }
    meta.value = null
  },
  onFileChanged: (newMeta) => {
    meta.value = newMeta
    fetchGitStatus()
  },
  onBinaryChanged: () => {
    ops.cacheBustTs.value = Date.now()
  },
  fetchList,
})

const {
  reloadAll,
  expandFirstLevelDirs,
  captureState,
  applyState,
  boot,
  openFromTerminal,
} = useFileWorkspaceBoot({
  paneId: toRef(props, 'paneId'),
  sourcePaneId: toRef(props, 'sourcePaneId'),
  visible: toRef(props, 'visible'),
  shellType: toRef(props, 'shellType'),
  initialPath: toRef(props, 'initialPath'),
  childCache,
  expanded,
  cwdLabel,
  previewErr,
  meta,
  selectedRel,
  selectedIsDir,
  inlineCreate,
  contextMenu: ctxMenu.contextMenu,
  editorLayout: editorSplit.editorLayout,
  activeEditorLeafId: editorSplit.activeEditorLeafId,
  activeLeaf: editorSplit.activeLeaf,
  ensureChildren,
  onSelectFile,
  onSelectDir,
  connectTreeWatchSocket: fileWatch.connectTreeWatchSocket,
  disconnectTreeWatchSocket: fileWatch.disconnectTreeWatchSocket,
  fetchGitStatus,
})

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

const ctxIsBookmarked = computed(() => {
  const rel = ctxMenu.contextMenu.value?.rel || selectedRel.value
  if (!rel) return false
  return workspaceBookmarks.isBookmarked(ops.absolutePath(rel))
})

const deleteConfirmMessage = computed(() => {
  const info = ctxMenu.deleteConfirm.value
  if (!info) return ''
  const base = info.isDir
    ? t('filePreview.confirmDeleteFolder')
    : t('filePreview.confirmDeleteFile')
  return info.discardNeeded ? `${t('filePreview.discardChanges')}\n\n${base}` : base
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

function ctxOpenToSide() {
  const rel = ctxMenu.contextMenu.value?.rel || selectedRel.value
  if (!rel) return
  ctxMenu.closeContextMenu()
  editorSplit.openFileInNewPane(rel, ctxMenu.contextMenu.value?.isDir ?? false, 'horizontal')
  recentFiles.recordFile(ops.absolutePath(rel), rel.split('/').pop() || rel)
}

function onEditorFileDrop(leafId: string, rel: string, position: DropPosition) {
  if (position === 'center') {
    editorSplit.focusEditorPane(leafId)
    onSelectFile(rel)
  } else {
    const direction = position === 'left' || position === 'right' ? 'horizontal' : 'vertical'
    editorSplit.openFileInNewPane(rel, false, direction)
    onSelectFile(rel)
  }
}

function isInternalTreeMove(ev: DragEvent): boolean {
  const t = ev.dataTransfer?.types
  if (!t) return false
  return t.includes ? t.includes('application/x-tree-move') : (t as any).contains('application/x-tree-move')
}

function onWorkspaceDragEnter(ev: DragEvent) {
  if (isInternalTreeMove(ev)) return
  ops.onWorkspaceDragEnter()
}

function onWorkspaceDrop(ev: DragEvent) {
  if (isInternalTreeMove(ev)) return
  ops.onWorkspaceDrop(ev)
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
function bumpTreePointerTs() {
  lastTreePointerTs.value = Date.now()
}

function shouldBlockNavigate(): boolean {
  return false
}

async function trySelectFile(rel: string, ev?: MouseEvent) {
  if (shouldBlockNavigate()) return
  // Cmd (macOS) / Ctrl (Windows/Linux) + Click → open in new split pane
  if (ev?.metaKey || ev?.ctrlKey) {
    editorSplit.openFileInNewPane(rel, false, 'horizontal')
    await loadMetaForActivePane(rel)
    return
  }
  await onSelectFile(rel)
}

function trySelectDir(rel: string) {
  if (shouldBlockNavigate()) return
  onSelectDir(rel)
}

const { selectedPath: globalSelectedPath } = useSelectedPath()

function onSelectDir(rel: string) {
  // Only update tree selection — keep the editor leaf showing the last opened
  // file so the right pane doesn't go blank when a directory is clicked.
  selectedRel.value = rel
  selectedIsDir.value = true
  nav.pushNav(rel, true)
  globalSelectedPath.value = ops.absolutePath(rel)
  emit('navigate', ops.absolutePath(rel))
}

async function loadMetaForActivePane(rel: string) {
  recentFiles.recordFile(ops.absolutePath(rel), rel.split('/').pop() || rel)
}

async function onSelectFile(rel: string) {
  selectedRel.value = rel
  selectedIsDir.value = false
  editorSplit.openFileInActivePane(rel, false)
  meta.value = null
  nav.pushNav(rel, false)
  globalSelectedPath.value = ops.absolutePath(rel)
  emit('navigate', ops.absolutePath(rel))
  recentFiles.recordFile(ops.absolutePath(rel), rel.split('/').pop() || rel)
}

// --- Tree data ---
async function fetchList(rel: string): Promise<DirEntry[]> {
  await getApiBase()
  const q = new URLSearchParams({ pane_id: apiPaneId.value, path: rel })
  if (cwdLabel.value) q.set('root', cwdLabel.value)
  const res = await authFetch(apiUrl(`/api/workspace/list?${q}`))
  if (!res.ok) throw new Error('list failed')
  const data = await res.json()
  cwdLabel.value = data.cwd || ''
  return data.entries || []
}

async function fetchGitStatus() {
  try {
    await getApiBase()
    const q = new URLSearchParams({ pane_id: apiPaneId.value })
    const res = await authFetch(apiUrl(`/api/workspace/git-status?${q}`))
    if (!res.ok) return
    const data = await res.json()
    if (!data.is_git_repo) {
      gitStatusMap.value = {}
      return
    }
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
// (Extracted to useInlineCreateRename composable)

async function onUploadToDir(dir: string, ev: DragEvent) {
  const items = ev.dataTransfer?.items
  if (!items) return
  const allFiles: { file: File; path: string }[] = []
  const promises: Promise<void>[] = []
  for (let i = 0; i < items.length; i++) {
    const entry = items[i].webkitGetAsEntry?.()
    if (entry)
      promises.push(
        ops.traverseEntry(entry, '').then((files) => {
          allFiles.push(...files)
        })
      )
  }
  try {
    await Promise.all(promises)
  } catch {}
  if (!allFiles.length) return
  await ops.uploadFiles(allFiles, dir)
}

function onSwipeAction(payload: { rel: string; action: string }) {
  const { rel, action } = payload
  const absPath = ops.absolutePath(rel)
  if (action === 'copy-path') {
    void copyToClipboard(absPath)
  } else if (action === 'insert-to-terminal') {
    window.dispatchEvent(
      new CustomEvent('terminal-insert-path', {
        detail: { path: absPath },
      })
    )
  }
}

// --- Reload/Boot ---
// (Extracted to useFileWorkspaceBoot composable)

function close() {
  emit('close')
}

function onRecentSelect(path: string) {
  recentDropdownOpen.value = false
  openFromTerminal(path)
}

// --- Keyboard ---
function onEditorSaveKeydown(e: KeyboardEvent) {
  if (ctxMenu.contextMenu.value && e.key === 'Escape') {
    e.preventDefault()
    ctxMenu.closeContextMenu()
    return
  }
}

function onCloseContextScroll() {
  if (ctxMenu.contextMenu.value) ctxMenu.contextMenu.value = null
}

// --- Watchers ---
watch(layout.narrow, (isNarrow) => {
  if (isNarrow) treeCollapsed.value = false
})

watch(
  () => props.paneId,
  (_newId, oldId) => {
    if (oldId) saveFileWorkspaceState(oldId, captureState())
  },
  { flush: 'sync' }
)

watch(
  () => [props.visible, props.paneId, props.inLeaf],
  () => {
    if (props.visible && props.paneId) void boot()
  },
  { immediate: true }
)

// --- Lifecycle ---
const { startDrag } = usePaneResize('.file-workspace', layout.direction)

onMounted(() => {
  window.addEventListener('resize', layout.onResize)
  window.addEventListener('keydown', onEditorSaveKeydown, true)
  window.addEventListener('scroll', onCloseContextScroll, true)
  ops.setActiveWorkspace()
  void getApiBase()
  setEditorSplitForCursorGroup(editorSplit)
})

onBeforeUnmount(() => {
  if (props.paneId) saveFileWorkspaceState(props.paneId, captureState())
  window.removeEventListener('resize', layout.onResize)
  window.removeEventListener('keydown', onEditorSaveKeydown, true)
  window.removeEventListener('scroll', onCloseContextScroll, true)
  ops.teardownWorkspaceDragDrop()
  ops.clearActiveWorkspace()
  fileWatch.disconnectTreeWatchSocket()
  setEditorSplitForCursorGroup(null)
  setActiveLeaf(null)
})

defineExpose({
  openFromTerminal,
  reloadAll,
  deleteSelected: ops.deleteSelected,
  startNewFile,
  startNewFolder,
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

.file-workspace.in-leaf {
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
  color: var(--fg, #c7c7c7);
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

.file-workspace-tree-splitter:hover {
  background: var(--accent, #89b4fa);
}

.file-workspace-tree-wrap.narrow {
  border-right: 1px solid var(--border, #333);
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
  font-family:
    system-ui,
    -apple-system,
    BlinkMacSystemFont,
    'Segoe UI',
    Roboto,
    sans-serif;
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

.tree-ctx-menu--bottom .tree-ctx-item {
  padding: 12px 16px;
  font-size: 15px;
}

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
.tree-ctx-item:focus-visible {
  background: #094771;
  color: #ffffff;
  outline: none;
}
.tree-ctx-item-danger:hover,
.tree-ctx-item-danger:focus-visible {
  background: #5a1d1d;
  color: #ffcccc;
}
.tree-ctx-label {
  flex: 1;
  min-width: 0;
}
.tree-ctx-kbd {
  flex-shrink: 0;
  font-size: 11px;
  color: #888;
  font-variant-numeric: tabular-nums;
}
.tree-ctx-item:hover .tree-ctx-kbd,
.tree-ctx-item:focus-visible .tree-ctx-kbd {
  color: rgba(255, 255, 255, 0.75);
}
.tree-ctx-sep {
  height: 1px;
  margin: 4px 0;
  background: #3c3c3c;
  border: none;
  padding: 0;
}
</style>
