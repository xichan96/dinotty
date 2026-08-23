<script setup lang="ts">
import { ref } from 'vue'
import { Clock } from 'lucide-vue-next'
import { useRecentFiles } from '../../composables/useRecentAccess'
import { useI18n } from '../../composables/useI18n'
import { settings } from '../../composables/useSettings'
import { uiConfirm } from '../../composables/useConfirm'

const emit = defineEmits<{
  navigate: [path: string]
}>()

const { t } = useI18n()
const { clearFiles, removeFile, formatRelativeTime } = useRecentFiles()

const collapsed = ref(false)

// Context menu
const ctxMenu = ref<{ x: number; y: number; path: string; name: string } | null>(null)

function toggleCollapse() {
  collapsed.value = !collapsed.value
}

function onItemClick(path: string) {
  emit('navigate', path)
}

async function onClear() {
  const ok = await uiConfirm(t('recent.clearConfirm'), {
    confirmText: t('recent.confirmOk'),
    cancelText: t('recent.cancel'),
  })
  if (ok) clearFiles()
}

function onContextMenu(e: MouseEvent, path: string, name: string) {
  e.preventDefault()
  ctxMenu.value = { x: e.clientX, y: e.clientY, path, name }
}

function closeCtxMenu() {
  ctxMenu.value = null
}

function ctxRemove() {
  if (!ctxMenu.value) return
  removeFile(ctxMenu.value.path)
  closeCtxMenu()
}
</script>

<template>
  <div v-if="settings.recent_files.length > 0 || !collapsed" class="recent-section">
    <!-- Section header -->
    <div class="recent-section-header" @click="toggleCollapse">
      <span class="recent-twistie">{{ collapsed ? '▶' : '▼' }}</span>
      <Clock :size="12" />
      <span class="recent-section-title">{{ t('recent.title') }}</span>
      <span v-if="settings.recent_files.length > 0" class="recent-section-count">{{
        settings.recent_files.length
      }}</span>
      <button
        v-if="settings.recent_files.length > 0 && !collapsed"
        class="recent-clear-btn"
        @click.stop="onClear"
      >
        {{ t('recent.clear') }}
      </button>
    </div>

    <!-- Recent list -->
    <template v-if="!collapsed">
      <div
        v-for="entry in settings.recent_files"
        :key="entry.path_or_url"
        class="recent-item"
        @click="onItemClick(entry.path_or_url)"
        @contextmenu="onContextMenu($event, entry.path_or_url, entry.name)"
      >
        <span class="recent-icon">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <path
              d="M4 1.5H3a2 2 0 0 0-2 2V14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V3.5a2 2 0 0 0-2-2h-1v1h1a1 1 0 0 1 1 1V14a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V3.5a1 1 0 0 1 1-1h1v-1Z"
            />
            <path
              d="M9.5 1a.5.5 0 0 1 .5.5v1a.5.5 0 0 1-.5.5h-3a.5.5 0 0 1-.5-.5v-1a.5.5 0 0 1 .5-.5h3Zm-3-1A1.5 1.5 0 0 0 5 1.5v1A1.5 1.5 0 0 0 6.5 4h3A1.5 1.5 0 0 0 11 2.5v-1A1.5 1.5 0 0 0 9.5 0h-3Z"
            />
          </svg>
        </span>
        <span class="recent-name">{{ entry.name }}</span>
        <span class="recent-time">{{ formatRelativeTime(entry.visited_at, t) }}</span>
      </div>
    </template>
  </div>

  <!-- Context menu -->
  <Teleport to="body">
    <div
      v-if="ctxMenu"
      class="recent-ctx-backdrop"
      @click="closeCtxMenu"
      @contextmenu.prevent="closeCtxMenu"
    >
      <div class="recent-ctx-menu" :style="{ left: ctxMenu.x + 'px', top: ctxMenu.y + 'px' }">
        <button class="tree-ctx-item tree-ctx-danger" @click="ctxRemove">
          <span class="tree-ctx-label">{{ t('recent.removeFromHistory') }}</span>
        </button>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.recent-section {
  border-bottom: 1px solid var(--border);
  padding-bottom: 2px;
  margin-bottom: 2px;
}

.recent-section-header {
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
.recent-section-header:hover {
  background: var(--tree-row-hover));
}

.recent-twistie {
  font-size: 10px;
  width: var(--tree-twistie-size, 16px);
  text-align: center;
  flex-shrink: 0;
}

.recent-section-title {
  flex: 1;
}

.recent-section-count {
  font-size: 10px;
  font-weight: 400;
  opacity: 0.6;
}

.recent-clear-btn {
  border: none;
  background: none;
  color: var(--fg-muted, #858585);
  font-size: 10px;
  cursor: pointer;
  padding: 0 4px;
}
.recent-clear-btn:hover {
  color: var(--color-red, #f44747);
}

.recent-item {
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
}
.recent-item:hover {
  background: var(--tree-row-hover));
}

.recent-icon {
  display: inline-flex;
  align-items: center;
  flex-shrink: 0;
  margin-right: 6px;
  color: var(--tree-file-icon, #90caf9);
}
.recent-icon svg {
  width: var(--tree-icon-size, 16px);
  height: var(--tree-icon-size, 16px);
}

.recent-name {
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
  flex: 1;
}

.recent-time {
  margin-left: auto;
  font-size: 10px;
  color: var(--fg-muted, #858585);
  font-family:
    system-ui,
    -apple-system,
    sans-serif;
  flex-shrink: 0;
  padding-left: 8px;
}

/* Context menu */
.recent-ctx-backdrop {
  position: fixed;
  inset: 0;
  z-index: 100000;
}
.recent-ctx-menu {
  position: fixed;
  min-width: 180px;
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: 6px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
  padding: 4px 0;
  z-index: 100001;
}
.recent-ctx-menu .tree-ctx-item {
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
.recent-ctx-menu .tree-ctx-item:hover {
  background: #094771;
  color: #ffffff;
}
.recent-ctx-menu .tree-ctx-danger:hover {
  background: #5a1d1d;
  color: #ffcccc;
}
.recent-ctx-menu .tree-ctx-sep {
  height: 1px;
  background: var(--border);
  margin: 4px 0;
}
</style>
