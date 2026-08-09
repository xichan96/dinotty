<template>
  <Teleport to="body">
    <div v-if="visible" class="ssh-backdrop" @click.self="close">
      <div class="ssh-panel">
        <div class="ssh-header">
          <h2>{{ t('ssh.title') }}</h2>
          <div class="ssh-header-actions">
            <button class="ssh-new-btn" @click="openNewDialog" :title="t('ssh.newHost')">
              <Plus :size="14" />
            </button>
            <button class="ssh-close" @click="close">&times;</button>
          </div>
        </div>

        <div class="ssh-search">
          <input
            ref="searchInput"
            v-model="query"
            :placeholder="t('ssh.search')"
            class="ssh-search-input"
            @keydown.escape="close"
            @keydown.down.prevent="moveSelection(1)"
            @keydown.up.prevent="moveSelection(-1)"
            @keydown.enter.prevent="selectCurrent"
          />
        </div>

        <div v-if="groups.length > 1" class="ssh-groups">
          <button
            class="group-tag"
            :class="{ active: activeGroup === null }"
            @click="activeGroup = null"
          >
            {{ t('ssh.allGroups') }}
          </button>
          <button
            v-for="g in groups"
            :key="g"
            class="group-tag"
            :class="{ active: activeGroup === g }"
            @click="activeGroup = g"
          >
            {{ g }}
          </button>
        </div>

        <div class="ssh-body" ref="listEl">
          <div
            v-for="(group, gi) in groupedProfiles"
            :key="group.name"
            class="ssh-group"
          >
            <div v-if="group.name" class="ssh-group-label">{{ group.name }}</div>
            <div
              v-for="(profile, pi) in group.items"
              :key="profile.id"
              class="ssh-item"
              :class="{
                active: flatIndex(gi, pi) === selectedIndex,
                'drag-over-top': dropTarget === profile.id && dropPos === 'top',
                'drag-over-bottom': dropTarget === profile.id && dropPos === 'bottom',
                dragging: dragId === profile.id,
              }"
              :draggable="true"
              @dragstart="onDragStart($event, profile.id)"
              @dragover.prevent="onDragOver($event, profile.id)"
              @dragleave="onDragLeave(profile.id)"
              @drop.prevent="onDrop(profile.id)"
              @dragend="onDragEnd"
              @click="connectProfile(profile)"
              @mouseenter="selectedIndex = flatIndex(gi, pi)"
            >
              <GripVertical :size="14" class="ssh-grip" />
              <div class="ssh-item-icon">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="2" width="20" height="8" rx="2"/><rect x="2" y="14" width="20" height="8" rx="2"/><circle cx="6" cy="6" r="1"/><circle cx="6" cy="18" r="1"/></svg>
              </div>
              <div class="ssh-item-info">
                <span class="ssh-item-name">{{ profile.name || profile.host }}</span>
                <span class="ssh-item-addr">{{ profile.username }}@{{ profile.host }}:{{ profile.port }}</span>
              </div>
              <div class="ssh-item-actions">
                <button class="ssh-icon-btn" :title="t('ssh.edit')" @click.stop="editProfile(profile)">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                </button>
                <button class="ssh-icon-btn danger" :title="t('ssh.delete')" @click.stop="deleteProfile(profile.id)">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                </button>
              </div>
            </div>
          </div>

          <div v-if="filteredProfiles.length === 0" class="ssh-empty">
            {{ t('ssh.noHosts') }}
          </div>
        </div>

        <div class="ssh-quick">
          <div class="ssh-quick-label">{{ t('ssh.quickConnect') }}</div>
          <div class="ssh-quick-form">
            <input
              v-model="quickUser"
              :placeholder="t('ssh.username')"
              class="ssh-input ssh-input-user"
              @keydown.escape="close"
            />
            <span class="ssh-at">@</span>
            <input
              v-model="quickHost"
              :placeholder="t('ssh.host')"
              class="ssh-input ssh-input-host"
              @keydown.escape="close"
            />
            <input
              v-model="quickPort"
              :placeholder="t('ssh.port')"
              class="ssh-input ssh-input-port"
              type="number"
              @keydown.escape="close"
            />
            <input
              v-model="quickPassword"
              :placeholder="t('ssh.password')"
              class="ssh-input ssh-input-pass"
              type="password"
              @keydown.escape="close"
              @keydown.enter="quickConnect"
            />
            <button class="ssh-connect-btn" @click="quickConnect" :disabled="connecting">
              {{ connecting ? t('ssh.connecting') : t('ssh.connect') }}
            </button>
          </div>
          <div v-if="connecting" class="ssh-connecting">
            <div class="ssh-spinner"></div>
            <span>{{ t('ssh.connecting') }}</span>
            <button class="ssh-cancel-btn" @click="cancelConnect">{{ t('ssh.cancel') }}</button>
          </div>
          <div v-else-if="error" class="ssh-error">
            <span>{{ error }}</span>
            <button class="ssh-retry-btn" @click="retryLast">{{ t('ssh.retry') }}</button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>

  <SshHostEditDialog
    v-if="editVisible"
    :profile="editTarget"
    @save="onEditSave"
    @close="editVisible = false"
  />

  <SshPasswordDialog
    v-if="pwDialogVisible"
    :host="pwDialogHost"
    :port="pwDialogPort"
    :username="pwDialogUsername"
    :name="pwDialogName"
    @connect="onPasswordConnect"
    @close="pwDialogVisible = false"
  />
