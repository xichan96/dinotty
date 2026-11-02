<template>
  <div
    ref="rootEl"
    class="file-workspace-tree-head"
    :class="{ narrow, 'fw-head-tiny': tier === 'tiny' }"
  >
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
    <template v-else>
      <div class="fw-mode-segmented" role="group" :aria-label="t('workspaceChanges.title')">
        <button
          type="button"
          class="fw-mode-btn"
          :class="{ on: mode === 'tree' }"
          data-testid="left-mode-files"
          :title="t('workspaceChanges.modeFiles')"
          :aria-label="t('workspaceChanges.modeFiles')"
          :aria-pressed="mode === 'tree'"
          @click="$emit('switch-files')"
        >
          <Folder :size="14" />
        </button>
        <button
          type="button"
          class="fw-mode-btn"
          :class="{ on: mode === 'changes' }"
          data-testid="left-mode-changes"
          :title="t('workspaceChanges.modeChanges')"
          :aria-label="t('workspaceChanges.modeChanges')"
          :aria-pressed="mode === 'changes'"
          @click="$emit('switch-changes')"
        >
          <GitCompare :size="14" />
          <span v-if="changeCount && tier !== 'tiny'" class="fw-mode-count">{{ changeCount }}</span>
        </button>
      </div>

      <div v-if="mode === 'tree'" class="file-workspace-tree-actions">
        <button
          v-if="inline('search')"
          type="button"
          data-testid="tree-head-search"
          :title="t('workspaceSearch.open')"
          :aria-label="t('workspaceSearch.open')"
          @click="$emit('open-search')"
        >
          <Search :size="14" />
        </button>
        <button
          v-if="inline('new-file')"
          type="button"
          data-testid="tree-head-new-file"
          :title="t('filePreview.newFile')"
          :aria-label="t('filePreview.newFile')"
          @click="$emit('new-file')"
        >
          <FilePlus :size="14" />
        </button>
        <button
          v-if="inline('new-folder')"
          type="button"
          data-testid="tree-head-new-folder"
          :title="t('filePreview.newFolder')"
          :aria-label="t('filePreview.newFolder')"
          @click="$emit('new-folder')"
        >
          <FolderPlus :size="14" />
        </button>
        <button
          v-if="inline('refresh')"
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
          v-if="inline('collapse')"
          type="button"
          data-testid="tree-head-collapse-all"
          :title="t('filePreview.collapseAll')"
          :aria-label="t('filePreview.collapseAll')"
          @click="$emit('collapse-all')"
        >
          <ChevronsDownUp :size="14" />
        </button>
        <div v-if="overflowItems.length" class="fw-more">
          <button
            type="button"
            data-testid="tree-head-more"
            :title="t('workspaceChanges.moreActions')"
            :aria-label="t('workspaceChanges.moreActions')"
            aria-haspopup="menu"
            :aria-expanded="menuOpen"
            @click.stop="toggleMenu"
          >
            <MoreHorizontal :size="14" />
          </button>
          <div v-if="menuOpen" class="fw-more-menu" role="menu" @click.stop>
            <button
              v-for="item in overflowItems"
              :key="item.action"
              type="button"
              role="menuitem"
              :data-testid="`tree-head-menu-${item.action}`"
              @click="runAction(item.action)"
            >
              <component :is="item.icon" :size="14" />
              <span>{{ t(item.labelKey) }}</span>
            </button>
          </div>
        </div>
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
    </template>

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
import { computed, onBeforeUnmount, onMounted, ref, watch, type Component } from 'vue'
import {
  ChevronsDownUp,
  FilePlus,
  Folder,
  FolderPlus,
  GitCompare,
  MoreHorizontal,
  RotateCw,
  Search,
  X,
} from 'lucide-vue-next'
import { useI18n } from '../../composables/useI18n'
import {
  hiddenTreeActions,
  leftHeaderTier,
  type LeftHeaderAction,
  type LeftHeaderTier,
} from './leftHeaderLayout'

const props = defineProps<{
  mode: 'tree' | 'changes' | 'search'
  changeCount: number
  refreshBusy: boolean
  narrow: boolean
}>()

