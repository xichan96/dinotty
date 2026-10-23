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
        <button
          type="button"
          :disabled="!nav.canGoBack.value"
          :title="t('filePreview.back')"
          :aria-label="t('filePreview.back')"
          @click="doGoBack"
        >
          <ArrowLeft :size="12" />
        </button>
        <button
          type="button"
          :disabled="!nav.canGoForward.value"
          :title="t('filePreview.forward')"
          :aria-label="t('filePreview.forward')"
          @click="doGoForward"
        >
          <ArrowRight :size="12" />
        </button>
        <button
          type="button"
          :title="t('filePreview.refresh')"
          :aria-label="t('filePreview.refresh')"
          @click="reloadAll"
        >
          <RotateCw :size="12" />
        </button>
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
        <button
          v-if="!inLeaf"
          type="button"
          :title="t('filePreview.close')"
          :aria-label="t('filePreview.close')"
          @click="close"
        >
          <X :size="12" />
        </button>
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
          ref="treeWrapRef"
          class="file-workspace-tree-wrap"
          :class="{ narrow: layout.narrow.value }"
          :style="layout.treeWrapStyle.value"
        >
          <div class="file-workspace-tree-head">
            <span class="file-workspace-tree-title">{{ t('filePreview.explorer') }}</span>
            <div class="file-workspace-tree-actions">
              <button
                type="button"
                data-testid="tree-head-new-file"
                :title="t('filePreview.newFile')"
                :aria-label="t('filePreview.newFile')"
                @click="startNewFile"
              >
                <FilePlus :size="14" />
              </button>
              <button
                type="button"
                data-testid="tree-head-new-folder"
                :title="t('filePreview.newFolder')"
                :aria-label="t('filePreview.newFolder')"
                @click="startNewFolder"
              >
                <FolderPlus :size="14" />
              </button>
              <button
                type="button"
                data-testid="tree-head-refresh"
                :class="{ spinning: refreshBusy }"
                :title="t('filePreview.refresh')"
                :aria-label="t('filePreview.refresh')"
                @click="refreshTree"
              >
                <RotateCw :size="14" />
              </button>
              <button
                type="button"
                data-testid="tree-head-collapse-all"
                :title="t('filePreview.collapseAll')"
                :aria-label="t('filePreview.collapseAll')"
                @click="collapseAll"
              >
                <ChevronsDownUp :size="14" />
              </button>
            </div>
          </div>
          <div v-if="previewErr" class="file-workspace-error" role="alert">
            <span class="file-workspace-error-text">{{ previewErrText }}</span>
            <button
              type="button"
              class="file-workspace-error-retry"
              @click="retryPreviewErr"
            >
              {{ t('filePreview.retry') }}
            </button>
          </div>
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
            @close="onCloseEditorPane"
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
      <!-- Blank-area menu: only the three creation actions, no selection fallback. -->
      <button
        v-if="!ctxMenu.contextMenu.value?.rel"
        type="button"
        class="tree-ctx-item"
        role="menuitem"
        @click="ctxMenu.ctxUpload"
      >
        <span class="tree-ctx-label">{{ t('filePreview.ctxUpload') }}</span>
      </button>
      <template v-if="ctxMenu.contextMenu.value?.rel">
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
        <button type="button" class="tree-ctx-item" role="menuitem" @click="ctxMenu.ctxRename">
          <span class="tree-ctx-label">{{ t('filePreview.ctxRename') }}</span>
        </button>
        <div class="tree-ctx-sep" />
        <button type="button" class="tree-ctx-item" role="menuitem" @click="ctxMenu.ctxCopyPath">
          <span class="tree-ctx-label">{{ t('filePreview.ctxCopyPath') }}</span>
        </button>
        <button
          v-if="!ctxMenu.isRemote.value"
          type="button"
          class="tree-ctx-item"
          role="menuitem"
          @click="ctxMenu.ctxReveal"
        >
          <span class="tree-ctx-label">{{ t('filePreview.ctxReveal') }}</span>
        </button>
        <button
          v-if="isTauri() && !ctxMenu.isRemote.value"
          type="button"
          class="tree-ctx-item"
          role="menuitem"
          @click="ctxMenu.ctxOpenFolder"
        >
          <span class="tree-ctx-label">{{ t('filePreview.ctxOpenFolder') }}</span>
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
          @click="ctxMenu.ctxDelete"
        >
          <span class="tree-ctx-label">{{ t('filePreview.ctxDelete') }}</span>
        </button>
      </template>
    </div>
  </Teleport>
  <ConfirmModal
    :visible="!!ctxMenu.moveConfirm.value"
    :title="t('filePreview.moveTitle')"
    :message="t('filePreview.moveConfirmMsg')"
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
  <SelectionToolbar :selected-text="''" :anchor-rect="null" @dismiss="() => {}" />
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
import { setActiveLeaf, getEditorPaneState } from '../../composables/useEditorRegistry'
import { getAllEditorLeaves } from '../../types/editorPane'
import { uiConfirm } from '../../composables/useConfirm'
import {
  saveFileWorkspaceState,
  type PersistedFileWorkspaceState,
} from '../../composables/useFileWorkspaceState'
import { setEditorSplitForCursorGroup } from '../../composables/useCursorGroup'
import { useFileOperations } from '../../composables/useFileOperations'
import type { DropPosition } from '../../types/pane'
import { useTreeContextMenu } from '../../composables/useTreeContextMenu'
import { useInlineCreateRename } from '../../composables/useInlineCreateRename'
import {
  useFileWorkspaceBoot,
  asWorkspaceError,
  workspaceErrorFromResponse,
  workspaceErrorKind,
  withWorkspaceErrorRel,
  type WorkspaceError,
} from '../../composables/useFileWorkspaceBoot'
import { TreeRows } from '../workspace/TreeRows'
import type { DirEntry } from '../workspace/TreeRows'
import EditorSplitContainer from '../workspace/EditorSplitContainer.vue'
import SelectionToolbar from '../workspace/SelectionToolbar.vue'
import ConfirmModal from '../ui/ConfirmModal.vue'
import { useRecentFiles } from '../../composables/useRecentAccess'
import { useWorkspaceBookmarks } from '../../composables/useWorkspaceBookmarks'
import FileRecentDropdown from '../workspace/FileRecentDropdown.vue'
import {
  ArrowLeft,
  ArrowRight,
  ChevronsDownUp,
  FilePlus,
  FolderPlus,
  PanelLeftClose,
  PanelLeftOpen,
  RotateCw,
  X,
} from 'lucide-vue-next'