</template>

<script setup lang="ts">
import { ref, computed, nextTick, watch } from 'vue'
import { Plus, GripVertical } from 'lucide-vue-next'
import { useI18n } from '../../composables/useI18n'
import { settings, saveSettings, type SshProfile } from '../../composables/useSettings'
import { apiCreateSshQuickTab, apiCreateSshTab, type CreateTabResult } from '../../composables/useTabApi'
import SshHostEditDialog from './SshHostEditDialog.vue'
import SshPasswordDialog from './SshPasswordDialog.vue'

const { t } = useI18n()

const isTouchDevice = window.matchMedia('(hover: none) and (pointer: coarse)').matches

const emit = defineEmits<{
  connect: [result: CreateTabResult]
}>()

const visible = ref(false)
const query = ref('')
const selectedIndex = ref(0)
const activeGroup = ref<string | null>(null)
const connecting = ref(false)
const error = ref('')
const searchInput = ref<HTMLInputElement | null>(null)
const listEl = ref<HTMLElement | null>(null)

// Quick connect
const quickUser = ref('root')
const quickHost = ref('')
const quickPort = ref('22')
const quickPassword = ref('')

// Edit dialog
const editVisible = ref(false)
const editTarget = ref<SshProfile | null>(null)

// Password dialog
const pwDialogVisible = ref(false)
const pwDialogHost = ref('')
const pwDialogPort = ref(22)
const pwDialogUsername = ref('')
const pwDialogName = ref('')
let pendingProfile: SshProfile | null = null

// Retry tracking
let lastAttempt: (() => Promise<void>) | null = null

function retryLast() {
  if (lastAttempt) lastAttempt()
}

// Abort controller for cancelling in-flight requests
let abortController: AbortController | null = null

// Drag state
const dragId = ref<string | null>(null)
const dropTarget = ref<string | null>(null)
const dropPos = ref<'top' | 'bottom' | null>(null)

function cancelConnect() {
  if (abortController) {
    abortController.abort()
    abortController = null
  }
  connecting.value = false
  error.value = ''
}

const groups = computed(() => {
  const gs = new Set<string>()
  for (const p of settings.ssh_profiles || []) {
    if (p.group) gs.add(p.group)
  }
  return Array.from(gs)
})

const filteredProfiles = computed(() => {
  let profiles = settings.ssh_profiles || []
  if (activeGroup.value) {
    profiles = profiles.filter((p) => p.group === activeGroup.value)
  }
  const q = query.value.toLowerCase().trim()
  if (!q) return profiles
  return profiles.filter(
    (p) =>
      p.name.toLowerCase().includes(q) ||
      p.host.toLowerCase().includes(q) ||
      p.username.toLowerCase().includes(q) ||
      (p.group || '').toLowerCase().includes(q)
  )
})

