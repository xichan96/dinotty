<template>
  <div v-if="visible && embedded" class="file-workspace-embedded">
    <input ref="ops.fileInputRef" type="file" multiple class="sr-only" @change="ops.onFilePick" />
    <div
      ref="fileWorkspaceBodyRef"
      class="file-workspace-body"
      :class="{ embedded }"
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
          @contextmenu.prevent="onSidebarContextMenu"
        >
          <div class="workspace-side-tabs" role="tablist">
            <button
              type="button"
              role="tab"
              data-testid="workspace-files-tab"
              :aria-selected="sidebarMode === 'files'"
              :class="{ active: sidebarMode === 'files' }"
              :title="t('gitPanel.files')"
              @click="setSidebarMode('files')"
            >
              <Files :size="14" />
              <span>{{ t('gitPanel.files') }}</span>
            </button>
            <button
              type="button"
              role="tab"
              data-testid="workspace-git-tab"
              :aria-selected="sidebarMode === 'git'"
              :class="{ active: sidebarMode === 'git' }"
              :title="t('gitPanel.sourceControl')"
              @click="setSidebarMode('git')"
            >
              <GitBranch :size="14" />
              <span>{{ t('gitPanel.sourceControl') }}</span>
              <span v-if="gitFiles.length" class="workspace-side-badge">{{ gitFiles.length }}</span>
            </button>
          </div>
          <div v-if="sidebarMode === 'files'" class="workspace-tree-content">
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
              :on-dir-drag-enter="ops.setHoveredDir"
              :on-dir-drag-leave="ops.clearHoveredDir"
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
            />
          </div>
          <GitPanel
            v-else
            :pane-id="paneId"
            :branch="gitBranch"
            :is-git-repo="isGitRepo"
            :loading="gitStatusLoading"
            :files="gitFiles"
            :selected-diff="gitDiffSelection"
            @refresh="refreshGitPanel"
            @view-diff="showGitDiff"
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
        <GitDiffViewer
          v-if="gitDiffSelection"
          :key="gitDiffViewerKey"
          :pane-id="paneId"
          :file-path="gitDiffSelection.filePath"
          :staged="gitDiffSelection.staged"
          :untracked="gitDiffSelection.untracked"
          @close="gitDiffSelection = null"
          @open-source="openGitSource"
        />
        <EditorSplitContainer
          v-else
          :layout="editorSplit.editorLayout.value"
          :active-leaf-id="editorSplit.activeEditorLeafId.value"
          :pane-id="paneId"
          :show-header="editorSplit.isSplit.value"
          @focus="(id: string) => editorSplit.focusEditorPane(id)"
          @close="(id: string) => editorSplit.closeEditorPane(id)"
          @file-drop="onEditorFileDrop"
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
          <button
            type="button"
            @click="ctxMenu.addMenuOpen.value = !ctxMenu.addMenuOpen.value"
            title="New"
          >
            +
          </button>
          <div
            v-if="ctxMenu.addMenuOpen.value"
            class="file-workspace-add-backdrop"
            @click="ctxMenu.addMenuOpen.value = false"
          ></div>
          <div v-if="ctxMenu.addMenuOpen.value" class="file-workspace-add-dropdown">
            <button
              type="button"
              @click="openNewFileFromAddMenu"
            >
              {{ t('filePreview.ctxNewFile') }}
            </button>
            <button
              type="button"
              @click="openNewFolderFromAddMenu"
            >
              {{ t('filePreview.ctxNewFolder') }}
            </button>
          </div>
        </div>
        <button type="button" @click="close" title="Close">✕</button>
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
            @contextmenu.prevent="onSidebarContextMenu"
          >
            <div class="workspace-side-tabs" role="tablist">
              <button
                type="button"
                role="tab"
                data-testid="workspace-files-tab"
                :aria-selected="sidebarMode === 'files'"
                :class="{ active: sidebarMode === 'files' }"
                :title="t('gitPanel.files')"
                @click="setSidebarMode('files')"
              >
                <Files :size="14" />
                <span>{{ t('gitPanel.files') }}</span>
              </button>
              <button
                type="button"
                role="tab"
                data-testid="workspace-git-tab"
                :aria-selected="sidebarMode === 'git'"
                :class="{ active: sidebarMode === 'git' }"
                :title="t('gitPanel.sourceControl')"
                @click="setSidebarMode('git')"
              >
                <GitBranch :size="14" />
                <span>{{ t('gitPanel.sourceControl') }}</span>
                <span v-if="gitFiles.length" class="workspace-side-badge">{{
                  gitFiles.length
                }}</span>
              </button>
            </div>
            <div v-if="sidebarMode === 'files'" class="workspace-tree-content">
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
                :on-dir-drag-enter="ops.setHoveredDir"
                :on-dir-drag-leave="ops.clearHoveredDir"
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
            <GitPanel
              v-else
              :pane-id="paneId"
              :branch="gitBranch"
              :is-git-repo="isGitRepo"
              :loading="gitStatusLoading"
              :files="gitFiles"
              :selected-diff="gitDiffSelection"
              @refresh="refreshGitPanel"
              @view-diff="showGitDiff"
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
          <GitDiffViewer
            v-if="gitDiffSelection"
            :key="gitDiffViewerKey"
            :pane-id="paneId"
            :file-path="gitDiffSelection.filePath"
            :staged="gitDiffSelection.staged"
            :untracked="gitDiffSelection.untracked"
            @close="gitDiffSelection = null"
            @open-source="openGitSource"
          />
          <EditorSplitContainer
            v-else
            :layout="editorSplit.editorLayout.value"
            :active-leaf-id="editorSplit.activeEditorLeafId.value"
            :pane-id="paneId"
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
  <SelectionToolbar :selected-text="''" :anchor-rect="null" @dismiss="() => {}" />
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { useI18n } from '../../composables/useI18n'
import { getApiBase, apiUrl, authFetch } from '../../composables/apiBase'
import { isTauri } from '../../composables/useTransport'
import { copyToClipboard } from '../../utils/clipboard'
import { usePaneResize } from '../../composables/usePaneResize'
import { useFileNavigation, useSelectedPath } from '../../composables/useFileNavigation'
import { useFileWorkspaceLayout } from '../../composables/useFileWorkspaceLayout'
import { useFileWatch } from '../../composables/useFileWatch'
import { useEditorSplit } from '../../composables/useEditorSplit'
import { useFileOperations } from '../../composables/useFileOperations'
import type { DropPosition } from '../../types/pane'
import { useTreeContextMenu } from '../../composables/useTreeContextMenu'
import { TreeRows } from '../workspace/TreeRows'
import type { DirEntry } from '../workspace/TreeRows'
import EditorSplitContainer from '../workspace/EditorSplitContainer.vue'
import GitDiffViewer from '../workspace/GitDiffViewer.vue'
import GitPanel from '../workspace/GitPanel.vue'
import SelectionToolbar from '../workspace/SelectionToolbar.vue'
import ConfirmModal from '../ui/ConfirmModal.vue'
import { useRecentFiles } from '../../composables/useRecentAccess'
import { useWorkspaceBookmarks } from '../../composables/useWorkspaceBookmarks'
import FileRecentDropdown from '../workspace/FileRecentDropdown.vue'
import { Files, GitBranch, Star, PanelLeftClose, PanelLeftOpen } from 'lucide-vue-next'
import { mapGitFileEntry, type GitDiffSelection, type GitFileEntry } from '../../utils/gitPanel'

