<script setup lang="ts">
import { computed, ref } from 'vue'
import { Star, Clock } from 'lucide-vue-next'
import { useWorkspaceBookmarks } from '../../composables/useWorkspaceBookmarks'
import { useRecentFiles } from '../../composables/useRecentAccess'
import { useI18n } from '../../composables/useI18n'
import { settings } from '../../composables/useSettings'

const props = defineProps<{
  visible: boolean
}>()

const emit = defineEmits<{
  select: [path: string]
  close: []
}>()

const { t } = useI18n()
const { bookmarks, removeBookmark, renameBookmark } = useWorkspaceBookmarks()
const { removeFile, clearFiles, formatRelativeTime } = useRecentFiles()

const hasContent = computed(() => bookmarks.value.length > 0 || settings.recent_files.length > 0)

function onSelect(path: string) {
  emit('select', path)
}

function onClear() {
  clearFiles()
  emit('close')
}

// Context menu
const ctxMenu = ref<{ x: number; y: number; type: 'bookmark' | 'recent'; id?: string; path?: string } | null>(null)

function onItemContext(e: MouseEvent, type: 'bookmark' | 'recent', id?: string, path?: string) {
  e.preventDefault()
  ctxMenu.value = { x: e.clientX, y: e.clientY, type, id, path }
}

function closeCtxMenu() {
  ctxMenu.value = null
}

function ctxRenameBookmark() {
  if (!ctxMenu.value?.id) return
  const bm = bookmarks.value.find(b => b.id === ctxMenu.value!.id)
  if (!bm) return
  const newName = prompt(t('fileBookmark.rename'), bm.name)
  if (newName && newName.trim()) {
    renameBookmark(bm.id, newName.trim())
  }
  closeCtxMenu()
}

function ctxRemoveBookmark() {
  if (!ctxMenu.value?.id) return
  removeBookmark(ctxMenu.value.id)
  closeCtxMenu()
}

function ctxRemoveRecent() {
  if (!ctxMenu.value?.path) return
  removeFile(ctxMenu.value.path)
  closeCtxMenu()
}
</script>

<template>
  <div v-if="visible && hasContent" class="file-cwd-dropdown">
    <!-- Bookmarks section -->
    <template v-if="bookmarks.length > 0">
      <div class="file-cwd-section">
        <Star :size="12" />
        <span>{{ t('fileBookmark.title') }}</span>
      </div>
      <div
        v-for="bm in bookmarks"
        :key="bm.id"
        class="file-cwd-item"
        @click="onSelect(bm.path)"
        @contextmenu="onItemContext($event, 'bookmark', bm.id)"
      >
        <span class="file-cwd-name">{{ bm.name }}</span>
      </div>
    </template>

    <!-- Recent files section -->
    <template v-if="settings.recent_files.length > 0">
      <div class="file-cwd-section">
        <Clock :size="12" />
        <span>{{ t('recent.title') }}</span>
        <button class="file-cwd-clear" @click="onClear">{{ t('recent.clear') }}</button>
      </div>
      <div
        v-for="entry in settings.recent_files"
        :key="entry.path_or_url"
        class="file-cwd-item"
        @click="onSelect(entry.path_or_url)"
        @contextmenu="onItemContext($event, 'recent', undefined, entry.path_or_url)"
      >
        <span class="file-cwd-name">{{ entry.name }}</span>
        <span class="file-cwd-time">{{ formatRelativeTime(entry.visited_at, t) }}</span>
      </div>
    </template>
  </div>

  <!-- Context menu -->
  <Teleport to="body">
    <div
      v-if="ctxMenu"
      class="file-cwd-ctx-backdrop"
      @click="closeCtxMenu"
      @contextmenu.prevent="closeCtxMenu"
    >
      <div
        class="file-cwd-ctx-menu"
        :style="{ left: ctxMenu.x + 'px', top: ctxMenu.y + 'px' }"
      >
        <template v-if="ctxMenu.type === 'bookmark'">
          <button class="tree-ctx-item" @click="ctxRenameBookmark">
            <span class="tree-ctx-label">{{ t('fileBookmark.rename') }}</span>
          </button>
          <div class="tree-ctx-sep" />
          <button class="tree-ctx-item tree-ctx-danger" @click="ctxRemoveBookmark">
            <span class="tree-ctx-label">{{ t('fileBookmark.removeFrom') }}</span>
          </button>
        </template>
        <template v-else>
          <button class="tree-ctx-item tree-ctx-danger" @click="ctxRemoveRecent">
            <span class="tree-ctx-label">{{ t('recent.removeFromHistory') }}</span>
          </button>
        </template>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.file-cwd-dropdown {
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  max-height: 300px;
  overflow-y: auto;
  background: var(--bg-surface, #252526);
  border: 1px solid var(--border, #3c3c3c);
  border-radius: 6px;
  box-shadow: 0 8px 24px rgba(0,0,0,0.4);
  z-index: 500;
  padding: 4px 0;
}

.file-cwd-section {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px 4px;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--fg-muted, #858585);
}
.file-cwd-section svg {
  opacity: 0.6;
}

.file-cwd-clear {
  margin-left: auto;
  border: none;
  background: none;
  color: var(--fg-muted, #858585);
  font-size: 10px;
  cursor: pointer;
  padding: 0;
}
.file-cwd-clear:hover {
  color: var(--color-red, #F44747);
}

.file-cwd-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  font-size: 12px;
  font-family: var(--font-mono, monospace);
  color: var(--fg, #cccccc);
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
}
.file-cwd-item:hover {
  background: var(--tab-hover-bg, #2A2A2C);
}

.file-cwd-name {
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
  flex: 1;
}

.file-cwd-time {
  margin-left: auto;
  font-size: 11px;
  color: var(--fg-muted, #858585);
  font-family: system-ui, -apple-system, sans-serif;
  flex-shrink: 0;
}

/* Context menu */
.file-cwd-ctx-backdrop {
  position: fixed;
  inset: 0;
  z-index: 100000;
}
.file-cwd-ctx-menu {
  position: fixed;
  min-width: 180px;
  background: #252526;
  border: 1px solid #3c3c3c;
  border-radius: 6px;
  box-shadow: 0 8px 24px rgba(0,0,0,0.45);
  padding: 4px 0;
  z-index: 100001;
}
.file-cwd-ctx-menu .tree-ctx-item {
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
.file-cwd-ctx-menu .tree-ctx-item:hover {
  background: #094771;
  color: #ffffff;
}
.file-cwd-ctx-menu .tree-ctx-danger:hover {
  background: #5a1d1d;
  color: #ffcccc;
}
.file-cwd-ctx-menu .tree-ctx-sep {
  height: 1px;
  background: #3c3c3c;
  margin: 4px 0;
}
</style>
