<script setup lang="ts">
import { ref, computed } from 'vue'
import { Star, GripVertical } from 'lucide-vue-next'
import { useWorkspaceBookmarks } from '../../composables/useWorkspaceBookmarks'
import { useI18n } from '../../composables/useI18n'

const emit = defineEmits<{
  navigate: [path: string]
}>()

const { t } = useI18n()
const { bookmarks, removeBookmark, renameBookmark, reorderBookmarks } = useWorkspaceBookmarks()

const collapsed = ref(false)
const dragId = ref<string | null>(null)
const dropTarget = ref<string | null>(null)
const dropPos = ref<'top' | 'bottom' | null>(null)

// Context menu
const ctxMenu = ref<{ x: number; y: number; id: string; name: string } | null>(null)
const ctxRenaming = ref<string | null>(null)
const ctxRenameValue = ref('')

function toggleCollapse() {
  collapsed.value = !collapsed.value
}

function onItemClick(path: string) {
  emit('navigate', path)
}

function onRemove(id: string) {
  removeBookmark(id)
}

// Drag and drop
function onDragStart(e: DragEvent, id: string) {
  dragId.value = id
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move'
  }
}

function onDragOver(e: DragEvent, id: string) {
  if (!dragId.value || dragId.value === id) return
  e.preventDefault()
  dropTarget.value = id
  const rect = (e.target as HTMLElement).getBoundingClientRect()
  dropPos.value = e.clientY < rect.top + rect.height / 2 ? 'top' : 'bottom'
}

function onDragLeave() {
  dropTarget.value = null
  dropPos.value = null
}

function onDrop(e: DragEvent, id: string) {
  e.preventDefault()
  if (!dragId.value || dragId.value === id) return
  const fromIdx = bookmarks.value.findIndex(b => b.id === dragId.value)
  const toIdx = bookmarks.value.findIndex(b => b.id === id)
  if (fromIdx === -1 || toIdx === -1) return
  const insertIdx = dropPos.value === 'bottom' ? toIdx + 1 : toIdx
  reorderBookmarks(fromIdx, fromIdx < toIdx ? insertIdx - 1 : insertIdx)
  onDragEnd()
}

function onDragEnd() {
  dragId.value = null
  dropTarget.value = null
  dropPos.value = null
}

// Context menu
function onContextMenu(e: MouseEvent, id: string, name: string) {
  e.preventDefault()
  ctxMenu.value = { x: e.clientX, y: e.clientY, id, name }
}

function closeCtxMenu() {
  ctxMenu.value = null
}

function ctxRename() {
  if (!ctxMenu.value) return
  ctxRenaming.value = ctxMenu.value.id
  ctxRenameValue.value = ctxMenu.value.name
  closeCtxMenu()
}

function ctxRenameCommit() {
  if (ctxRenaming.value && ctxRenameValue.value.trim()) {
    renameBookmark(ctxRenaming.value, ctxRenameValue.value.trim())
  }
  ctxRenaming.value = null
}

function ctxRenameCancel() {
  ctxRenaming.value = null
}

function ctxRemove() {
  if (!ctxMenu.value) return
  removeBookmark(ctxMenu.value.id)
  closeCtxMenu()
}

function fileName(path: string): string {
  return path.split('/').pop() || path
}
</script>

