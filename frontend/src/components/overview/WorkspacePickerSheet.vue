<template>
  <BaseDialog
    :visible="visible"
    variant="bottom-sheet"
    dialog-class="ws-picker-sheet"
    :closable="false"
    :close-on-backdrop="true"
    :close-on-escape="true"
    @close="emit('close')"
  >
    <div class="ws-picker">
      <div class="ws-picker-grab" aria-hidden="true" />
      <div class="ws-picker-head">
        <span class="ws-picker-title">
          {{ query.trim() ? t('workspace.search') : t('workspace.switch') }}
        </span>
        <button
          class="ws-picker-close"
          type="button"
          :aria-label="t('dialog.close')"
          @click="emit('close')"
        >
          <X :size="18" />
        </button>
      </div>

      <label class="ws-picker-search">
        <Search :size="14" class="ws-picker-search-icon" />
        <input
          ref="searchRef"
          v-model="query"
          type="text"
          :placeholder="t('workspace.searchPlaceholder')"
          :aria-label="t('workspace.searchPlaceholder')"
          autocomplete="off"
          autocapitalize="off"
          spellcheck="false"
          @keydown.enter.prevent="selectFirstResult"
        />
        <button
          v-if="query"
          class="ws-picker-clear"
          type="button"
          :aria-label="t('workspace.clearSearch')"
          @click="clearQuery"
        >
          <X :size="13" />
        </button>
      </label>

      <div class="ws-picker-list" role="listbox" :aria-label="t('workspace.switch')">
        <template v-for="section in visibleSections" :key="section.key">
          <div class="ws-picker-section">{{ section.label }}</div>
          <button
            v-for="ws in section.items"
            :key="ws.id"
            class="ws-picker-row"
            :class="{ selected: ws.id === selectedId }"
            :data-ws-id="ws.id"
            type="button"
            role="option"
            :aria-selected="ws.id === selectedId"
            @click="choose(ws.id)"
          >
            <WorkspaceBadge
              :remote="!!ws.connection_id"
              :abbr="resolveAbbr(ws)"
              :color="resolveColor(ws)"
              :size="22"
            />
            <span class="ws-picker-row-main">
              <span class="ws-picker-row-name">
                <HighlightText :text="ws.name" :query="query" />
              </span>
              <span class="ws-picker-row-path">
                <HighlightText :text="ws.path || t('workspace.connectionNone')" :query="query" />
              </span>
            </span>
            <span v-if="tabCounts[ws.id]" class="ws-picker-row-count">
              {{ tabCounts[ws.id] }}
            </span>
            <Check v-if="ws.id === selectedId" :size="15" class="ws-picker-row-check" />
          </button>
        </template>
        <p v-if="!hasResults" class="ws-picker-empty">{{ t('workspace.noResults') }}</p>
      </div>

      <div class="ws-picker-footer">
        <button class="ws-picker-add" type="button" @click="emit('add')">
          <Plus :size="14" />
          <span>{{ t('workspace.add') }}</span>
        </button>
      </div>
    </div>
  </BaseDialog>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { Check, Plus, Search, X } from 'lucide-vue-next'
import { useI18n } from '../../composables/useI18n'
import { resolveAbbr, resolveColor } from '../../utils/workspaceIcon'
import type { Workspace } from '../../types/workspace'
import WorkspaceBadge from '../WorkspaceBadge.vue'
import HighlightText from './HighlightText.vue'
import BaseDialog from '../ui/BaseDialog.vue'

interface PickerSection {
  key: string
  label: string
  items: Workspace[]
}

const props = defineProps<{
  visible: boolean
  workspaces: Workspace[]
  selectedId: string | null
  tabCounts: Record<string, number>
  /** Most-recent-first workspace ids; stale ids are ignored. */
  recentIds: string[]
  /**
   * Focus the search field when the sheet opens. The header's browse button
   * passes false so tapping it does not summon the soft keyboard; the
   * dedicated search button passes true.
   */
  focusSearch?: boolean
}>()

const emit = defineEmits<{
  close: []
  select: [id: string]
  add: []
}>()

const { t } = useI18n()
const query = ref('')
const searchRef = ref<HTMLInputElement | null>(null)

const filtered = computed(() => {
  const q = query.value.trim().toLowerCase()
  if (!q) return []
  return props.workspaces.filter((ws) => `${ws.name} ${ws.path}`.toLowerCase().includes(q))
})

