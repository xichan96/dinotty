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
          v-if="layout.narrow.value && layout.drawerOpen.value"
          class="file-workspace-drawer-backdrop"
          @click="layout.closeDrawer"
        ></div>
        <button
          v-if="layout.narrow.value && !layout.drawerOpen.value"
          type="button"
          class="file-workspace-drawer-fab"
          :title="t('app.fileWorkspace')"
          :aria-label="t('app.fileWorkspace')"
          @click="layout.openDrawer"
        >
          <Menu :size="14" />
          <span>{{ t('app.fileWorkspace') }}</span>
        </button>
        <div
          v-if="treeVisible"
          ref="treeWrapRef"
          class="file-workspace-tree-wrap"
          :class="{
            narrow: layout.narrow.value,
            'drawer-open': layout.narrow.value && layout.drawerOpen.value,
          }"
          :style="layout.treeWrapStyle.value"
        >
          <div class="file-workspace-tree-head">
            <span class="file-workspace-tree-title">{{
              searchOpen ? t('workspaceSearch.title') : t('filePreview.explorer')
            }}</span>
            <div v-if="!searchOpen" class="file-workspace-tree-actions">
              <button
                type="button"
                data-testid="tree-head-search"
                :title="t('workspaceSearch.open')"
                :aria-label="t('workspaceSearch.open')"
                @click="openSearch(true)"
              >
                <Search :size="14" />
              </button>
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
            <button
              v-if="searchOpen"
              type="button"
              class="file-workspace-tree-close"
              data-testid="tree-head-search-close"
              :title="t('workspaceSearch.close')"
              :aria-label="t('workspaceSearch.close')"
              @click="closeSearch"
            >
              <X :size="14" />
            </button>
            <button
              v-if="layout.narrow.value"
              type="button"
              class="file-workspace-tree-close"
              :title="t('filePreview.closeTree')"
              :aria-label="t('filePreview.closeTree')"
              @click="layout.closeDrawer"
            >
              <X :size="14" />
            </button>
          </div>
          <div v-if="previewErr && !searchOpen" class="file-workspace-error" role="alert">
            <span class="file-workspace-error-text">{{ previewErrText }}</span>
            <button type="button" class="file-workspace-error-retry" @click="retryPreviewErr">
              {{ t('filePreview.retry') }}
            </button>
          </div>
          <div
            v-show="!searchOpen"
            ref="treeHostRef"
            class="file-workspace-tree tree-host"
            tabindex="0"
            role="tree"
            :aria-label="t('filePreview.treeAriaLabel')"
            @click.stop
            @pointerdown.capture="bumpTreePointerTs"
            @pointerdown="treeKeyboard.onTreePointerDown"
            @keydown="treeKeyboard.onTreeKeydown"
            @focus="treeKeyboard.onTreeFocus"
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
              :ctx-target-rel="ctxMenu.contextMenu.value?.rel || undefined"
              :inline-create="inlineCreateForTree"
              :inline-placeholder="inlineInputPlaceholder"
              :inline-rename="inlineRename ?? undefined"
              :git-status="gitStatusMap"
              @toggle="onToggle"
              @select-file="trySelectFile"
              @open-file-pinned="tryOpenFilePinned"
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
            />
          </div>
          <FileSearchPanel
            v-if="searchOpen"
            ref="searchPanelRef"
            :pane-id="apiPaneId"
            :is-ssh="isSsh"
            @open-file="onSearchOpenFile"
            @close="closeSearch"
          />
        </div>
        <div
          v-if="treeVisible && !layout.narrow.value"
          class="file-workspace-tree-splitter"
          @mousedown.prevent="(e) => layout.startTreeWidthDrag(e, fileWorkspaceBodyRef)"
          @touchstart.prevent="(e) => layout.startTreeWidthDragTouch(e, fileWorkspaceBodyRef)"
        ></div>
        <div class="file-workspace-preview-wrap">
          <button
            v-if="!layout.narrow.value"
            type="button"
            class="tree-collapse-btn"
            :title="collapseToggleTitle"
            @click="toggleTreeVisibility"
          >
            <component :is="collapseIcon" :size="12" />
          </button>
          <EditorSplitContainer
            :layout="editorSplit.editorLayout.value"
            :active-leaf-id="editorSplit.activeEditorLeafId.value"
            :pane-id="apiPaneId"
            :show-header="editorSplit.isSplit.value"
            :reveal="searchReveal"
            @focus="(id: string) => editorSplit.focusEditorPane(id)"
            @activate-tab="onActivateTab"
            @close-tab="onCloseTab"
            @close-tabs="onCloseTabs"
            @set-tab-preview="onSetTabPreview"
            @split="onSplitGroup"
            @close-group="onCloseGroup"
            @copy-tab-path="onCopyTabPath"
            @reorder-tab="
              (leafId, tabId, targetId, after) =>
                editorSplit.reorderTabInLeaf(leafId, tabId, targetId, after)
            "
            @move-tab="
              (sourceLeafId, tabId, targetLeafId) =>
                editorSplit.moveTabToPane(sourceLeafId, tabId, targetLeafId)
            "
            @split-tab="
              (sourceLeafId, tabId, targetLeafId, position) =>
                editorSplit.splitTabToEdge(sourceLeafId, tabId, targetLeafId, position)
            "
            @file-drop="onEditorFileDrop"
          />
        </div>
      </div>
    </div>
  </div>
  <FileWorkspaceOverlays
    :visible="visible"
    :narrow="layout.narrow.value"
    :pane-id="apiPaneId"
    :menu="ctxMenu"
    :is-bookmarked="ctxIsBookmarked"
    :delete-message="deleteConfirmMessage"
    :delete-kbd-label="deleteKbdLabel"
    :fetch-dirs="fetchList"
    :toggle-bookmark="ctxToggleBookmark"
    :open-to-side="ctxOpenToSide"
  />
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick, toRef } from 'vue'
import { useI18n } from '../../composables/useI18n'
import { getApiBase } from '../../composables/apiBase'
import { copyToClipboard } from '../../utils/clipboard'
import { usePaneResize } from '../../composables/usePaneResize'
import { useFileNavigation, useSelectedPath } from '../../composables/useFileNavigation'
import { useFileWorkspaceLayout } from '../../composables/useFileWorkspaceLayout'
import { useFileWatch } from '../../composables/useFileWatch'
import { useEditorSplit } from '../../composables/useEditorSplit'
import { setActiveLeaf, getEditorPaneState } from '../../composables/useEditorRegistry'
import { provideTabBufferStore } from '../../composables/useTabBufferStore'
import { saveFileWorkspaceState } from '../../composables/useFileWorkspaceState'
import { setEditorSplitForCursorGroup } from '../../composables/useCursorGroup'
import { useFileOperations } from '../../composables/useFileOperations'
import { useTreeContextMenu } from '../../composables/useTreeContextMenu'
import {
  useTreeKeyboard,
  deleteShortcutLabel,
  isMacPlatform,
} from '../../composables/useTreeKeyboard'
import { useInlineCreateRename } from '../../composables/useInlineCreateRename'
import {
  useFileWorkspaceBoot,
  withWorkspaceErrorRel,
  workspaceErrorKind,
  type WorkspaceError,
} from '../../composables/useFileWorkspaceBoot'
import { useFileWorkspaceTree } from '../../composables/useFileWorkspaceTree'
import { useFileWorkspaceTabs } from '../../composables/useFileWorkspaceTabs'
import { useFileWorkspaceSearch } from '../../composables/useFileWorkspaceSearch'
import { takePendingFileReveal } from '../../composables/pendingFileReveal'
import { TreeRows } from '../workspace/TreeRows'
import type { DirEntry } from '../workspace/TreeRows'
import EditorSplitContainer from '../workspace/EditorSplitContainer.vue'
import FileWorkspaceOverlays from '../workspace/FileWorkspaceOverlays.vue'
import FileSearchPanel from '../workspace/FileSearchPanel.vue'
import { useRecentFiles } from '../../composables/useRecentAccess'
import { useWorkspaceBookmarks } from '../../composables/useWorkspaceBookmarks'
import FileRecentDropdown from '../workspace/FileRecentDropdown.vue'
import {
  ArrowLeft,
  ArrowRight,
  ChevronsDownUp,
  FilePlus,
  FolderPlus,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  RotateCw,
  Search,
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
const fileWorkspaceBodyRef = ref<HTMLElement | null>(null)
const treeWrapRef = ref<HTMLElement | null>(null)
const treeHostRef = ref<HTMLElement | null>(null)

const selectedRel = ref<string | null>(null)
const selectedIsDir = ref(false)
const previewErr = ref<WorkspaceError | null>(null)

// --- Composables ---
const nav = useFileNavigation()
const layout = useFileWorkspaceLayout()
const recentFiles = useRecentFiles()
const workspaceBookmarks = useWorkspaceBookmarks()
const tabBuffers = provideTabBufferStore()
const editorSplit = useEditorSplit({
  paneId: () => apiPaneId.value,
  isTabDirty: (tab) => tabBuffers.isDirty(tab),
  onTabRemoved: (tab) => tabBuffers.drop(tab.id),
  onTabReset: (tab) => tabBuffers.reset(tab.id),
})
const { selectedPath: globalSelectedPath } = useSelectedPath()

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

// Forward declarations keep the extraction order readable: these closures are
// only invoked after setup has finished constructing every composable.
function parentRelPath(rel: string): string {
  return ops.parentRelPath(rel)
}
function ensureChildren(rel: string): Promise<void> {
  return tree.ensureChildren(rel)
}
async function fetchList(rel: string): Promise<DirEntry[]> {
  return tree.fetchList(rel)
}

const tabs = useFileWorkspaceTabs({
  split: editorSplit,
  buffers: tabBuffers,
  nav,
  selectedRel,
  selectedIsDir,
  globalSelectedPath,
  absolutePath: (rel) => ops.absolutePath(rel),
  emitNavigate: (absPath) => emit('navigate', absPath),
  recordRecent: (absPath, name) => recentFiles.recordFile(absPath, name),
  closeDrawer: layout.closeDrawer,
  isNarrow: () => layout.narrow.value,
  t,
  onGitChange: () => void tree.fetchGitStatus(),
})

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
  onSelectFile: tabs.selectFile,
  onSelectDir: tabs.selectDir,
  onPathRenamed: tabs.rewriteOpenTabs,
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
  onSelectFile: tabs.selectFile,
  onSelectDir: tabs.selectDir,
  triggerUpload: ops.triggerUpload,
  downloadFile: ops.downloadFile,
  paneId: () => apiPaneId.value,
  isPathDirty: tabs.isPathDirty,
  onDeleted: tabs.closeTabsForPath,
  onPathMoved: tabs.rewriteOpenTabs,
  t,
  // Escape from a keyboard-opened menu returns focus to its row.
  onMenuClosed: (rel: string) => treeKeyboard.focusRow(rel),
})

