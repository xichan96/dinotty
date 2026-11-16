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
          {{
            managing
              ? t('workspace.manageTitle')
              : query.trim()
                ? t('workspace.search')
                : t('workspace.switch')
          }}
        </span>
        <div class="ws-picker-head-actions">
          <button
            v-if="!managing && !query.trim() && workspaces.length"
            class="ws-picker-manage-entry"
            type="button"
            @click="enterManage"
          >
            {{ t('workspace.manage') }}
          </button>
          <button v-else-if="managing" class="ws-picker-done" type="button" @click="exitManage">
            {{ t('workspace.done') }}
          </button>
          <button
            class="ws-picker-close"
            type="button"
            :aria-label="t('dialog.close')"
            @click="emit('close')"
          >
            <X :size="18" />
          </button>
        </div>
      </div>

      <label v-if="!managing" class="ws-picker-search">
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

      <div
        v-if="managing"
        ref="manageListRef"
        class="ws-picker-list ws-picker-list--manage"
        :aria-label="t('workspace.manageTitle')"
      >
        <p class="ws-picker-manage-hint">{{ t('workspace.reorderHint') }}</p>
        <div
          v-for="ws in managedWorkspaces"
          :key="ws.id"
          class="ws-picker-manage-row"
          :class="{
            dragging: ws.id === draggingId,
            'drag-over-top': ws.id === dragOverId && dragOverPos === 'before',
            'drag-over-bottom': ws.id === dragOverId && dragOverPos === 'after',
          }"
          :data-ws-manage-id="ws.id"
        >
          <span
            v-if="ws.id !== DEFAULT_WORKSPACE_ID"
            class="ws-picker-drag"
            role="button"
            tabindex="0"
            :aria-label="t('workspace.reorder')"
            @pointerdown="onDragPointerDown($event, ws.id)"
            @keydown.up.prevent="moveByKeyboard(ws.id, -1)"
            @keydown.down.prevent="moveByKeyboard(ws.id, 1)"
          >
            <GripVertical :size="15" />
          </span>
          <span v-else class="ws-picker-drag-spacer" aria-hidden="true" />
          <WorkspaceBadge
            :remote="!!ws.connection_id"
            :abbr="resolveAbbr(ws)"
            :color="resolveColor(ws)"
            :size="22"
          />
          <span class="ws-picker-row-main">
            <span class="ws-picker-row-name">{{ ws.name }}</span>
            <span class="ws-picker-row-path">
              {{ ws.path || t('workspace.connectionNone') }}
            </span>
          </span>
          <span v-if="ws.id === DEFAULT_WORKSPACE_ID" class="ws-picker-fixed-tag">
            {{ t('workspace.defaultFixed') }}
          </span>
          <button
            class="ws-picker-action"
            type="button"
            :title="t('palette.rename')"
            :aria-label="t('palette.rename')"
            @click="emit('rename', ws.id)"
          >
            <Pencil :size="14" />
          </button>
          <button
            v-if="ws.id !== DEFAULT_WORKSPACE_ID"
            class="ws-picker-action danger"
            type="button"
            :title="t('workspace.delete')"
            :aria-label="t('workspace.delete')"
            @click="requestDelete(ws)"
          >
            <Trash2 :size="14" />
          </button>
        </div>
      </div>

      <div v-else class="ws-picker-list" role="listbox" :aria-label="t('workspace.switch')">
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
import { computed, nextTick, onUnmounted, ref, watch } from 'vue'
import { Check, GripVertical, Pencil, Plus, Search, Trash2, X } from 'lucide-vue-next'
import { useI18n } from '../../composables/useI18n'
import { uiConfirm } from '../../composables/useConfirm'
import { DEFAULT_WORKSPACE_ID } from '../../composables/useWorkspaces'
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
  rename: [id: string]
  delete: [id: string]
  reorder: [ids: string[]]
}>()

const { t } = useI18n()
const query = ref('')
const searchRef = ref<HTMLInputElement | null>(null)