const props = withDefaults(
  defineProps<{
    visible: boolean
    paneId: string
    inLeaf?: boolean
    shellType?: string
    initialPath?: string
    sourcePaneId?: string
    /** Rendered inside a floating window: suppress the global side effects
     *  (workspace/leaf registration, window listeners) that a split leaf owns. */
    isWindow?: boolean
  }>(),
  { inLeaf: true, isWindow: false }
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

/** Remote panes browse the SSH host; local-only affordances must hide. */
const isSsh = computed(() => props.shellType === 'ssh')

// --- Shared state ---
const cwdLabel = ref('')
const childCache = ref<Record<string, DirEntry[]>>({})
const expanded = ref<Set<string>>(new Set())
const lastTreePointerTs = ref(0)
const gitStatusMap = ref<Record<string, string>>({})
const recentDropdownOpen = ref(false)
const refreshBusy = ref(false)
const fileWorkspaceBodyRef = ref<HTMLElement | null>(null)
const treeWrapRef = ref<HTMLElement | null>(null)

// --- Composables ---
const nav = useFileNavigation()
const layout = useFileWorkspaceLayout()
const recentFiles = useRecentFiles()
const workspaceBookmarks = useWorkspaceBookmarks()
const editorSplit = useEditorSplit({ paneId: () => apiPaneId.value })

// Derived from active editor pane — keeps tree highlight and context menu working
const selectedRel = ref<string | null>(null)
const selectedIsDir = ref(false)
const previewErr = ref<WorkspaceError | null>(null)

// Live state of the active pane, exposed by EditorPane via the registry.
const activeHandle = computed(() => {
  const leafId = editorSplit.activeLeaf.value?.id
  return leafId ? getEditorPaneState(leafId) : null
})
const activeDirty = computed(() => activeHandle.value?.isDirty() ?? false)
const activeEditorText = computed({
  get: () => activeHandle.value?.editorText.value ?? '',
  set: (v: string) => {
    const state = activeHandle.value
    if (state) state.editorText.value = v
  },
})
const activeEditorBaseline = computed({
  get: () => activeHandle.value?.editorBaseline.value ?? '',
  set: (v: string) => {
    const state = activeHandle.value
    if (state) state.editorBaseline.value = v
  },
})
// Mirror of the active pane's meta for ops/context-menu plumbing that still
// consumes a single ref. Never written back to the pane.
const meta = ref<any | null>(null)
watch(
  [activeHandle, () => activeHandle.value?.meta.value],
  () => {
    meta.value = activeHandle.value?.meta.value ?? null
  },
  { immediate: true }
)

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
  () => {
    // A floating window must not hijack the global active editor leaf.
    if (props.isWindow) return
    setActiveLeaf(editorSplit.activeEditorLeafId.value ?? null)
  },
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
  parentRelPath,
  ensureChildren,
  onSelectFile,
  onSelectDir,
  t,
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
  t,
})