const props = withDefaults(
  defineProps<{ visible: boolean; paneId: string; embedded?: boolean }>(),
  { embedded: false }
)
const treeCollapsed = defineModel<boolean>('treeCollapsed', { default: false })
const emit = defineEmits<{
  close: []
  navigate: [path: string]
  'update:canGoBack': [v: boolean]
  'update:canGoForward': [v: boolean]
}>()

const { t } = useI18n()

// --- Shared state ---
const cwdLabel = ref('')
const childCache = ref<Record<string, DirEntry[]>>({})
const expanded = ref<Set<string>>(new Set())
const lastTreePointerTs = ref(0)
const gitStatusMap = ref<Record<string, string>>({})
const gitFiles = ref<GitFileEntry[]>([])
const gitBranch = ref<string | null>(null)
const isGitRepo = ref(false)
const gitStatusLoading = ref(false)
const gitStatusVersion = ref(0)
const sidebarMode = ref<'files' | 'git'>('files')
const gitDiffSelection = ref<GitDiffSelection | null>(null)
const inlineCreate = ref<{ parentRel: string; kind: 'file' | 'dir' } | null>(null)
const inlineRename = ref<{ rel: string; isDir: boolean } | null>(null)
const recentDropdownOpen = ref(false)
const fileWorkspaceBodyRef = ref<HTMLElement | null>(null)