// ── Manage mode ─────────────────────────────────────────────────
//
// On a phone the vertical WorkspaceList (which owns the right-click menu and
// drag-to-reorder) is hidden; this sheet is the only workspace surface. Manage
// mode keeps that surface and adds the two missing operations: a delete button
// per row, and a drag handle for reordering. The default workspace is a fixed
// row: it can be renamed but never reordered or deleted, matching the backend,
// which only knows real workspace ids.

const managing = ref(false)
const manageListRef = ref<HTMLElement | null>(null)

const managedWorkspaces = computed(() => props.workspaces)

function enterManage() {
  managing.value = true
  query.value = ''
  searchRef.value?.blur()
}

function exitManage() {
  cleanupDrag()
  managing.value = false
}

function choose(id: string) {
  emit('select', id)
}

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
    if (!isOpen) {
      exitManage()
      query.value = ''
      return
    }
    query.value = ''
    if (props.focusSearch === false) return
    await nextTick()
    searchRef.value?.focus()
  }
)

function clearQuery() {
  query.value = ''
  searchRef.value?.focus()
}

function selectFirstResult() {
  const first = filtered.value[0]
  if (first) choose(first.id)
}

// …… Delete / rename ……

async function requestDelete(ws: Workspace) {
  if (ws.id === DEFAULT_WORKSPACE_ID) return
  const ok = await uiConfirm(t('workspace.confirmDelete').replace('{name}', ws.name), {
    title: t('workspace.delete'),
    confirmText: t('workspace.delete'),
    cancelText: t('filePreview.cancel'),
  })
  if (!ok) return
  emit('delete', ws.id)
}

// …… Drag reorder (pointer events; the desktop drag path is width-gated) ……

const draggingId = ref<string | null>(null)
const dragOverId = ref<string | null>(null)
const dragOverPos = ref<'before' | 'after' | null>(null)

function onDragPointerDown(e: PointerEvent, id: string) {
  if (e.button !== undefined && e.button !== 0) return
  e.preventDefault()
  e.stopPropagation()
  draggingId.value = id
  dragOverId.value = null
  dragOverPos.value = null

  window.addEventListener('pointermove', onDragPointerMove)
  window.addEventListener('pointerup', onDragPointerUp)
  window.addEventListener('pointercancel', onDragPointerCancel)
}

function onDragPointerMove(e: PointerEvent) {
  if (!draggingId.value) return
  e.preventDefault()

  const list = manageListRef.value
  if (list) {
    const rect = list.getBoundingClientRect()
    if (e.clientY < rect.top + 48) list.scrollTop -= 12
    else if (e.clientY > rect.bottom - 48) list.scrollTop += 12
  }

  const hit =
    typeof document.elementFromPoint === 'function'
      ? document.elementFromPoint(e.clientX, e.clientY)
      : null
  const row = hit?.closest?.('[data-ws-manage-id]') as HTMLElement | null
  const toId = row?.dataset.wsManageId
  if (!row || !toId || toId === draggingId.value) {
    dragOverId.value = null
    dragOverPos.value = null
    return
  }
  const rowRect = row.getBoundingClientRect()
  dragOverId.value = toId
  dragOverPos.value = e.clientY < rowRect.top + rowRect.height / 2 ? 'before' : 'after'
}

function onDragPointerUp() {
  const fromId = draggingId.value
  const toId = dragOverId.value
  const pos = dragOverPos.value
  cleanupDrag()
  if (!fromId || !toId || fromId === toId || !pos) return

  const full = props.workspaces.map((ws) => ws.id)
  const fromIdx = full.indexOf(fromId)
  const toIdx = full.indexOf(toId)
  if (fromIdx < 0 || toIdx < 0) return

  const next = [...full]
  next.splice(fromIdx, 1)
  const targetIdx = next.indexOf(toId)
  next.splice(pos === 'before' ? targetIdx : targetIdx + 1, 0, fromId)

  // The default workspace is pinned above the reorderable range.
  const defaultIdx = next.indexOf(DEFAULT_WORKSPACE_ID)
  if (defaultIdx > 0) {
    next.splice(defaultIdx, 1)
    next.unshift(DEFAULT_WORKSPACE_ID)
  }

  emitReorder(next.filter((id) => id !== DEFAULT_WORKSPACE_ID))
}