const visibleSections = computed<PickerSection[]>(() => {
  if (query.value.trim()) {
    return [
      {
        key: 'search',
        label: t('workspace.searchResults', { count: filtered.value.length }),
        items: filtered.value,
      },
    ]
  }

  const byId = new Map(props.workspaces.map((ws) => [ws.id, ws]))
  const recents = props.recentIds.map((id) => byId.get(id)).filter((ws): ws is Workspace => !!ws)
  const recentIds = new Set(recents.map((ws) => ws.id))
  const others = props.workspaces.filter((ws) => !recentIds.has(ws.id))
  const sections: PickerSection[] = []

  if (recents.length) {
    sections.push({ key: 'recent', label: t('workspace.recentUsed'), items: recents })
  }
  sections.push({
    key: 'all',
    label: recents.length ? t('workspace.others') : t('workspace.all'),
    items: others,
  })
  return sections
})

const hasResults = computed(() => visibleSections.value.some((section) => section.items.length > 0))

watch(
  () => props.visible,
  async (isOpen) => {
    if (!isOpen) return
    query.value = ''
    if (props.focusSearch === false) return
    await nextTick()
    searchRef.value?.focus()
  }
)

function choose(id: string) {
  emit('select', id)
}

function clearQuery() {
  query.value = ''
  searchRef.value?.focus()
}

function selectFirstResult() {
  const first = filtered.value[0]
  if (first) choose(first.id)
}
</script>

<style scoped>
.ws-picker {
  display: flex;
  flex: 1;
  min-height: 0;
  flex-direction: column;
}

.ws-picker-grab {
  flex: 0 0 auto;
  width: 36px;
  height: 4px;
  margin: 7px auto 0;
  border-radius: 2px;
  background: #555;
}

.ws-picker-head {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: space-between;
  padding: 3px 8px 1px 16px;
}

.ws-picker-title {
  color: var(--fg-bright);
  font-size: 14px;
  font-weight: 600;
}

.ws-picker-close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border: 0;
  border-radius: 10px;
  background: transparent;
  color: var(--text-muted, #888);
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
.ws-picker-close:hover,
.ws-picker-close:active {
  background: var(--bg-hover);
  color: var(--fg);
}

.ws-picker-search {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 8px;
  height: 40px;
  margin: 5px 12px 4px;
  padding: 0 10px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--bg-input);
  color: var(--text-muted, #888);
}

.ws-picker-search input {
  flex: 1;
  min-width: 0;
  border: 0;
  outline: none;
  background: none;
  color: var(--fg);
  font: inherit;
  /* 16px keeps iOS Safari from zooming the page when the field focuses. */
  font-size: 16px;
}
.ws-picker-search input::placeholder {
  color: var(--text-muted, #888);
}

.ws-picker-clear {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--text-muted, #888);
  cursor: pointer;
}
.ws-picker-clear:hover,
.ws-picker-clear:active {
  background: var(--bg-hover);
  color: var(--fg);
}

.ws-picker-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding-bottom: 4px;
  overscroll-behavior: contain;
}

.ws-picker-section {
  padding: 10px 16px 4px;
  color: var(--text-muted, #888);
  font-size: 9.5px;
  letter-spacing: 0.09em;
  text-transform: uppercase;
}

.ws-picker-row {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  min-height: 52px;
  padding: 8px 16px;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
.ws-picker-row:hover,
.ws-picker-row:active {
  background: var(--bg-hover);
}
.ws-picker-row.selected {
  background: var(--bg-surface-hover);
}

.ws-picker-row-main {
  display: flex;
  flex: 1;
  min-width: 0;
  flex-direction: column;
  gap: 2px;
}

.ws-picker-row-name {
  overflow: hidden;
  color: var(--fg-bright);
  font-size: 13px;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.ws-picker-row-path {
  overflow: hidden;
  color: var(--text-muted, #888);
  font-family: var(--font-mono, monospace);
  font-size: 10px;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.ws-picker-row-count {
  flex: 0 0 auto;
  min-width: 20px;
  padding: 1px 6px;
  border-radius: 8px;
  background: var(--bg-hover);
  color: var(--text-muted, #888);
  font-size: 10px;
  text-align: center;
}

.ws-picker-row-check {
  flex: 0 0 auto;
  color: var(--accent);
}

.ws-picker-empty {
  margin: 0;
  padding: 36px 20px;
  color: var(--text-muted, #888);
  font-size: 12.5px;
  text-align: center;
}

.ws-picker-footer {
  flex: 0 0 auto;
  padding: 8px 12px calc(12px + env(safe-area-inset-bottom, 0px));
  border-top: 1px solid var(--border);
}

.ws-picker-add {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  width: 100%;
  height: 42px;
  border: 1px dashed var(--border);
  border-radius: 10px;
  background: transparent;
  color: var(--text-muted, #888);
  font: inherit;
  font-size: 13px;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
.ws-picker-add:hover,
.ws-picker-add:active {
  border-color: var(--accent);
  background: var(--bg-hover);
  color: var(--fg);
}
</style>
