<script setup lang="ts">
import { computed, ref } from 'vue'
import { Star, Clock } from 'lucide-vue-next'
import { useWebBookmarks } from '../../composables/useWebBookmarks'
import { useRecentUrls } from '../../composables/useRecentAccess'
import { useI18n } from '../../composables/useI18n'
import { settings } from '../../composables/useSettings'

const props = defineProps<{
  visible: boolean
}>()

const emit = defineEmits<{
  select: [url: string]
  close: []
}>()

const { t } = useI18n()
const { bookmarks, removeBookmark, renameBookmark, addBookmark } = useWebBookmarks()
const { removeUrl } = useRecentUrls()

const hasContent = computed(() => bookmarks.value.length > 0 || settings.recent_urls.length > 0)

function onSelect(url: string) {
  emit('select', url)
}

function formatTime(visitedAt: number): string {
  const now = Math.floor(Date.now() / 1000)
  const diff = now - visitedAt
  if (diff < 60) return t('recent.justNow')
  if (diff < 3600) return t('recent.minutesAgo').replace('{n}', String(Math.floor(diff / 60)))
  if (diff < 86400) return t('recent.hoursAgo').replace('{n}', String(Math.floor(diff / 3600)))
  if (diff < 172800) return t('recent.yesterday')
  const d = new Date(visitedAt * 1000)
  return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// Context menu
const ctxMenu = ref<{ x: number; y: number; type: 'bookmark' | 'recent'; id?: string; url?: string } | null>(null)

function onItemContext(e: MouseEvent, type: 'bookmark' | 'recent', id?: string, url?: string) {
  e.preventDefault()
  ctxMenu.value = { x: e.clientX, y: e.clientY, type, id, url }
}

function closeCtxMenu() {
  ctxMenu.value = null
}

function ctxRenameBookmark() {
  if (!ctxMenu.value?.id) return
  const bm = bookmarks.value.find(b => b.id === ctxMenu.value!.id)
  if (!bm) return
  const newName = prompt(t('webBookmark.rename'), bm.name)
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

function ctxAddToBookmarks() {
  if (!ctxMenu.value?.url) return
  const name = (() => {
    try { return new URL(ctxMenu.value.url).hostname } catch { return ctxMenu.value.url }
  })()
  addBookmark(name, ctxMenu.value.url)
  closeCtxMenu()
}

function ctxRemoveRecent() {
  if (!ctxMenu.value?.url) return
  removeUrl(ctxMenu.value.url)
  closeCtxMenu()
}
</script>

<template>
  <div v-if="visible && hasContent" class="address-dropdown">
    <!-- Bookmarks section -->
    <template v-if="bookmarks.length > 0">
      <div class="address-dropdown-section">
        <Star :size="12" />
        <span>{{ t('webBookmark.section') }}</span>
      </div>
      <div
        v-for="bm in bookmarks"
        :key="bm.id"
        class="address-dropdown-item"
        @click="onSelect(bm.url)"
        @contextmenu="onItemContext($event, 'bookmark', bm.id)"
      >
        <span class="address-dropdown-url">{{ bm.name }}</span>
      </div>
    </template>

    <!-- Recent URLs section -->
    <template v-if="settings.recent_urls.length > 0">
      <div class="address-dropdown-section">
        <Clock :size="12" />
        <span>{{ t('recent.urlSection') }}</span>
      </div>
      <div
        v-for="entry in settings.recent_urls"
        :key="entry.path_or_url"
        class="address-dropdown-item"
        @click="onSelect(entry.path_or_url)"
        @contextmenu="onItemContext($event, 'recent', undefined, entry.path_or_url)"
      >
        <span class="address-dropdown-url">{{ entry.name }}</span>
        <span class="address-dropdown-time">{{ formatTime(entry.visited_at) }}</span>
      </div>
    </template>
  </div>

  <!-- Context menu -->
  <Teleport to="body">
    <div
      v-if="ctxMenu"
      class="address-ctx-backdrop"
      @click="closeCtxMenu"
      @contextmenu.prevent="closeCtxMenu"
    >
      <div
        class="address-ctx-menu"
        :style="{ left: ctxMenu.x + 'px', top: ctxMenu.y + 'px' }"
      >
        <template v-if="ctxMenu.type === 'bookmark'">
          <button class="tree-ctx-item" @click="ctxRenameBookmark">
            <span class="tree-ctx-label">{{ t('webBookmark.rename') }}</span>
          </button>
          <div class="tree-ctx-sep" />
          <button class="tree-ctx-item tree-ctx-danger" @click="ctxRemoveBookmark">
            <span class="tree-ctx-label">{{ t('webBookmark.removeFrom') }}</span>
          </button>
        </template>
        <template v-else>
          <button class="tree-ctx-item" @click="ctxAddToBookmarks">
            <span class="tree-ctx-label">{{ t('recent.addToBookmark') }}</span>
          </button>
          <div class="tree-ctx-sep" />
          <button class="tree-ctx-item tree-ctx-danger" @click="ctxRemoveRecent">
            <span class="tree-ctx-label">{{ t('recent.removeFromHistory') }}</span>
          </button>
        </template>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.address-dropdown {
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

.address-dropdown-section {
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
.address-dropdown-section svg {
  opacity: 0.6;
}

.address-dropdown-item {
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
.address-dropdown-item:hover {
  background: var(--tab-hover-bg, #2A2A2C);
}

.address-dropdown-url {
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
  flex: 1;
}

.address-dropdown-time {
  margin-left: auto;
  font-size: 11px;
  color: var(--fg-muted, #858585);
  font-family: system-ui, -apple-system, sans-serif;
  flex-shrink: 0;
}

/* Context menu */
.address-ctx-backdrop {
  position: fixed;
  inset: 0;
  z-index: 100000;
}
.address-ctx-menu {
  position: fixed;
  min-width: 180px;
  background: #252526;
  border: 1px solid #3c3c3c;
  border-radius: 6px;
  box-shadow: 0 8px 24px rgba(0,0,0,0.45);
  padding: 4px 0;
  z-index: 100001;
}
.address-ctx-menu .tree-ctx-item {
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
.address-ctx-menu .tree-ctx-item:hover {
  background: #094771;
  color: #ffffff;
}
.address-ctx-menu .tree-ctx-danger:hover {
  background: #5a1d1d;
  color: #ffcccc;
}
.address-ctx-menu .tree-ctx-sep {
  height: 1px;
  background: #3c3c3c;
  margin: 4px 0;
}
</style>