function onDragPointerCancel() {
  cleanupDrag()
}

function cleanupDrag() {
  draggingId.value = null
  dragOverId.value = null
  dragOverPos.value = null
  window.removeEventListener('pointermove', onDragPointerMove)
  window.removeEventListener('pointerup', onDragPointerUp)
  window.removeEventListener('pointercancel', onDragPointerCancel)
}

onUnmounted(cleanupDrag)

function emitReorder(ids: string[]) {
  const current = props.workspaces.map((ws) => ws.id).filter((id) => id !== DEFAULT_WORKSPACE_ID)
  if (current.length === ids.length && current.every((id, i) => id === ids[i])) return
  emit('reorder', ids)
}

/** Keyboard/accessibility path for reordering, one slot per press. */
function moveByKeyboard(id: string, delta: number) {
  const ids = props.workspaces.map((ws) => ws.id).filter((wsId) => wsId !== DEFAULT_WORKSPACE_ID)
  const from = ids.indexOf(id)
  const to = from + delta
  if (from < 0 || to < 0 || to >= ids.length) return
  ;[ids[from], ids[to]] = [ids[to], ids[from]]
  emit('reorder', ids)
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
  flex: 1;
  min-width: 0;
  overflow: hidden;
  color: var(--fg-bright);
  font-size: 14px;
  font-weight: 600;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.ws-picker-head-actions {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 2px;
}

.ws-picker-manage-entry,
.ws-picker-done {
  display: flex;
  align-items: center;
  height: 40px;
  padding: 0 10px;
  border-radius: 10px;
  color: var(--text-muted, #888);
  font: inherit;
  font-size: 13px;
}
.ws-picker-manage-entry:hover,
.ws-picker-manage-entry:active,
.ws-picker-done:hover,
.ws-picker-done:active {
  background: var(--bg-hover);
  color: var(--fg);
}
.ws-picker-done {
  color: var(--fg-bright);
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

/* ── Manage mode ─────────────────────────────────────────────── */

.ws-picker-manage-hint {
  margin: 0;
  padding: 2px 16px 8px;
  color: var(--text-muted, #888);
  font-size: 11px;
  line-height: 1.5;
}

.ws-picker-manage-row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 54px;
  padding-right: 8px;
  color: inherit;
  -webkit-tap-highlight-color: transparent;
}
.ws-picker-manage-row.dragging {
  background: var(--bg-hover);
  opacity: 0.6;
}
.ws-picker-manage-row.drag-over-top {
  box-shadow: inset 0 2px 0 var(--fg-muted);
}
.ws-picker-manage-row.drag-over-bottom {
  box-shadow: inset 0 -2px 0 var(--fg-muted);
}

.ws-picker-drag,
.ws-picker-drag-spacer {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  width: 38px;
  height: 44px;
}
.ws-picker-drag {
  color: var(--text-muted, #888);
  touch-action: none;
  cursor: grab;
}
.ws-picker-drag:active {
  color: var(--fg);
  cursor: grabbing;
}
.ws-picker-drag:focus-visible {
  border-radius: 8px;
  outline: 1px solid var(--fg-muted);
  outline-offset: -4px;
}

.ws-picker-fixed-tag {
  flex: 0 0 auto;
  padding: 1px 6px;
  border: 1px solid var(--border);
  border-radius: 999px;
  color: var(--text-muted, #888);
  font-size: 10px;
  white-space: nowrap;
}

.ws-picker-action {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  width: 38px;
  height: 44px;
  border: 0;
  border-radius: 9px;
  background: transparent;
  color: var(--text-muted, #888);
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
.ws-picker-action:hover,
.ws-picker-action:active {
  background: var(--bg-hover);
  color: var(--fg);
}
.ws-picker-action.danger:hover,
.ws-picker-action.danger:active {
  background: color-mix(in srgb, var(--color-red, #f44747) 14%, transparent);
  color: var(--color-red, #f44747);
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