/** Shortcut hints in the context menu follow the platform the UI runs on. */
const deleteKbdLabel = deleteShortcutLabel(isMacPlatform())

const treeKeyboard = useTreeKeyboard({
  container: treeHostRef,
  expanded,
  selectedRel,
  onToggle: (rel) => tree.onToggle(rel),
  onOpen: (rel) => void tabs.trySelectFile(rel),
  onRename: (rel, isDir) => {
    inlineRename.value = {
      rel,
      isDir,
      value: rel.split('/').pop() || rel,
      error: '',
    }
  },
  onDelete: (rel, isDir) => ctxMenu.requestDelete(rel, isDir),
  onMenu: (rel, isDir, x, y) => ctxMenu.openMenuAt(rel, isDir, x, y),
})

const tree = useFileWorkspaceTree({
  paneId: () => apiPaneId.value,
  isSsh: () => isSsh.value,
  cwdLabel,
  childCache,
  expanded,
  gitStatusMap,
  previewErr,
  selectedRel,
  treeWrapRef,
  reloadAll: () => reloadAll(),
})

// Template-facing names for the extracted modules.
const { refreshBusy, refreshTree, collapseAll, onToggle } = tree
const {
  trySelectFile,
  trySelectDir,
  onActivateTab,
  onCloseTab,
  onCloseTabs,
  onSetTabPreview,
  onSplitGroup,
  onCloseGroup,
  onCopyTabPath,
  onEditorFileDrop,
} = tabs