const groupedProfiles = computed(() => {
  const groups = new Map<string, SshProfile[]>()
  for (const p of filteredProfiles.value) {
    const g = p.group || ''
    if (!groups.has(g)) groups.set(g, [])
    groups.get(g)!.push(p)
  }
  return Array.from(groups.entries()).map(([name, items]) => ({ name, items }))
})

function flatIndex(gi: number, pi: number): number {
  let idx = 0
  for (let g = 0; g < gi; g++) {
    idx += groupedProfiles.value[g].items.length
  }
  return idx + pi
}

function totalItems(): number {
  return filteredProfiles.value.length
}

function moveSelection(delta: number) {
  const total = totalItems()
  if (total === 0) return
  selectedIndex.value = (selectedIndex.value + delta + total) % total
  // Scroll into view
  nextTick(() => {
    const el = listEl.value?.querySelector('.ssh-item.active')
    el?.scrollIntoView({ block: 'nearest' })
  })
}

function selectCurrent() {
  const profiles = filteredProfiles.value
  if (profiles.length === 0) return
  if (selectedIndex.value >= profiles.length) selectedIndex.value = 0
  connectProfile(profiles[selectedIndex.value])
}

async function connectProfile(profile: SshProfile) {
  if (connecting.value) return

  // If password auth and password is empty, prompt for it
  if (profile.auth_method.type === 'password' && !profile.auth_method.password) {
    pendingProfile = profile
    pwDialogHost.value = profile.host
    pwDialogPort.value = profile.port
    pwDialogUsername.value = profile.username
    pwDialogName.value = profile.name
    pwDialogVisible.value = true
    return
  }

  lastAttempt = () => connectProfile(profile)
  abortController = new AbortController()
  connecting.value = true
  error.value = ''
  try {
    const result = await apiCreateSshTab(profile.id, undefined, undefined, abortController.signal)
    emit('connect', result)
    close()
  } catch (e: any) {
    if (e.name === 'AbortError') return
    error.value = e.message || t('ssh.error')
  } finally {
    connecting.value = false
    abortController = null
  }
}

async function onPasswordConnect(password: string) {
  if (!pendingProfile) return
  const profile = pendingProfile
  pendingProfile = null
  pwDialogVisible.value = false

  lastAttempt = () => onPasswordConnect(password)
  abortController = new AbortController()
  connecting.value = true
  error.value = ''
  try {
    const result = await apiCreateSshQuickTab({
      host: profile.host,
      port: profile.port,
      username: profile.username,
      auth: { type: 'password', password },
    }, abortController.signal)
    emit('connect', result)
    close()
  } catch (e: any) {
    if (e.name === 'AbortError') return
    error.value = e.message || t('ssh.error')
  } finally {
    connecting.value = false
    abortController = null
  }
}

async function quickConnect() {
  if (connecting.value) return
  if (!quickHost.value.trim()) {
    error.value = t('ssh.errorHost')
    return
  }
  if (!quickUser.value.trim()) {
    error.value = t('ssh.errorUsername')
    return
  }

  lastAttempt = () => quickConnect()
  abortController = new AbortController()
  connecting.value = true
  error.value = ''
  try {
    const req = {
      host: quickHost.value.trim(),
      port: parseInt(quickPort.value) || 22,
      username: quickUser.value.trim(),
      auth: { type: 'password' as const, password: quickPassword.value },
    }
    const result = await apiCreateSshQuickTab(req, abortController.signal)

    // Auto-save to profiles
    const existingIdx = settings.ssh_profiles.findIndex(
      (p) => p.host === req.host && p.port === req.port && p.username === req.username
    )
    if (existingIdx < 0) {
      settings.ssh_profiles.push({
        id: crypto.randomUUID(),
        name: `${req.username}@${req.host}`,
        host: req.host,
        port: req.port,
        username: req.username,
        auth_method: { type: 'password', password: req.auth.password },
      })
      saveSettings()
    }

    emit('connect', result)
    close()
  } catch (e: any) {
    if (e.name === 'AbortError') return
    error.value = e.message || t('ssh.error')
  } finally {
    connecting.value = false
    abortController = null
  }
}

