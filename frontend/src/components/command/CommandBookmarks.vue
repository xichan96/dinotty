<template>
  <Teleport to="body">
    <div v-if="visible" class="bookmarks-backdrop" @click.self="close" @keydown.escape="close">
      <div class="bookmarks-panel">
        <div class="bookmarks-header">
          <div class="bookmarks-search">
            <Search :size="14" />
            <input
              ref="searchInputRef"
              v-model="searchQuery"
              :placeholder="t('bookmarks.search')"
              class="bookmarks-search-input"
            />
          </div>
          <div class="bookmarks-header-actions">
            <button class="bookmarks-add-toggle" @click="toggleAddMode" :class="{ active: addMode }">
              <Plus :size="14" />
            </button>
            <button class="bookmarks-close" @click="close">
              <X :size="14" />
            </button>
          </div>
        </div>

        <div class="bookmarks-body">
          <!-- Add form (collapsible) -->
          <div v-if="addMode" class="bookmark-add-form">
            <input
              ref="nameInputRef"
              v-model="newName"
              :placeholder="t('bookmarks.name')"
              class="bookmark-input"
              @keydown.enter="commandInputRef?.focus()"
            />
            <input
              ref="commandInputRef"
              v-model="newCommand"
              :placeholder="t('bookmarks.command')"
              class="bookmark-input wide"
              @keydown.meta.enter="addBookmark"
              @keydown.ctrl.enter="addBookmark"
            />
            <input v-model="newGroup" :placeholder="t('bookmarks.group')" class="bookmark-input short" />
            <button class="bookmark-add-btn" @click="addBookmark" :disabled="!newCommand.trim()">
              <Check :size="14" />
            </button>
          </div>

          <!-- Group filter -->
          <div v-if="groups.length > 1" class="bookmarks-groups">
            <button
              v-for="g in groups"
              :key="g"
              class="group-tag"
              :class="{ active: activeGroup === g }"
              @click="activeGroup = g"
            >{{ g }}</button>
          </div>

          <div v-if="filteredBookmarks.length === 0 && !addMode" class="bookmarks-empty">
            {{ t('bookmarks.empty') }}
          </div>

          <div
            v-for="(bm, i) in filteredBookmarks"
            :key="bm.id"
            class="bookmark-item"
            :class="{ 'drag-over-top': dropTarget === bm.id && dropPos === 'top', 'drag-over-bottom': dropTarget === bm.id && dropPos === 'bottom', dragging: dragId === bm.id }"
            :draggable="editId !== bm.id"
            @dragstart="onDragStart($event, bm.id)"
            @dragover.prevent="onDragOver($event, bm.id)"
            @dragleave="onDragLeave(bm.id)"
            @drop.prevent="onDrop(bm.id)"
            @dragend="onDragEnd"
          >
            <template v-if="editId === bm.id">
              <div class="bookmark-edit-form">
                <input
                  ref="editNameInputRef"
                  v-model="editName"
                  :placeholder="t('bookmarks.name')"
                  class="bookmark-input"
                  @keydown.enter="editCommandInputRef?.focus()"
                  @keydown.escape="cancelEdit"
                />
                <input
                  ref="editCommandInputRef"
                  v-model="editCommand"
                  :placeholder="t('bookmarks.command')"
                  class="bookmark-input wide"
                  @keydown.meta.enter="saveEdit"
                  @keydown.ctrl.enter="saveEdit"
                  @keydown.escape="cancelEdit"
                />
                <input
                  v-model="editGroup"
                  :placeholder="t('bookmarks.group')"
                  class="bookmark-input short"
                  @keydown.escape="cancelEdit"
                />
                <button class="bookmark-add-btn" @click="saveEdit" :disabled="!editCommand.trim()">
                  <Check :size="14" />
                </button>
                <button class="bookmark-edit-cancel" @click="cancelEdit">
                  <X :size="14" />
                </button>
              </div>
            </template>
            <template v-else>
              <GripVertical :size="14" class="bookmark-grip" />
              <div class="bookmark-info" @click="sendBookmark(bm)">
                <span class="bookmark-name">{{ bm.name || bm.command }}</span>
                <span class="bookmark-cmd">{{ bm.command }}</span>
              </div>
              <button class="bookmark-edit" @click.stop="startEdit(bm)" :title="t('bookmarks.edit')">
                <Pencil :size="12" />
              </button>
              <button class="bookmark-del" @click="removeBookmark(bm.id)">
                <X :size="12" />
              </button>
            </template>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, nextTick } from 'vue'
import { Plus, X, Check, GripVertical, Search, Pencil } from 'lucide-vue-next'
import { useSettings } from '../../composables/useSettings'
import { randomId } from '../../utils/id'
import { useI18n } from '../../composables/useI18n'

const props = defineProps<{
  getSendFn: () => ((data: string) => void) | null
  createTab?: () => Promise<void>
}>()