const {
  searchOpen,
  searchPanelRef,
  searchReveal,
  revealFileAt,
  openSearch,
  closeSearch,
  onSearchOpenFile,
  onWorkspaceSearchKeydown,
} = useFileWorkspaceSearch({
  visible: () => props.visible,
  treeCollapsed,
  layout,
  treeWrapRef,
  bodyRef: fileWorkspaceBodyRef,
  ensureParentsExpanded: tree.ensureParentsExpanded,
  selectFile: tabs.selectFile,
  scrollSelectedIntoView: tree.scrollSelectedIntoView,
})

watch(nav.canGoBack, (v) => emit('update:canGoBack', v), { immediate: true })
watch(nav.canGoForward, (v) => emit('update:canGoForward', v), { immediate: true })

// --- File Watch ---
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
  await tree.fetchGitStatus()
}

const fileWatch = useFileWatch({
  paneId: () => apiPaneId.value,
  cwdLabel,
  expanded,
  childCache,
  fetchList,
  canWatch: () => canWatch.value,
  onFileChanged: tabs.onWatchedFileChanged,
  onFileDeleted: tabs.onWatchedFileDeleted,
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
  onSelectFile: tabs.selectFile,
  onSelectDir: tabs.selectDir,
  connectTreeWatchSocket,
  disconnectTreeWatchSocket: fileWatch.disconnectTreeWatchSocket,
  fetchGitStatus: tree.fetchGitStatus,
})