function editProfile(profile: SshProfile) {
  editTarget.value = { ...profile }
  editVisible.value = true
}

function onEditSave(profile: SshProfile) {
  const idx = settings.ssh_profiles.findIndex((p) => p.id === profile.id)
  if (idx >= 0) {
    settings.ssh_profiles[idx] = profile
  } else {
    settings.ssh_profiles.push(profile)
  }
  saveSettings()
  editVisible.value = false
}

function deleteProfile(id: string) {
  settings.ssh_profiles = settings.ssh_profiles.filter((p) => p.id !== id)
  saveSettings()
}

function open() {
  visible.value = true
  error.value = ''
  query.value = ''
  selectedIndex.value = 0
  activeGroup.value = null
  if (!isTouchDevice) {
    nextTick(() => searchInput.value?.focus())
  }
}

function close() {
  visible.value = false
  connecting.value = false
}

function openNewDialog() {
  editTarget.value = null
  editVisible.value = true
}

watch(query, () => {
  selectedIndex.value = 0
})

watch(activeGroup, () => {
  selectedIndex.value = 0
})

// Drag handlers
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
  const fromIdx = settings.ssh_profiles.findIndex((p) => p.id === dragId.value)
  const toIdx = settings.ssh_profiles.findIndex((p) => p.id === targetId)
  if (fromIdx === -1 || toIdx === -1) return

  const [item] = settings.ssh_profiles.splice(fromIdx, 1)
  let insertIdx: number
  if (fromIdx < toIdx) {
    insertIdx = dropPos.value === 'bottom' ? toIdx : toIdx - 1
  } else {
    insertIdx = dropPos.value === 'bottom' ? toIdx + 1 : toIdx
  }
  settings.ssh_profiles.splice(insertIdx, 0, item)
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
.ssh-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  z-index: 950;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: env(safe-area-inset-top, 0px) 0 env(safe-area-inset-bottom, 0px) 0;
}

.ssh-panel {
  width: 90vw;
  max-width: 520px;
  max-height: 80vh;
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: 10px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.ssh-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border);
}
.ssh-header h2 {
  font-size: 15px;
  font-weight: 600;
  color: var(--fg-bright);
  margin: 0;
}
.ssh-close {
  width: 28px;
  height: 28px;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--fg-muted);
  font-size: 18px;
}
.ssh-header-actions {
  display: flex;
  gap: 4px;
  align-items: center;
}
.ssh-new-btn {
  width: 28px;
  height: 28px;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--fg-muted);
  cursor: pointer;
}
.ssh-new-btn:hover {
  background: var(--bg-hover);
  color: var(--fg);
}