const emit = defineEmits<{
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

const rootEl = ref<HTMLElement | null>(null)
const headWidth = ref(0)
const tier = computed<LeftHeaderTier>(() => leftHeaderTier(headWidth.value))
const menuOpen = ref(false)

const ACTION_META: Record<LeftHeaderAction, { icon: Component; labelKey: string }> = {
  search: { icon: Search, labelKey: 'workspaceSearch.menuLabel' },
  'new-file': { icon: FilePlus, labelKey: 'filePreview.newFile' },
  'new-folder': { icon: FolderPlus, labelKey: 'filePreview.newFolder' },
  refresh: { icon: RotateCw, labelKey: 'filePreview.refresh' },
  collapse: { icon: ChevronsDownUp, labelKey: 'filePreview.collapseAll' },
}

const overflowItems = computed(() =>
  hiddenTreeActions(tier.value).map((action) => ({ action, ...ACTION_META[action] }))
)

function inline(action: LeftHeaderAction): boolean {
  return !hiddenTreeActions(tier.value).includes(action)
}

function runAction(action: LeftHeaderAction): void {
  closeMenu()
  switch (action) {
    case 'search':
      emit('open-search')
      break
    case 'new-file':
      emit('new-file')
      break
    case 'new-folder':
      emit('new-folder')
      break
    case 'refresh':
      emit('refresh')
      break
    case 'collapse':
      emit('collapse-all')
      break
  }
}

function onDocumentClick(): void {
  closeMenu()
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') closeMenu()
}

function openMenu(): void {
  if (menuOpen.value) return
  menuOpen.value = true
  // Defer so the opening click does not immediately close the menu.
  setTimeout(() => {
    if (!menuOpen.value) return
    document.addEventListener('click', onDocumentClick)
    document.addEventListener('keydown', onKeydown)
  }, 0)
}

function closeMenu(): void {
  if (!menuOpen.value) return
  menuOpen.value = false
  document.removeEventListener('click', onDocumentClick)
  document.removeEventListener('keydown', onKeydown)
}

function toggleMenu(): void {
  if (menuOpen.value) closeMenu()
  else openMenu()
}

// The menu is only meaningful for tree mode and while some action is hidden.
watch([tier, () => props.mode, overflowItems], closeMenu)

let resizeObserver: ResizeObserver | null = null

function measure(): void {
  headWidth.value = rootEl.value?.getBoundingClientRect().width ?? 0
}

onMounted(() => {
  measure()
  if (typeof ResizeObserver !== 'function' || !rootEl.value) return
  resizeObserver = new ResizeObserver(measure)
  resizeObserver.observe(rootEl.value)
})

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  closeMenu()
})
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

/* Tiny panes: reclaim the last few pixels so the icon switch, ⋯ and close fit. */
.file-workspace-tree-head.fw-head-tiny {
  gap: 3px;
  padding-left: 8px;
  padding-right: 2px;
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

/*
 * Icon-only switch: the pill hugs its two buttons instead of stretching across
 * the header, so the free space stays as plain header background.
 */
.fw-mode-segmented {
  display: flex;
  align-items: center;
  gap: 2px;
  flex: none;
  margin-right: auto;
  padding: 2px;
  border-radius: 5px;
  background: var(--tab-bg, #232328);
}

.fw-mode-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  flex: none;
  height: 22px;
  padding: 2px 5px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--fg-muted, #888);
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

.fw-more {
  position: static;
}

.fw-more-menu {
  position: absolute;
  top: calc(100% + 2px);
  right: 4px;
  z-index: 40;
  width: max-content;
  max-width: calc(100% - 8px);
  padding: 4px;
  background: var(--bg-surface, #252526);
  border: 1px solid var(--border, #3c3c3c);
  border-radius: 6px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
}

.fw-more-menu button {
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  height: 28px;
  padding: 0 8px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--fg, #ccc);
  font-size: 12px;
  font-weight: 400;
  letter-spacing: 0;
  text-align: left;
  text-transform: none;
  white-space: nowrap;
  cursor: pointer;
}

.fw-more-menu button:hover {
  background: var(--tab-hover-bg, #2a2a2c);
  color: var(--fg-bright, #d0d0d0);
}

.fw-more-menu svg {
  flex: none;
  color: var(--fg-muted, #888);
}
</style>
