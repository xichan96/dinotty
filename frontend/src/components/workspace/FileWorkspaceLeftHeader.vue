<template>
  <div class="file-workspace-tree-head" :class="{ narrow }">
    <template v-if="mode === 'search'">
      <span class="file-workspace-tree-title">{{ t('workspaceSearch.title') }}</span>
      <button
        type="button"
        class="file-workspace-tree-close"
        data-testid="tree-head-search-close"
        :title="t('workspaceSearch.close')"
        :aria-label="t('workspaceSearch.close')"
        @click="$emit('close-search')"
      >
        <X :size="14" />
      </button>
    </template>
    <div v-else class="fw-mode-segmented" role="group">
      <button
        type="button"
        class="fw-mode-btn"
        :class="{ on: mode === 'tree' }"
        data-testid="left-mode-files"
        @click="$emit('switch-files')"
      >
        {{ t('workspaceChanges.modeFiles') }}
      </button>
      <button
        type="button"
        class="fw-mode-btn"
        :class="{ on: mode === 'changes' }"
        data-testid="left-mode-changes"
        @click="$emit('switch-changes')"
      >
        {{ t('workspaceChanges.modeChanges') }}
        <span v-if="changeCount" class="fw-mode-count">{{ changeCount }}</span>
      </button>
    </div>

    <div v-if="mode === 'tree'" class="file-workspace-tree-actions">
      <button
        type="button"
        data-testid="tree-head-search"
        :title="t('workspaceSearch.open')"
        :aria-label="t('workspaceSearch.open')"
        @click="$emit('open-search')"
      >
        <Search :size="14" />
      </button>
      <button
        type="button"
        data-testid="tree-head-new-file"
        :title="t('filePreview.newFile')"
        :aria-label="t('filePreview.newFile')"
        @click="$emit('new-file')"
      >
        <FilePlus :size="14" />
      </button>
      <button
        type="button"
        data-testid="tree-head-new-folder"
        :title="t('filePreview.newFolder')"
        :aria-label="t('filePreview.newFolder')"
        @click="$emit('new-folder')"
      >
        <FolderPlus :size="14" />
      </button>
      <button
        type="button"
        data-testid="tree-head-refresh"
        :class="{ spinning: refreshBusy }"
        :title="t('filePreview.refresh')"
        :aria-label="t('filePreview.refresh')"
        @click="$emit('refresh')"
      >
        <RotateCw :size="14" />
      </button>
      <button
        type="button"
        data-testid="tree-head-collapse-all"
        :title="t('filePreview.collapseAll')"
        :aria-label="t('filePreview.collapseAll')"
        @click="$emit('collapse-all')"
      >
        <ChevronsDownUp :size="14" />
      </button>
    </div>
    <div v-else-if="mode === 'changes'" class="file-workspace-tree-actions">
      <button
        type="button"
        data-testid="changes-head-refresh"
        :class="{ spinning: refreshBusy }"
        :title="t('workspaceChanges.refresh')"
        :aria-label="t('workspaceChanges.refresh')"
        @click="$emit('refresh')"
      >
        <RotateCw :size="14" />
      </button>
    </div>

    <button
      v-if="narrow"
      type="button"
      class="file-workspace-tree-close"
      :title="t('filePreview.closeTree')"
      :aria-label="t('filePreview.closeTree')"
      @click="$emit('close-drawer')"
    >
      <X :size="14" />
    </button>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from '../../composables/useI18n'
import { ChevronsDownUp, FilePlus, FolderPlus, RotateCw, Search, X } from 'lucide-vue-next'

defineProps<{
  mode: 'tree' | 'changes' | 'search'
  changeCount: number
  refreshBusy: boolean
  narrow: boolean
}>()

defineEmits<{
  'switch-files': []
  'switch-changes': []
  'open-search': []
  'new-file': []
  'new-folder': []
  refresh: []
  'collapse-all': []
  'close-search': []
  'close-drawer': []
}>()

const { t } = useI18n()
</script>

<style scoped>
/*
 * The header root inherits the parent's scoped styles, but its descendants do
 * not. Restate the action/close/title rules the parent's CSS applies to those
 * descendants so the extracted header looks identical to the inline markup.
 */
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

.file-workspace-tree-head:hover .file-workspace-tree-actions,
.file-workspace-tree-head.narrow .file-workspace-tree-actions {
  opacity: 1;
}

.file-workspace-tree-actions button,
.file-workspace-tree-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 24px;
  height: 24px;
  padding: 0;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--fg-muted, #888);
  cursor: pointer;
}

.file-workspace-tree-actions button:hover,
.file-workspace-tree-close:hover {
  background: var(--tab-hover-bg, #333);
  color: var(--fg, #ccc);
}

.file-workspace-tree-actions button.spinning svg {
  animation: fw-head-spin 0.7s linear infinite;
}

@keyframes fw-head-spin {
  to {
    transform: rotate(360deg);
  }
}

.fw-mode-segmented {
  display: flex;
  align-items: center;
  gap: 2px;
  flex: 1;
  min-width: 0;
  padding: 2px;
  border-radius: 5px;
  background: var(--tab-bg, #232328);
}

.fw-mode-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  padding: 2px 8px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--fg-muted, #888);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.4px;
  text-transform: uppercase;
  cursor: pointer;
}

.fw-mode-btn:hover {
  color: var(--fg, #ccc);
}

.fw-mode-btn.on {
  background: var(--tab-hover-bg, #333);
  color: var(--fg, #ddd);
}

.fw-mode-count {
  padding: 0 4px;
  border-radius: 7px;
  background: var(--badge-bg, rgba(255, 255, 255, 0.12));
  color: var(--fg-muted, #bbb);
  font-size: 10px;
  line-height: 14px;
  letter-spacing: 0;
}
</style>