const ctxMenu = useTreeContextMenu({
  selectedRel,
  selectedIsDir,
  meta,
  editorDirty: activeDirty,
  editorText: activeEditorText,
  editorBaseline: activeEditorBaseline,
  childCache,
  expanded,
  inlineCreate,
  inlineRename,
  narrow: layout.narrow,
  isSsh,
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
// Every pane showing the changed path is refreshed — not just the active one.
// Dirty buffers keep their content and show a "changed on disk" marker instead.
function panesShowing(rel: string) {
  return getAllEditorLeaves(editorSplit.editorLayout.value).filter((leaf) => leaf.filePath === rel)
}

// Bulk writes (checkout, branch switch, agent rewrites) produce one watcher
// event per path. Coalesce the git-status refresh so a 100-file change runs
// one `git status`, not 100.
let gitRefreshTimer: ReturnType<typeof setTimeout> | null = null
function scheduleGitRefresh() {
  if (gitRefreshTimer) clearTimeout(gitRefreshTimer)
  gitRefreshTimer = setTimeout(() => {
    gitRefreshTimer = null
    void fetchGitStatus()
  }, 400)
}

function onWatchedFileChanged(rel: string) {
  for (const leaf of panesShowing(rel)) {
    const state = getEditorPaneState(leaf.id)
    if (!state) continue
    if (state.isDirty()) state.markDiskChanged()
    else void state.reloadFromDisk()
  }
  scheduleGitRefresh()
}

function onWatchedFileDeleted(rel: string) {
  for (const leaf of getAllEditorLeaves(editorSplit.editorLayout.value)) {
    if (leaf.filePath === rel || leaf.filePath?.startsWith(`${rel}/`)) {
      leaf.filePath = null
      leaf.isDir = false
    }
  }
  scheduleGitRefresh()
}

/** SSH panes have no local watcher behind them; don't open a socket at all. */
const canWatch = computed(() => !isSsh.value)

/** After a local reconnect, catch up on anything missed while offline. */
async function refreshAfterWatchReconnect() {
  const dirs = [...new Set(['', ...expanded.value])]
  await Promise.all(
    dirs.map(async (dir) => {
      try {
        const entries = await fetchList(dir)
        childCache.value = { ...childCache.value, [dir]: entries }
      } catch {}
    })
  )
  await fetchGitStatus()
}

const fileWatch = useFileWatch({
  paneId: () => apiPaneId.value,
  cwdLabel,
  expanded,
  childCache,
  fetchList,
  canWatch: () => canWatch.value,
  onFileChanged: onWatchedFileChanged,
  onFileDeleted: onWatchedFileDeleted,
  onReconnected: () => void refreshAfterWatchReconnect(),
})

/** Boot connects through this, so SSH never even schedules a watcher. */
function connectTreeWatchSocket() {
  if (!canWatch.value) return
  return fileWatch.connectTreeWatchSocket()
}

const {
  reloadAll,
  captureState,
  applyState,
  boot,
  openFromTerminal: openFromTerminalFromBoot,
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
  connectTreeWatchSocket,
  disconnectTreeWatchSocket: fileWatch.disconnectTreeWatchSocket,
  fetchGitStatus,
})

/**
 * User-initiated open (terminal path click / recent list). Boot restores,
 * rename reselects and delete reselects call `onSelectFile` directly, so they
 * never arrive here and never prompt.
 */
async function openFromTerminal(path: string): Promise<void> {
  if (await shouldBlockNavigate()) return
  await openFromTerminalFromBoot(path)
  await scrollSelectedIntoView()
}

/**
 * Bring the selected row into view after it was opened programmatically
 * (terminal link, recent list, history). Rows are identified by `data-rel`
 * rather than index because expansions shift the flat DOM order.
 */
async function scrollSelectedIntoView(): Promise<void> {
  await nextTick()
  const rel = selectedRel.value
  const wrap = treeWrapRef.value
  if (!rel || !wrap) return
  const rows = wrap.querySelectorAll<HTMLElement>('[data-rel]')
  for (const row of rows) {
    if (row.dataset.rel === rel) {
      row.scrollIntoView({ block: 'nearest' })
      return
    }
  }
}

/**
 * Retry the operation behind the visible error. A failed directory listing is
 * retried for that directory; anything else (resolve/boot) reloads the tree.
 */
async function retryPreviewErr() {
  const err = previewErr.value
  if (!err) return
  previewErr.value = null
  const rel = err.rel ?? ''
  if (!rel) {
    await reloadAll()
    return
  }
  const next = { ...childCache.value }
  delete next[rel]
  childCache.value = next
  try {
    await ensureChildren(rel)
  } catch (e) {
    previewErr.value = withWorkspaceErrorRel(e, rel)
  }
}

// --- Computed ---
const previewErrText = computed(() => {
  switch (workspaceErrorKind(previewErr.value)) {
    case 'forbidden':
      return t('filePreview.errPermission')
    case 'notFound':
      return t('filePreview.errNotFound')
    case 'network':
      return t('filePreview.errNetwork')
    default:
      return t('filePreview.errUnknown')
  }
})

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

async function onEditorFileDrop(leafId: string, rel: string, position: DropPosition) {
  if (position === 'center') {
    // Replacing this pane's file would drop its unsaved buffer.
    if (!(await confirmDiscardForLeaf(leafId))) return
    editorSplit.focusEditorPane(leafId)
    await onSelectFile(rel)
  } else {
    const direction = position === 'left' || position === 'right' ? 'horizontal' : 'vertical'
    editorSplit.openFileInNewPane(rel, false, direction)
    await onSelectFile(rel)
  }
}

function isInternalTreeMove(ev: DragEvent): boolean {
  const t = ev.dataTransfer?.types
  if (!t) return false
  return t.includes
    ? t.includes('application/x-tree-move')
    : (t as any).contains('application/x-tree-move')
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
/** Expand every ancestor that is not open yet and wait for its listing, so
 *  the target row exists in the DOM before we try to scroll to it. */
async function ensureParentsExpanded(rel: string): Promise<void> {
  const parts = rel.split('/')
  const next = new Set(expanded.value)
  next.add('')
  const loads: Promise<unknown>[] = []
  for (let i = 1; i < parts.length; i++) {
    const ancestor = parts.slice(0, i).join('/')
    if (!next.has(ancestor)) {
      next.add(ancestor)
      loads.push(ensureChildren(ancestor).catch(() => {}))
    }
  }
  expanded.value = next
  await Promise.all(loads)
}

async function doGoBack() {
  if (!nav.canGoBack.value) return
  // A directory entry only moves the tree selection; a file entry replaces
  // the active pane's file.
  const target = nav.navHistory.value[nav.navIndex.value - 1]
  if (target && !target.isDir && (await shouldBlockNavigate())) return
  const entry = nav.goBack()
  if (!entry) return
  await ensureParentsExpanded(entry.rel)
  if (entry.isDir) onSelectDir(entry.rel)
  else await onSelectFile(entry.rel)
  await scrollSelectedIntoView()
}

async function doGoForward() {
  if (!nav.canGoForward.value) return
  const target = nav.navHistory.value[nav.navIndex.value + 1]
  if (target && !target.isDir && (await shouldBlockNavigate())) return
  const entry = nav.goForward()
  if (!entry) return
  await ensureParentsExpanded(entry.rel)
  if (entry.isDir) onSelectDir(entry.rel)
  else await onSelectFile(entry.rel)
  await scrollSelectedIntoView()
}

// --- Tree interactions ---
function bumpTreePointerTs() {
  lastTreePointerTs.value = Date.now()
}

/** Ask before dropping a dirty buffer. Returns true when it is safe to proceed. */
async function confirmDiscardForLeaf(leafId: string | null | undefined): Promise<boolean> {
  if (!leafId) return true
  if (!getEditorPaneState(leafId)?.isDirty()) return true
  return uiConfirm(t('filePreview.discardChanges'), {
    confirmText: t('filePreview.discardChanges'),
    cancelText: t('filePreview.cancel'),
  })
}

async function shouldBlockNavigate(): Promise<boolean> {
  return !(await confirmDiscardForLeaf(editorSplit.activeLeaf.value?.id))
}

async function trySelectFile(rel: string, ev?: MouseEvent) {
  // Cmd (macOS) / Ctrl (Windows/Linux) + Click → open in new split pane
  if (ev?.metaKey || ev?.ctrlKey) {
    editorSplit.openFileInNewPane(rel, false, 'horizontal')
    await loadMetaForActivePane(rel)
    return
  }
  if (await shouldBlockNavigate()) return
  await onSelectFile(rel)
}

function trySelectDir(rel: string) {
  // Directory selection does not replace the editor buffer.
  onSelectDir(rel)
}

/** Close one pane after checking only the buffer it is about to drop. */
async function onCloseEditorPane(leafId: string) {
  const state = getEditorPaneState(leafId)
  if (state?.isDirty()) {
    const ok = await uiConfirm(t('filePreview.discardChanges'), {
      confirmText: t('filePreview.discardChanges'),
      cancelText: t('filePreview.cancel'),
    })
    if (!ok) return
  }
  editorSplit.closeEditorPane(leafId)
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
  let res: Response
  try {
    res = await authFetch(apiUrl(`/api/workspace/list?${q}`))
  } catch (e) {
    // Transport failure: status 0 so the UI reports a network error.
    throw asWorkspaceError(e)
  }
  // Keep the server's status and `{ error }` body — the error bar maps them to
  // localized text and decides whether Retry is useful.
  if (!res.ok) throw await workspaceErrorFromResponse(res)
  const data = await res.json()
  if (isSsh.value) {
    // The remote backend reports the directory it just listed; tree rel paths
    // are always relative to the initial root '/', so following it would make
    // cwdLabel drift on every navigation.
    cwdLabel.value = '/'
  } else {
    cwdLabel.value = data.cwd || ''
  }
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

// One listing request per directory: concurrent expanders (hover-expand,
// ensureParentsExpanded, rapid toggles) share the in-flight promise.
const pendingChildren = new Map<string, Promise<void>>()

function ensureChildren(rel: string): Promise<void> {
  if (childCache.value[rel]) return Promise.resolve()
  const inFlight = pendingChildren.get(rel)
  if (inFlight) return inFlight
  const request = (async () => {
    try {
      const entries = await fetchList(rel)
      childCache.value = { ...childCache.value, [rel]: entries }
    } finally {
      pendingChildren.delete(rel)
    }
  })()
  // Fire-and-forget callers (toggle, context menu, drag hover) must not
  // produce an unhandled rejection; show the first failure in the error bar.
  request.catch((e) => {
    if (!previewErr.value) previewErr.value = withWorkspaceErrorRel(e, rel)
  })
  pendingChildren.set(rel, request)
  return request
}

function onToggle(rel: string) {
  const next = new Set(expanded.value)
  if (next.has(rel)) next.delete(rel)
  else next.add(rel)
  expanded.value = next
  if (next.has(rel)) void ensureChildren(rel)
}

/** Explorer "collapse all": close every directory but keep the selection so
 *  the highlighted row stays revealed under its collapsed ancestors. */
function collapseAll() {
  expanded.value = new Set()
}

async function refreshTree() {
  if (refreshBusy.value) return
  refreshBusy.value = true
  try {
    await reloadAll()
  } finally {
    refreshBusy.value = false
  }
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
  void openFromTerminal(path)
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
  if (!props.isWindow) {
    window.addEventListener('keydown', onEditorSaveKeydown, true)
    window.addEventListener('scroll', onCloseContextScroll, true)
    ops.setActiveWorkspace()
    setEditorSplitForCursorGroup(editorSplit)
  }
  void getApiBase()
})

onBeforeUnmount(() => {
  if (gitRefreshTimer) {
    clearTimeout(gitRefreshTimer)
    gitRefreshTimer = null
  }
  if (props.paneId) saveFileWorkspaceState(props.paneId, captureState())
  window.removeEventListener('resize', layout.onResize)
  if (!props.isWindow) {
    window.removeEventListener('keydown', onEditorSaveKeydown, true)
    window.removeEventListener('scroll', onCloseContextScroll, true)
    ops.teardownWorkspaceDragDrop()
    ops.clearActiveWorkspace()
    setEditorSplitForCursorGroup(null)
    setActiveLeaf(null)
  }
  fileWatch.disconnectTreeWatchSocket()
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
  --tree-head-h: 30px;
  min-width: 120px;
  overflow: auto;
  flex-shrink: 0;
  background: var(--bg, #1a1a1a);
}

.file-workspace-tree-head {
  position: sticky;
  top: 0;
  z-index: 4;
  display: flex;
  align-items: center;
  gap: 6px;
  box-sizing: border-box;
  height: var(--tree-head-h);
  padding: 0 4px 0 12px;
  background: var(--bg, #1a1a1a);
  border-bottom: 1px solid var(--border, #333);
  color: var(--fg-muted, #888);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.7px;
  text-transform: uppercase;
}

.file-workspace-tree-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.file-workspace-tree-actions {
  display: flex;
  align-items: center;
  gap: 1px;
  opacity: 0.78;
}

.file-workspace-tree-head:hover .file-workspace-tree-actions {
  opacity: 1;
}

.file-workspace-tree-actions button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--fg-muted, #888);
  cursor: pointer;
}

.file-workspace-tree-actions button:hover {
  background: var(--tab-hover-bg, #333);
  color: var(--fg, #ccc);
}

.file-workspace-tree-actions button.spinning svg {
  animation: tree-head-spin 0.7s linear infinite;
}

@keyframes tree-head-spin {
  to {
    transform: rotate(360deg);
  }
}

.file-workspace-error {
  position: sticky;
  top: var(--tree-head-h, 0);
  z-index: 3;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 8px;
  background: rgba(244, 135, 113, 0.12);
  border-bottom: 1px solid rgba(244, 135, 113, 0.35);
  color: #f48771;
  font-size: 12px;
}

.file-workspace-error-text {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.file-workspace-error-retry {
  flex-shrink: 0;
  border: 1px solid #4a4a50;
  background: #26262b;
  color: #cfcfd4;
  border-radius: 4px;
  font-size: 11px;
  padding: 1px 8px;
  cursor: pointer;
}

.file-workspace-error-retry:hover {
  border-color: var(--accent, #89b4fa);
  color: #fff;
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

/* Inline create/rename: the input and its error share one flex row. */
.tree-inline-field {
  display: flex;
  flex: 1 1 0;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.tree-inline-field .tree-inline-input {
  flex: 1 1 auto;
}

.tree-inline-error {
  flex-shrink: 0;
  max-width: 45%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
  color: #f48771;
}

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
.tree-ctx-sep {
  height: 1px;
  margin: 4px 0;
  background: #3c3c3c;
  border: none;
  padding: 0;
}
</style>