const visible = ref(false)
const activeGroup = ref('All')
const addMode = ref(false)
const newName = ref('')
const newCommand = ref('')
const newGroup = ref('')
const nameInputRef = ref<HTMLInputElement>()
const commandInputRef = ref<HTMLInputElement>()
const searchInputRef = ref<HTMLInputElement>()
const searchQuery = ref('')

// Edit state
const editId = ref<string | null>(null)
const editName = ref('')
const editCommand = ref('')
const editGroup = ref('')
const editNameInputRef = ref<HTMLInputElement>()
const editCommandInputRef = ref<HTMLInputElement>()

// Drag state
const dragId = ref<string | null>(null)
const dropTarget = ref<string | null>(null)
const dropPos = ref<'top' | 'bottom' | null>(null)

const { t } = useI18n()
const { settings, saveSettings } = useSettings()

const groups = computed(() => {
  const gs = new Set<string>(['All'])
  for (const bm of settings.bookmarks) {
    if (bm.group) gs.add(bm.group)
  }
  return Array.from(gs)
})

const filteredBookmarks = computed(() => {
  let list = settings.bookmarks
  if (activeGroup.value !== 'All') {
    list = list.filter((b) => b.group === activeGroup.value)
  }
  const q = searchQuery.value.trim().toLowerCase()
  if (q) {
    list = list.filter((b) =>
      b.name.toLowerCase().includes(q) || b.command.toLowerCase().includes(q)
    )
  }
  return list
})

function open() {
  visible.value = true
  addMode.value = false
  searchQuery.value = ''
  nextTick(() => searchInputRef.value?.focus())
}
function close() {
  visible.value = false
  addMode.value = false
  editId.value = null
}
function toggleAddMode() {
  addMode.value = !addMode.value
  if (addMode.value) {
    editId.value = null
    nextTick(() => nameInputRef.value?.focus())
  }
}

async function sendBookmark(bm: { command: string }) {
  let send = props.getSendFn()
  if (!send && props.createTab) {
    await props.createTab()
    // Wait for terminal component to mount and register its ref
    await new Promise(r => setTimeout(r, 100))
    send = props.getSendFn()
  }
  if (send) {
    send(bm.command + '\r')
  }
  close()
}

function addBookmark() {
  if (!newCommand.value.trim()) return
  settings.bookmarks.push({
    id: randomId(),
    name: newName.value.trim() || newCommand.value.trim(),
    command: newCommand.value.trim(),
    group: newGroup.value.trim() || null,
  })
  newName.value = ''
  newCommand.value = ''
  newGroup.value = ''
  addMode.value = false
  saveSettings()
}

function removeBookmark(id: string) {
  const idx = settings.bookmarks.findIndex((b) => b.id === id)
  if (idx !== -1) {
    settings.bookmarks.splice(idx, 1)
    saveSettings()
  }
}

function startEdit(bm: { id: string; name: string; command: string; group: string | null }) {
  editId.value = bm.id
  editName.value = bm.name
  editCommand.value = bm.command
  editGroup.value = bm.group || ''
  addMode.value = false
  nextTick(() => editNameInputRef.value?.focus())
}

function saveEdit() {
  if (!editId.value || !editCommand.value.trim()) return
  const bm = settings.bookmarks.find((b) => b.id === editId.value)
  if (bm) {
    bm.name = editName.value.trim() || editCommand.value.trim()
    bm.command = editCommand.value.trim()
    bm.group = editGroup.value.trim() || null
    saveSettings()
  }
  editId.value = null
}

function cancelEdit() {
  editId.value = null
}

function onDragStart(e: DragEvent, id: string) {
  dragId.value = id
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move'
  }
}

function onDragOver(e: DragEvent, id: string) {
  if (!dragId.value || dragId.value === id) return
  dropTarget.value = id
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
  dropPos.value = e.clientY < rect.top + rect.height / 2 ? 'top' : 'bottom'
}

function onDragLeave(id: string) {
  if (dropTarget.value === id) {
    dropTarget.value = null
    dropPos.value = null
  }
}

function onDrop(targetId: string) {
  if (!dragId.value || dragId.value === targetId) return
  const fromIdx = settings.bookmarks.findIndex((b) => b.id === dragId.value)
  const toIdx = settings.bookmarks.findIndex((b) => b.id === targetId)
  if (fromIdx === -1 || toIdx === -1) return

  const [item] = settings.bookmarks.splice(fromIdx, 1)
  let insertIdx: number
  if (fromIdx < toIdx) {
    insertIdx = dropPos.value === 'bottom' ? toIdx : toIdx - 1
  } else {
    insertIdx = dropPos.value === 'bottom' ? toIdx + 1 : toIdx
  }
  settings.bookmarks.splice(insertIdx, 0, item)
  saveSettings()
  onDragEnd()
}

function onDragEnd() {
  dragId.value = null
  dropTarget.value = null
  dropPos.value = null
}

defineExpose({ open, close })
</script>