<template>
  <div class="bookmark-section" v-if="bookmarks.length > 0 || !collapsed">
    <!-- Section header -->
    <div class="bookmark-section-header" @click="toggleCollapse">
      <span class="bookmark-twistie">{{ collapsed ? '▶' : '▼' }}</span>
      <Star :size="12" />
      <span class="bookmark-section-title">{{ t('fileBookmark.title') }}</span>
      <span class="bookmark-section-count" v-if="bookmarks.length > 0">{{ bookmarks.length }}</span>
    </div>

    <!-- Bookmark list -->
    <template v-if="!collapsed">
      <!-- Empty state -->
      <div v-if="bookmarks.length === 0" class="bookmark-empty">
        {{ t('fileBookmark.empty') }}
      </div>

      <!-- Bookmark items -->
      <div
        v-for="bm in bookmarks"
        :key="bm.id"
        class="bookmark-item"
        :class="{
          'drag-over-top': dropTarget === bm.id && dropPos === 'top',
          'drag-over-bottom': dropTarget === bm.id && dropPos === 'bottom',
          dragging: dragId === bm.id,
        }"
        draggable="true"
        @click="onItemClick(bm.path)"
        @contextmenu="onContextMenu($event, bm.id, bm.name)"
        @dragstart="onDragStart($event, bm.id)"
        @dragover="onDragOver($event, bm.id)"
        @dragleave="onDragLeave"
        @drop="onDrop($event, bm.id)"
        @dragend="onDragEnd"
      >
        <span class="bookmark-grip"><GripVertical :size="10" /></span>
        <!-- Inline rename -->
        <template v-if="ctxRenaming === bm.id">
          <input
            v-model="ctxRenameValue"
            class="bookmark-rename-input"
            @keydown.enter="ctxRenameCommit"
            @keydown.escape="ctxRenameCancel"
            @blur="ctxRenameCommit"
            autofocus
          />
        </template>
        <template v-else>
          <span class="bookmark-icon" v-if="bm.is_dir">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <path d="M1.5 3A1.5 1.5 0 0 1 3 1.5h3.146a.5.5 0 0 1 .354.146L7.854 3H13A1.5 1.5 0 0 1 14.5 4.5v7A1.5 1.5 0 0 1 13 13H3A1.5 1.5 0 0 1 1.5 11.5v-8.5Z"/>
            </svg>
          </span>
          <span class="bookmark-icon" v-else>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <path d="M4 1.5H3a2 2 0 0 0-2 2V14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V3.5a2 2 0 0 0-2-2h-1v1h1a1 1 0 0 1 1 1V14a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V3.5a1 1 0 0 1 1-1h1v-1Z"/>
              <path d="M9.5 1a.5.5 0 0 1 .5.5v1a.5.5 0 0 1-.5.5h-3a.5.5 0 0 1-.5-.5v-1a.5.5 0 0 1 .5-.5h3Zm-3-1A1.5 1.5 0 0 0 5 1.5v1A1.5 1.5 0 0 0 6.5 4h3A1.5 1.5 0 0 0 11 2.5v-1A1.5 1.5 0 0 0 9.5 0h-3Z"/>
            </svg>
          </span>
          <span class="bookmark-name">{{ bm.name }}</span>
        </template>
      </div>
    </template>
  </div>

  <!-- Context menu -->
  <Teleport to="body">
    <div
      v-if="ctxMenu"
      class="bookmark-ctx-backdrop"
      @click="closeCtxMenu"
      @contextmenu.prevent="closeCtxMenu"
    >
      <div
        class="bookmark-ctx-menu"
        :style="{ left: ctxMenu.x + 'px', top: ctxMenu.y + 'px' }"
      >
        <button class="tree-ctx-item" @click="ctxRename">
          <span class="tree-ctx-label">{{ t('fileBookmark.rename') }}</span>
        </button>
        <div class="tree-ctx-sep" />
        <button class="tree-ctx-item tree-ctx-danger" @click="ctxRemove">
          <span class="tree-ctx-label">{{ t('fileBookmark.removeFrom') }}</span>
        </button>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.bookmark-section {
  border-bottom: 1px solid var(--border, #3c3c3c);
  padding-bottom: 2px;
  margin-bottom: 2px;
}

.bookmark-section-header {
  display: flex;
  align-items: center;
  height: var(--tree-row-height, 22px);
  padding: 0 var(--tree-base-hpad, 8px);
  gap: 4px;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--fg-muted, #858585);
  cursor: pointer;
  user-select: none;
}
.bookmark-section-header:hover {
  background: var(--tree-row-hover, rgba(255,255,255,0.06));
}

.bookmark-twistie {
  font-size: 10px;
  width: var(--tree-twistie-size, 16px);
  text-align: center;
  flex-shrink: 0;
}

.bookmark-section-title {
  flex: 1;
}

.bookmark-section-count {
  font-size: 10px;
  font-weight: 400;
  opacity: 0.6;
}

.bookmark-empty {
  padding: 6px calc(var(--tree-base-hpad, 8px) + var(--tree-indent-step, 8px));
  font-size: 11px;
  color: var(--fg-muted, #858585);
  font-style: italic;
}

.bookmark-item {
  display: flex;
  align-items: center;
  height: var(--tree-row-height, 22px);
  padding: 0 8px 0 calc(var(--tree-base-hpad, 8px) + var(--tree-indent-step, 8px));
  font-size: 12px;
  font-family: var(--font-mono, monospace);
  color: var(--fg, #cccccc);
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
  border-top: 1px solid transparent;
  border-bottom: 1px solid transparent;
}
.bookmark-item:hover {
  background: var(--tree-row-hover, rgba(255,255,255,0.06));
}
.bookmark-item.drag-over-top {
  border-top-color: var(--accent, #89b4fa);
}
.bookmark-item.drag-over-bottom {
  border-bottom-color: var(--accent, #89b4fa);
}
.bookmark-item.dragging {
  opacity: 0.4;
}

.bookmark-grip {
  display: inline-flex;
  align-items: center;
  color: var(--fg-muted, #858585);
  cursor: grab;
  margin-right: 4px;
  flex-shrink: 0;
  opacity: 0;
  transition: opacity 0.15s;
}
.bookmark-item:hover .bookmark-grip {
  opacity: 1;
}

.bookmark-icon {
  display: inline-flex;
  align-items: center;
  flex-shrink: 0;
  margin-right: 6px;
  color: var(--tree-folder-icon, #dcb67a);
}
.bookmark-icon svg {
  width: var(--tree-icon-size, 16px);
  height: var(--tree-icon-size, 16px);
}

.bookmark-name {
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}

.bookmark-rename-input {
  flex: 1;
  min-width: 0;
  font-size: 12px;
  padding: 1px 4px;
  border: 1px solid var(--accent, #89b4fa);
  border-radius: 2px;
  background: var(--bg-surface, #141414);
  color: var(--fg, #ccc);
  outline: none;
  font-family: var(--font-mono, monospace);
}

/* Context menu */
.bookmark-ctx-backdrop {
  position: fixed;
  inset: 0;
  z-index: 100000;
}
.bookmark-ctx-menu {
  position: fixed;
  min-width: 180px;
  background: #252526;
  border: 1px solid #3c3c3c;
  border-radius: 6px;
  box-shadow: 0 8px 24px rgba(0,0,0,0.45);
  padding: 4px 0;
  z-index: 100001;
}
.bookmark-ctx-menu .tree-ctx-item {
  display: flex;
  align-items: center;
  width: 100%;
  border: none;
  background: none;
  padding: 5px 14px;
  font-size: 13px;
  color: #cccccc;
  cursor: pointer;
  text-align: left;
}
.bookmark-ctx-menu .tree-ctx-item:hover {
  background: #094771;
  color: #ffffff;
}
.bookmark-ctx-menu .tree-ctx-danger:hover {
  background: #5a1d1d;
  color: #ffcccc;
}
.bookmark-ctx-menu .tree-ctx-sep {
  height: 1px;
  background: #3c3c3c;
  margin: 4px 0;
}
</style>