// --- Composables ---
const nav = useFileNavigation()
const layout = useFileWorkspaceLayout()
const recentFiles = useRecentFiles()
const workspaceBookmarks = useWorkspaceBookmarks()
const editorSplit = useEditorSplit({ paneId: () => props.paneId })

// Derived from active editor pane — keeps tree highlight and context menu working
const selectedRel = ref<string | null>(null)
const selectedIsDir = ref(false)
const meta = ref<any | null>(null)
const previewErr = ref('')

// Keep selectedRel in sync with active editor pane
watch(
  () => editorSplit.activeLeaf.value?.filePath,
  (fp) => {
    selectedRel.value = fp ?? null
  }
)
watch(
  () => editorSplit.activeLeaf.value?.isDir,
  (isDir) => {
    selectedIsDir.value = isDir ?? false
  }
)

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
  t,
})

watch(nav.canGoBack, (v) => emit('update:canGoBack', v), { immediate: true })
watch(nav.canGoForward, (v) => emit('update:canGoForward', v), { immediate: true })

// --- File Watch ---
const fileWatch = useFileWatch({
  paneId: () => props.paneId,
  cwdLabel,
  expanded,
  childCache,
  selectedRel,
  selectedIsDir,
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

const gitDiffViewerKey = computed(function computeGitDiffViewerKey() {
  // 步骤1：状态刷新后重新创建查看器，确保暂存或丢弃操作立即反映到 diff。
  if (!gitDiffSelection.value) return `empty:${gitStatusVersion.value}`
  const selection = gitDiffSelection.value
  return `${selection.filePath}:${selection.staged}:${gitStatusVersion.value}`
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

function onSidebarContextMenu(event: MouseEvent): void {
  // 步骤1：文件视图保留新建菜单，Git 视图不显示文件树菜单。
  if (sidebarMode.value === 'files') {
    ctxMenu.onTreeBgContextMenu(event)
  }
}

function setSidebarMode(mode: 'files' | 'git'): void {
  // 步骤1：切换侧栏视图，进入源代码管理时读取最新仓库状态。
  sidebarMode.value = mode
  ctxMenu.closeContextMenu()
  if (mode === 'git') {
    void fetchGitStatus()
  }
}

function showGitDiff(selection: GitDiffSelection): void {
  // 步骤1：在主区域打开与侧栏分组对应的 Git 差异。
  gitDiffSelection.value = selection
}

async function openGitSource(path: string): Promise<void> {
  // 步骤1：关闭差异视图并在当前编辑窗格打开源文件。
  gitDiffSelection.value = null
  await onSelectFile(path)
}

async function refreshGitPanel(): Promise<void> {
  // 步骤1：重新读取状态，并让已打开的 diff 使用最新内容。
  await fetchGitStatus()
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
  // 步骤1：普通导航会退出 Git 差异视图并打开目标目录。
  gitDiffSelection.value = null
  editorSplit.openFileInActivePane(rel, true)
  meta.value = null
  nav.pushNav(rel, true)
  globalSelectedPath.value = ops.absolutePath(rel)
  emit('navigate', ops.absolutePath(rel))
}

async function loadMetaForActivePane(rel: string) {
  recentFiles.recordFile(ops.absolutePath(rel), rel.split('/').pop() || rel)
}

async function onSelectFile(rel: string) {
  // 步骤1：普通导航会退出 Git 差异视图并打开目标文件。
  gitDiffSelection.value = null
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
  const q = new URLSearchParams({ pane_id: props.paneId, path: rel })
  if (cwdLabel.value) q.set('root', cwdLabel.value)
  const res = await authFetch(apiUrl(`/api/workspace/list?${q}`))
  if (!res.ok) throw new Error('list failed')
  const data = await res.json()
  cwdLabel.value = data.cwd || ''
  return data.entries || []
}

async function fetchGitStatus(): Promise<void> {
  // 步骤1：标记加载状态并读取当前终端工作区的 Git 状态。
  gitStatusLoading.value = true
  try {
    await getApiBase()
    const query = new URLSearchParams({ pane_id: props.paneId })
    const response = await authFetch(apiUrl(`/api/workspace/git-status?${query}`))
    if (!response.ok) {
      isGitRepo.value = false
      gitBranch.value = null
      gitFiles.value = []
      gitStatusMap.value = {}
      return
    }
    const data = await response.json()
    isGitRepo.value = data.is_git_repo === true
    gitBranch.value = typeof data.branch === 'string' ? data.branch : null

    // 步骤2：同时生成 Git 面板条目和文件树使用的兼容状态映射。
    const nextFiles: GitFileEntry[] = []
    const nextStatusMap: Record<string, string> = {}
    if (isGitRepo.value && Array.isArray(data.files)) {
      for (const rawFile of data.files) {
        const file = mapGitFileEntry(rawFile)
        if (!file.path) continue
        nextFiles.push(file)
        nextStatusMap[file.path] = file.status
      }
    }
    gitFiles.value = nextFiles
    gitStatusMap.value = nextStatusMap
    gitStatusVersion.value += 1
  } catch {
    isGitRepo.value = false
    gitBranch.value = null
    gitFiles.value = []
    gitStatusMap.value = {}
  } finally {
    gitStatusLoading.value = false
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

function openNewFileFromAddMenu(): void {
  // 步骤1：关闭新增菜单，再启动文件名输入。
  ctxMenu.addMenuOpen.value = false
  startNewFile()
}

function openNewFolderFromAddMenu(): void {
  // 步骤1：关闭新增菜单，再启动文件夹名输入。
  ctxMenu.addMenuOpen.value = false
  startNewFolder()
}

async function onInlineCreateCommit(name: string) {
  if (!inlineCreate.value) return
  if (!name) {
    inlineCreate.value = null
    return
  }
  const { parentRel, kind } = inlineCreate.value
  inlineCreate.value = null
  await getApiBase()
  const q = new URLSearchParams({ pane_id: props.paneId, parent: parentRel })
  if (cwdLabel.value) q.set('cwd', cwdLabel.value)
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
  try {
    await ensureChildren(parentRel)
  } catch {}
  if (kind === 'file') await onSelectFile(rel)
  else {
    expanded.value = new Set([...expanded.value, rel])
    onSelectDir(rel)
    void ensureChildren(rel)
  }
}

function onInlineCreateCancel() {
  inlineCreate.value = null
}

async function onInlineRenameCommit(newName: string) {
  if (!inlineRename.value) return
  if (!newName) {
    inlineRename.value = null
    return
  }
  const { rel, isDir } = inlineRename.value
  inlineRename.value = null
  await getApiBase()
  const q = new URLSearchParams({ pane_id: props.paneId, path: rel })
  if (cwdLabel.value) q.set('cwd', cwdLabel.value)
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
  try {
    await ensureChildren(parentRel)
  } catch {}
  if (selectedRel.value === rel) {
    if (isDir) onSelectDir(newRel)
    else await onSelectFile(newRel)
  }
}

function onInlineRenameCancel() {
  inlineRename.value = null
}

async function onUploadToDir(dir: string, ev: DragEvent) {
  if (isTauri()) return // handled by file-drop-paths listener
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
async function reloadAll() {
  inlineCreate.value = null
  ctxMenu.contextMenu.value = null
  childCache.value = {}
  expanded.value = new Set()
  previewErr.value = ''
  meta.value = null
  try {
    await ensureChildren('')
  } catch {
    previewErr.value = 'list failed'
  }
}

async function expandFirstLevelDirs() {
  const entries = childCache.value['']
  if (!entries) return
  const dirs = entries.filter((e) => e.is_dir)
  if (!dirs.length) return
  const dirPaths = dirs.map((d) => d.name)
  expanded.value = new Set(dirPaths)
  await Promise.all(dirPaths.map((p) => ensureChildren(p)))
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
  } catch {
    previewErr.value = 'list failed'
  }
}

function close() {
  emit('close')
}

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
  try {
    await ensureChildren('')
  } catch {
    previewErr.value = 'list failed'
    return
  }
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
}

function onCloseContextScroll() {
  if (ctxMenu.contextMenu.value) ctxMenu.contextMenu.value = null
}

// --- Watchers ---
watch(layout.narrow, (isNarrow) => {
  if (isNarrow) treeCollapsed.value = false
})

watch(
  () => [props.visible, props.paneId, props.embedded],
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
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', layout.onResize)
  window.removeEventListener('keydown', onEditorSaveKeydown, true)
  window.removeEventListener('scroll', onCloseContextScroll, true)
  ops.teardownWorkspaceDragDrop()
  ops.clearActiveWorkspace()
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

.file-workspace-add-menu {
  position: relative;
}
.file-workspace-add-backdrop {
  position: fixed;
  inset: 0;
  z-index: 199;
}
.file-workspace-add-dropdown {
  position: absolute;
  top: calc(100% + 4px);
  left: 50%;
  transform: translateX(-50%);
  min-width: 120px;
  background: var(--bg-surface, #1a1a1a);
  border: 1px solid var(--border, #333);
  border-radius: 6px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
  z-index: 200;
  padding: 4px 0;
  display: flex;
  flex-direction: column;
}
.file-workspace-add-dropdown button {
  padding: 8px 16px;
  font-size: 13px;
  color: var(--fg, #c7c7c7);
  text-align: left;
  white-space: nowrap;
  border-radius: 0;
}
.file-workspace-add-dropdown button:hover {
  background: rgba(255, 255, 255, 0.06);
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
  overflow: hidden;
  flex-shrink: 0;
  background: var(--bg, #1a1a1a);
}

.file-workspace-tree {
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding: 0;
}

.workspace-side-tabs {
  min-height: 34px;
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  border-bottom: 1px solid var(--border, #333);
  background: var(--tab-bg, #202020);
}

.workspace-side-tabs button {
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  border: 0;
  border-bottom: 2px solid transparent;
  border-radius: 0;
  padding: 0 6px;
  color: var(--fg-muted, #888);
  background: transparent;
  cursor: pointer;
  font-size: 11px;
}

.workspace-side-tabs button > span:not(.workspace-side-badge) {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.workspace-side-tabs button:hover,
.workspace-side-tabs button:focus-visible {
  color: var(--fg-bright, #eee);
  background: var(--bg-hover, #303030);
  outline: none;
}

.workspace-side-tabs button:focus-visible {
  box-shadow: inset 0 0 0 1px var(--accent, #0e639c);
}

.workspace-side-tabs button.active {
  color: var(--fg-bright, #eee);
  border-bottom-color: var(--accent, #0e639c);
}

.workspace-side-badge {
  min-width: 16px;
  height: 16px;
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  padding: 0 4px;
  box-sizing: border-box;
  color: var(--fg-bright, #eee);
  background: var(--bg-hover, #3a3a3a);
  font-family: var(--font-mono);
  font-size: 9px;
}

.workspace-tree-content {
  min-height: 0;
  flex: 1;
  overflow: auto;
  padding: 2px 0;
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