.ssh-search {
  padding: 8px 16px;
  border-bottom: 1px solid var(--border);
}
.ssh-search-input {
  width: 100%;
  background: var(--bg-input);
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--fg);
  padding: 8px 12px;
  font-size: 13px;
  outline: none;
}
.ssh-search-input:focus {
  border-color: var(--accent, #4d7fff);
}

.ssh-groups {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  padding: 4px 16px 8px;
  border-bottom: 1px solid var(--border);
}
.group-tag {
  padding: 3px 10px;
  border-radius: 12px;
  font-size: 11px;
  background: var(--bg-input);
  border: 1px solid var(--border);
  color: var(--fg-muted);
  cursor: pointer;
}
.group-tag.active {
  background: var(--accent, #4d7fff);
  border-color: var(--accent);
  color: #fff;
}

.ssh-body {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
  min-height: 120px;
  max-height: 300px;
}

.ssh-group-label {
  font-size: 11px;
  font-weight: 600;
  color: var(--fg-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  padding: 8px 8px 4px;
}

.ssh-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border-radius: 6px;
  cursor: pointer;
  border: 1px solid transparent;
  transition: border-color 0.1s;
}
.ssh-item:hover,
.ssh-item.active {
  background: var(--bg-hover);
}
.ssh-item.dragging {
  opacity: 0.4;
}
.ssh-item.drag-over-top {
  border-top-color: var(--accent, #4d7fff);
}
.ssh-item.drag-over-bottom {
  border-bottom-color: var(--accent, #4d7fff);
}
.ssh-grip {
  color: var(--fg-muted);
  cursor: grab;
  flex-shrink: 0;
  opacity: 0.5;
}
.ssh-grip:hover {
  opacity: 1;
}
.ssh-item:active .ssh-grip {
  cursor: grabbing;
}

.ssh-item-icon {
  color: var(--fg-muted);
  flex-shrink: 0;
}

.ssh-item-info {
  flex: 1;
  min-width: 0;
}
.ssh-item-name {
  display: block;
  font-size: 13px;
  color: var(--fg-bright);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ssh-item-addr {
  display: block;
  font-size: 11px;
  color: var(--fg-muted);
  font-family: var(--font-mono);
}

.ssh-item-actions {
  display: flex;
  gap: 2px;
  opacity: 0;
}
.ssh-item:hover .ssh-item-actions,
.ssh-item.active .ssh-item-actions {
  opacity: 1;
}
.ssh-icon-btn {
  width: 24px;
  height: 24px;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--fg-muted);
}
.ssh-icon-btn:hover {
  background: var(--bg-hover);
  color: var(--fg);
}
.ssh-icon-btn.danger:hover {
  color: #e55;
}

.ssh-empty {
  text-align: center;
  color: var(--fg-muted);
  font-size: 13px;
  padding: 24px 0;
}

.ssh-quick {
  border-top: 1px solid var(--border);
  padding: 12px 16px;
  padding-bottom: calc(12px + env(safe-area-inset-bottom, 0px));
}
.ssh-quick-label {
  font-size: 11px;
  font-weight: 600;
  color: var(--fg-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-bottom: 8px;
}
.ssh-quick-form {
  display: flex;
  gap: 6px;
  align-items: center;
  flex-wrap: wrap;
}
.ssh-at {
  color: var(--fg-muted);
  font-size: 13px;
}
.ssh-input {
  background: var(--bg-input);
  border: 1px solid var(--border);
  border-radius: 4px;
  color: var(--fg);
  padding: 6px 8px;
  font-size: 12px;
  outline: none;
  min-width: 0;
}
.ssh-input:focus {
  border-color: var(--accent, #4d7fff);
}
.ssh-input-user { width: 80px; }
.ssh-input-host { flex: 1; min-width: 100px; }
.ssh-input-port { width: 56px; }
.ssh-input-pass { width: 90px; }

.ssh-connect-btn {
  padding: 6px 14px;
  border-radius: 4px;
  background: var(--accent, #4d7fff);
  color: #fff;
  font-size: 12px;
  font-weight: 500;
  white-space: nowrap;
}
.ssh-connect-btn:disabled {
  opacity: 0.5;
}
.ssh-connect-btn:not(:disabled):hover {
  opacity: 0.9;
}

.ssh-error {
  color: #e55;
  font-size: 12px;
  margin-top: 6px;
  display: flex;
  align-items: center;
  gap: 8px;
}
.ssh-retry-btn {
  padding: 2px 8px;
  border-radius: 3px;
  border: 1px solid var(--border, #555);
  background: transparent;
  color: var(--fg);
  font-size: 11px;
  cursor: pointer;
  transition: background 0.15s;
}
.ssh-retry-btn:hover {
  background: var(--bg-hover);
}
.ssh-connecting {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
  font-size: 12px;
  color: var(--fg-muted);
}
.ssh-spinner {
  width: 14px;
  height: 14px;
  border: 2px solid var(--border, #555);
  border-top-color: var(--accent, #4d7fff);
  border-radius: 50%;
  animation: ssh-spin 0.8s linear infinite;
}
@keyframes ssh-spin {
  to { transform: rotate(360deg); }
}
.ssh-cancel-btn {
  margin-left: auto;
  padding: 2px 8px;
  border-radius: 3px;
  border: 1px solid var(--border, #555);
  background: transparent;
  color: var(--fg);
  font-size: 11px;
  cursor: pointer;
  transition: background 0.15s;
}
.ssh-cancel-btn:hover {
  background: var(--bg-hover);
}
</style>