<style scoped>
.bookmarks-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.5);
  z-index: 940;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: env(safe-area-inset-top, 0px) 0 env(safe-area-inset-bottom, 0px) 0;
}

.bookmarks-panel {
  width: 90vw;
  max-width: 500px;
  max-height: 70vh;
  background: var(--bg-surface, #1A1A1A);
  border: 1px solid var(--border, #333);
  border-radius: 8px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.bookmarks-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border, #333);
}
.bookmarks-search {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 1;
  color: var(--fg-muted);
}
.bookmarks-search-input {
  flex: 1;
  background: none;
  border: none;
  color: var(--fg-bright);
  font-size: 14px;
  outline: none;
  min-width: 0;
}
.bookmarks-search-input::placeholder {
  color: var(--fg-muted);
}
.bookmarks-header-actions {
  display: flex;
  gap: 4px;
}
.bookmarks-add-toggle,
.bookmarks-close {
  width: 28px;
  height: 28px;
  border: none;
  background: none;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--fg-muted);
  cursor: pointer;
}
.bookmarks-add-toggle:hover,
.bookmarks-close:hover { background: rgba(255,255,255,0.1); }
.bookmarks-add-toggle.active {
  background: var(--accent, #8A8A8A);
  color: #fff;
}

.bookmarks-body {
  flex: 1;
  overflow-y: auto;
  padding: 12px 16px;
  padding-bottom: calc(12px + env(safe-area-inset-bottom, 0px));
}

.bookmarks-groups {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  margin-bottom: 12px;
}
.group-tag {
  padding: 3px 10px;
  border-radius: 12px;
  font-size: 11px;
  background: var(--bg-input, #1A1A1A);
  border: 1px solid var(--border, #333);
  color: var(--fg-muted);
}
.group-tag.active {
  background: var(--accent, #8A8A8A);
  border-color: var(--accent);
  color: #fff;
}

.bookmarks-empty {
  text-align: center;
  color: var(--fg-muted);
  font-size: 13px;
  padding: 20px;
}

.bookmark-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-radius: 6px;
  cursor: pointer;
  margin-bottom: 4px;
  border: 1px solid transparent;
  transition: border-color 0.1s;
}
.bookmark-item:hover {
  background: rgba(255,255,255,0.05);
}
.bookmark-item.dragging {
  opacity: 0.4;
}
.bookmark-item.drag-over-top {
  border-top-color: var(--accent, #007acc);
}
.bookmark-item.drag-over-bottom {
  border-bottom-color: var(--accent, #007acc);
}

.bookmark-grip {
  color: var(--fg-muted, #666);
  cursor: grab;
  flex-shrink: 0;
  opacity: 0.5;
}
.bookmark-grip:hover {
  opacity: 1;
}
.bookmark-item:active .bookmark-grip {
  cursor: grabbing;
}
.bookmark-info {
  flex: 1;
  min-width: 0;
}
.bookmark-name {
  display: block;
  font-size: 13px;
  color: var(--fg-bright);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.bookmark-cmd {
  display: block;
  font-size: 11px;
  color: var(--fg-muted);
  font-family: var(--font-mono);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.bookmark-del {
  width: 22px;
  height: 22px;
  border: none;
  background: none;
  border-radius: 50%;
  color: var(--fg-muted);
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  cursor: pointer;
}
.bookmark-item:hover .bookmark-del { opacity: 1; }
.bookmark-del:hover { background: rgba(255,100,100,0.2); color: #ff6b6b; }

.bookmark-edit {
  width: 22px;
  height: 22px;
  border: none;
  background: none;
  border-radius: 50%;
  color: var(--fg-muted);
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  cursor: pointer;
}
.bookmark-item:hover .bookmark-edit { opacity: 1; }
.bookmark-edit:hover { background: rgba(100,150,255,0.2); color: #6b9fff; }

.bookmark-edit-form {
  display: flex;
  gap: 6px;
  width: 100%;
  align-items: center;
}
.bookmark-edit-cancel {
  width: 32px;
  height: 30px;
  border: none;
  border-radius: 4px;
  background: none;
  color: var(--fg-muted);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}
.bookmark-edit-cancel:hover { background: rgba(255,100,100,0.2); color: #ff6b6b; }

.bookmark-add-form {
  display: flex;
  gap: 6px;
  margin-bottom: 12px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--border, #333);
}
.bookmark-input {
  flex: 1;
  background: var(--bg-input);
  border: 1px solid var(--border);
  border-radius: 4px;
  color: var(--fg);
  padding: 6px 8px;
  font-size: 12px;
  min-width: 0;
  outline: none;
}
.bookmark-input:focus {
  border-color: var(--accent, #007acc);
}
.bookmark-input.wide { flex: 2; }
.bookmark-input.short { flex: 0.7; }
.bookmark-add-btn {
  width: 32px;
  height: 30px;
  border: none;
  border-radius: 4px;
  background: var(--accent, #007acc);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}
.bookmark-add-btn:disabled {
  opacity: 0.4;
  cursor: default;
}
</style>
