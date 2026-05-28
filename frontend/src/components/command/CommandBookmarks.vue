<template>
  <Teleport to="body">
    <div v-if="visible" class="bookmarks-backdrop" @click.self="close">
      <div class="bookmarks-panel">
        <div class="bookmarks-header">
          <h2>Saved Commands</h2>
          <button class="bookmarks-close" @click="close">✕</button>
        </div>

        <div class="bookmarks-body">
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

          <div v-if="filteredBookmarks.length === 0" class="bookmarks-empty">
            No saved commands yet
          </div>

          <div v-for="(bm, i) in filteredBookmarks" :key="bm.id" class="bookmark-item">
            <div class="bookmark-info" @click="sendBookmark(bm)">
              <span class="bookmark-name">{{ bm.name || bm.command }}</span>
              <span class="bookmark-cmd">{{ bm.command }}</span>
            </div>
            <button class="bookmark-del" @click="removeBookmark(bm.id)">✕</button>
          </div>

          <!-- Add form -->
          <div class="bookmark-add-form">
            <input v-model="newName" placeholder="Name" class="bookmark-input" />
            <input v-model="newCommand" placeholder="Command" class="bookmark-input wide" />
            <input v-model="newGroup" placeholder="Group" class="bookmark-input short" />
            <button class="bookmark-add-btn" @click="addBookmark">+</button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useSettings } from '../../composables/useSettings'

const props = defineProps<{
  getSendFn: () => ((data: string) => void) | null
}>()

const visible = ref(false)
const activeGroup = ref('All')
const newName = ref('')
const newCommand = ref('')
const newGroup = ref('')

const { settings, saveSettings } = useSettings()

const groups = computed(() => {
  const gs = new Set<string>(['All'])
  for (const bm of settings.bookmarks) {
    if (bm.group) gs.add(bm.group)
  }
  return Array.from(gs)
})

const filteredBookmarks = computed(() => {
  if (activeGroup.value === 'All') return settings.bookmarks
  return settings.bookmarks.filter((b) => b.group === activeGroup.value)
})

function open() { visible.value = true }
function close() { visible.value = false }

function sendBookmark(bm: { command: string }) {
  const send = props.getSendFn()
  if (send) {
    send(bm.command + '\r')
  }
  close()
}

function addBookmark() {
  if (!newCommand.value.trim()) return
  settings.bookmarks.push({
    id: crypto.randomUUID(),
    name: newName.value.trim() || newCommand.value.trim(),
    command: newCommand.value.trim(),
    group: newGroup.value.trim() || null,
  })
  newName.value = ''
  newCommand.value = ''
  newGroup.value = ''
  saveSettings()
}

function removeBookmark(id: string) {
  const idx = settings.bookmarks.findIndex((b) => b.id === id)
  if (idx !== -1) {
    settings.bookmarks.splice(idx, 1)
    saveSettings()
  }
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
.bookmarks-header h2 {
  font-size: 15px;
  font-weight: 600;
  color: var(--fg-bright);
}
.bookmarks-close {
  width: 28px;
  height: 28px;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--fg-muted);
}
.bookmarks-close:hover { background: rgba(255,255,255,0.1); }

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
  background: var(--accent, #4D7FFF);
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
}
.bookmark-item:hover {
  background: rgba(255,255,255,0.05);
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
  border-radius: 50%;
  font-size: 11px;
  color: var(--fg-muted);
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
}
.bookmark-item:hover .bookmark-del { opacity: 1; }
.bookmark-del:hover { background: rgba(255,100,100,0.2); color: #ff6b6b; }

.bookmark-add-form {
  display: flex;
  gap: 6px;
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--border, #333);
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
}
.bookmark-input.wide { flex: 2; }
.bookmark-input.short { flex: 0.7; }
.bookmark-add-btn {
  width: 32px;
  border-radius: 4px;
  background: var(--accent);
  color: #fff;
  font-size: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
}
</style>