/**
 * User-initiated open (terminal path click / recent list). Boot restores,
 * rename reselects and delete reselects call `selectFile` directly, so they
 * never arrive here and never prompt.
 */
async function openFromTerminal(
  path: string,
  reveal?: { line?: number; column?: number },
  resolvePaneId?: string
): Promise<void> {
  const rel = await openFromTerminalFromBoot(path, resolvePaneId)
  await tree.scrollSelectedIntoView()
  if (rel && reveal?.line) revealFileAt(rel, reveal.line, reveal.column)
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
    await tree.ensureChildren(rel)
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

/** On narrow panes the tree is a drawer that exists independently of the
 *  desktop collapse flag; otherwise it follows that flag as before. */
const treeVisible = computed(() => !treeCollapsed.value || layout.narrow.value)

const collapseIcon = computed(() => {
  const collapsed = layout.narrow.value ? !layout.drawerOpen.value : treeCollapsed.value
  return collapsed ? PanelLeftOpen : PanelLeftClose
})

const collapseToggleTitle = computed(() => {
  const collapsed = layout.narrow.value ? !layout.drawerOpen.value : treeCollapsed.value
  return collapsed ? t('previewPanel.expandTree') : t('previewPanel.collapseTree')
})

function toggleTreeVisibility() {
  if (layout.narrow.value) layout.toggleDrawer()
  else treeCollapsed.value = !treeCollapsed.value
}

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
  const isDir = ctxMenu.contextMenu.value?.isDir ?? false
  ctxMenu.closeContextMenu()
  tabs.openInNewPane(rel, isDir)
}

function isInternalTreeMove(ev: DragEvent): boolean {
  const types = ev.dataTransfer?.types
  if (!types) return false
  return types.includes
    ? types.includes('application/x-tree-move')
    : (types as any).contains('application/x-tree-move')
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
async function doGoBack() {
  if (!nav.canGoBack.value) return
  const entry = nav.goBack()
  if (!entry) return
  await tree.ensureParentsExpanded(entry.rel)
  if (entry.isDir) tabs.selectDir(entry.rel)
  else await tabs.selectFile(entry.rel)
  await tree.scrollSelectedIntoView()
}

async function doGoForward() {
  if (!nav.canGoForward.value) return
  const entry = nav.goForward()
  if (!entry) return
  await tree.ensureParentsExpanded(entry.rel)
  if (entry.isDir) tabs.selectDir(entry.rel)
  else await tabs.selectFile(entry.rel)
  await tree.scrollSelectedIntoView()
}

// --- Tree interactions ---
function bumpTreePointerTs() {
  lastTreePointerTs.value = Date.now()
}

function tryOpenFilePinned(rel: string) {
  void tabs.selectFile(rel, { pin: true })
}

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
watch(
  () => props.paneId,
  (_newId, oldId) => {
    if (oldId) saveFileWorkspaceState(oldId, captureState())
  },
  { flush: 'sync' }
)

watch(
  () => [props.visible, props.paneId, props.inLeaf],
  async () => {
    if (!props.visible || !props.paneId) return
    await boot()
    // A freshly inserted files pane only carries its path; consume the
    // line/column stashed by the terminal link click after boot opened it.
    const pending = takePendingFileReveal(props.paneId)
    if (pending) await openFromTerminal(pending.path, pending)
  },
  { immediate: true }
)

// --- Lifecycle ---
const { startDrag } = usePaneResize('.file-workspace', layout.direction)

function onWindowResize() {
  layout.onResize()
  layout.clampTreePaneWidth(fileWorkspaceBodyRef.value)
}

onMounted(() => {
  window.addEventListener('resize', onWindowResize)
  window.addEventListener('keydown', onWorkspaceSearchKeydown)
  void nextTick(() => layout.clampTreePaneWidth(fileWorkspaceBodyRef.value))
  if (!props.isWindow) {
    window.addEventListener('keydown', onEditorSaveKeydown, true)
    window.addEventListener('scroll', onCloseContextScroll, true)
    ops.setActiveWorkspace()
    setEditorSplitForCursorGroup(editorSplit)
  }
  void getApiBase()
})

onBeforeUnmount(() => {
  if (props.paneId) saveFileWorkspaceState(props.paneId, captureState())
  window.removeEventListener('resize', onWindowResize)
  window.removeEventListener('keydown', onWorkspaceSearchKeydown)
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

<style scoped src="../../styles/file-workspace-preview.css"></style>

<style src="../../styles/file-workspace-preview-global.css"></style>
