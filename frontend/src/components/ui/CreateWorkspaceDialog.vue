<template>
  <Teleport to="body">
    <div v-if="visible" class="cw-backdrop" @click.self="$emit('close')">
      <div class="cw-modal">
        <div class="cw-header">
          <span class="cw-title">{{ isEdit ? t('palette.rename') : t('workspace.add') }}</span>
          <button class="cw-close" @click="$emit('close')">&times;</button>
        </div>
        <div class="cw-body">
          <!-- Mode toggle (only when creating) -->
          <template v-if="!isEdit">
            <div class="cw-mode-toggle">
              <button
                :class="['cw-mode-btn', { active: mode === 'local' }]"
                @click="mode = 'local'"
              >
                {{ t('workspace.modeLocal') }}
              </button>
              <button
                :class="['cw-mode-btn', { active: mode === 'remote' }]"
                @click="mode = 'remote'"
              >
                {{ t('workspace.modeRemote') }}
              </button>
            </div>
          </template>

          <!-- SSH connection selector (remote mode) -->
          <template v-if="mode === 'remote'">
            <label class="cw-label">{{ t('workspace.connection') }}</label>
            <select v-model="selectedConnectionId" class="cw-input cw-select">
              <option value="" disabled>{{ t('workspace.connectionNone') }}</option>
              <option v-for="profile in sshProfiles" :key="profile.id" :value="profile.id">
                {{ profile.name || profile.username + '@' + profile.host }}
              </option>
            </select>

            <label class="cw-label">{{ t('workspace.remotePath') }}</label>
            <input
              v-model="remotePath"
              class="cw-input"
              placeholder="/home/user/project"
              @keydown.enter="onSubmit"
            />
          </template>

          <!-- Local path (local mode or edit) -->
          <template v-if="mode === 'local'">
            <label class="cw-label">{{ t('workspace.path') }}</label>
            <div class="cw-path-row">
              <input
                ref="pathInput"
                v-model="path"
                class="cw-input"
                :disabled="isEdit"
                placeholder="/Users/me/projects/my-app"
                @keydown.enter="onSubmit"
              />
              <button v-if="!isEdit" class="cw-browse-btn" @click="toggleBrowser">
                <FolderOpen :size="14" />
              </button>
            </div>
          </template>

          <label class="cw-label">{{ t('workspace.name') }} <span class="cw-optional">({{ t('workspace.path').toLowerCase() }})</span></label>
          <input
            v-model="name"
            class="cw-input"
            :placeholder="t('workspace.name')"
            @keydown.enter="onSubmit"
          />

          <label class="cw-label"
            >{{ t('workspace.abbr') }}
            <span class="cw-optional">{{ t('workspace.abbrHint') }}</span></label
          >
          <input
            v-model="abbr"
            class="cw-input"
            :placeholder="monogramPlaceholder"
            maxlength="3"
            @keydown.enter="onSubmit"
          />

          <label class="cw-label">{{ t('workspace.color') }}</label>
          <div class="cw-color-row">
            <button
              v-for="preset in WORKSPACE_COLORS"
              :key="preset"
              type="button"
              :class="['cw-color-swatch', { selected: color === preset }]"
              :style="{ backgroundColor: preset }"
              :aria-label="preset"
              @click="color = preset"
            />
            <input
              v-model="color"
              class="cw-input cw-color-input"
              placeholder="#RRGGBB"
              maxlength="7"
              @keydown.enter="onSubmit"
            />
            <button type="button" class="cw-default-btn" @click="color = ''">
              {{ t('workspace.colorDefault') }}
            </button>
          </div>
          <p v-if="error" class="cw-error">{{ error }}</p>
        </div>
        <div class="cw-footer">
          <button class="cw-btn cancel" @click="$emit('close')">{{ t('confirm.closeWindowCancel') }}</button>
          <button class="cw-btn primary" :disabled="!canSubmit" @click="onSubmit">
            {{ isEdit ? t('settings.token.save') : t('workspace.add') }}
          </button>
        </div>
      </div>
    </div>

    <FilePickerModal
      v-if="!isEdit"
      :visible="showPicker"
      pane-id=""
      :root="pickerRoot"
      free
      @update:visible="showPicker = $event"
      @select="onPickerSelect"
    />
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue'
import { FolderOpen } from 'lucide-vue-next'
import { useI18n } from '../../composables/useI18n'
import { useWorkspaces } from '../../composables/useWorkspaces'
import { useSettings } from '../../composables/useSettings'
import { isTauri, tauriInvoke } from '../../composables/useTransport'
import type { Workspace } from '../../types/workspace'
import { autoMonogram, WORKSPACE_COLORS } from '../../utils/workspaceIcon'
import FilePickerModal from '../preview/FilePickerModal.vue'

const { t } = useI18n()
const { createWorkspace, updateWorkspace } = useWorkspaces()
const { settings } = useSettings()

const sshProfiles = computed(() => settings.ssh_profiles ?? [])
const pickerRoot = computed(() => settings.default_base_dir?.trim() || '/')

const props = defineProps<{
  visible: boolean
  workspace?: Workspace | null
}>()

const emit = defineEmits<{
  close: []
  created: [id: string]
}>()

const isEdit = computed(() => !!props.workspace)

const mode = ref<'local' | 'remote'>('local')
const selectedConnectionId = ref('')
const remotePath = ref('/home')
const path = ref('')
const name = ref('')
const abbr = ref('')
const color = ref<string | undefined>(undefined)
const error = ref('')
const pathInput = ref<HTMLInputElement | null>(null)
const showPicker = ref(false)
const monogramPlaceholder = computed(() => autoMonogram(name.value || ''))

const canSubmit = computed(() => {
  if (isEdit.value) return !!name.value.trim()
  if (mode.value === 'remote') return !!selectedConnectionId.value && !!remotePath.value.trim()
  return !!path.value.trim()
})

watch(
  () => props.visible,
  (v) => {
  if (v) {
    if (props.workspace) {
      path.value = props.workspace.path
      name.value = props.workspace.name
        abbr.value = props.workspace.abbr ?? ''
        color.value = props.workspace.color
      mode.value = props.workspace.connection_id ? 'remote' : 'local'
      selectedConnectionId.value = props.workspace.connection_id ?? ''
      remotePath.value = props.workspace.path
    } else {
      path.value = ''
      name.value = ''
        abbr.value = ''
        color.value = undefined
      mode.value = 'local'
      selectedConnectionId.value = ''
      remotePath.value = '/home'
    }
    error.value = ''
    nextTick(() => pathInput.value?.focus())
  }
  }
)

async function toggleBrowser() {
  if (isTauri()) {
    try {
      const selected = await tauriInvoke('pick_workspace_dir', { base: pickerRoot.value }) as string | null
      if (selected) onPickerSelect(selected)
    } catch (e: any) {
      error.value = e?.message || 'Failed'
    }
    return
  }
  showPicker.value = true
}

function onPickerSelect(selected: string) {
  path.value = selected
  showPicker.value = false
  autoFillName()
}

function autoFillName() {
  if (!name.value.trim()) {
    const p = path.value.trim()
    if (p) {
      const parts = p.split('/').filter(Boolean)
      name.value = parts[parts.length - 1] || ''
    }
  }
}

function autoFillNameFromRemote(profile?: { name?: string; host?: string }) {
  if (!name.value.trim() && profile) {
    name.value = profile.name || profile.host || ''
  }
}

watch(path, () => {
  if (!name.value.trim()) {
    autoFillName()
  }
})

async function onSubmit() {
  if (!canSubmit.value) return
  error.value = ''
  try {
    if (isEdit.value && props.workspace) {
      await updateWorkspace(props.workspace.id, {
        name: name.value.trim(),
        abbr: abbr.value,
        color: color.value ?? '',
      })
    } else if (mode.value === 'remote') {
      const profile = sshProfiles.value.find((p: any) => p.id === selectedConnectionId.value)
      autoFillNameFromRemote(profile)
      const overrides = {
        abbr: abbr.value || undefined,
        color: color.value || undefined,
      }
      const ws = await createWorkspace(
        remotePath.value.trim(),
        name.value.trim() || undefined,
        selectedConnectionId.value,
        overrides
      )
      emit('created', ws.id)
    } else {
      const p = path.value.trim()
      autoFillName()
      const overrides = {
        abbr: abbr.value || undefined,
        color: color.value || undefined,
      }
      const ws = await createWorkspace(p, name.value.trim() || undefined, undefined, overrides)
      emit('created', ws.id)
    }
    emit('close')
  } catch (e: any) {
    error.value = e?.message || 'Failed'
  }
}
</script>

<style scoped>
.cw-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  z-index: 2100;
  display: flex;
  align-items: center;
  justify-content: center;
}
.cw-modal {
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: 8px;
  width: 90vw;
  max-width: 400px;
  overflow: hidden;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
}
.cw-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px 0;
}
.cw-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--fg-bright);
}
.cw-close {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  color: var(--fg-muted);
  background: none;
  border: none;
  cursor: pointer;
}
.cw-close:hover {
  background: var(--bg-hover);
}
.cw-body {
  padding: 12px 16px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.cw-label {
  font-size: 12px;
  color: var(--fg-muted);
  margin-top: 4px;
}
.cw-optional {
  opacity: 0.6;
  font-size: 11px;
}
.cw-path-row {
  display: flex;
  gap: 6px;
}
.cw-input {
  background: var(--bg-input);
  border: 1px solid var(--border);
  border-radius: 4px;
  color: inherit;
  font: inherit;
  font-size: 13px;
  padding: 8px 10px;
  outline: none;
  flex: 1;
  min-width: 0;
  box-sizing: border-box;
}
.cw-input:focus {
  border-color: var(--accent);
}
.cw-input:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.cw-color-row {
  display: flex;
  align-items: center;
  gap: 5px;
}
.cw-color-swatch {
  width: 18px;
  height: 18px;
  flex-shrink: 0;
  padding: 0;
  border: 2px solid transparent;
  border-radius: 4px;
  cursor: pointer;
}
.cw-color-swatch.selected {
  border-color: var(--fg-bright);
  box-shadow: 0 0 0 1px var(--bg-surface);
}
.cw-color-input {
  width: 78px;
  flex: 0 1 78px;
  padding: 5px 6px;
}
.cw-default-btn {
  flex-shrink: 0;
  padding: 5px 6px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--bg-input);
  color: var(--fg-muted);
  font-size: 11px;
  cursor: pointer;
}
.cw-default-btn:hover {
  border-color: var(--accent);
  color: var(--fg);
}
.cw-browse-btn {
  flex-shrink: 0;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--bg-input);
  color: var(--fg-muted);
  cursor: pointer;
  display: flex;
  align-items: center;
}
.cw-browse-btn:hover {
  border-color: var(--accent);
  color: var(--fg);
}
.cw-error {
  font-size: 12px;
  color: var(--color-red, #ef4444);
  margin: 2px 0 0;
}
.cw-mode-toggle {
  display: flex;
  gap: 0;
  border: 1px solid var(--border);
  border-radius: 4px;
  overflow: hidden;
  margin-bottom: 4px;
}
.cw-mode-btn {
  flex: 1;
  padding: 6px 12px;
  border: none;
  background: var(--bg-input);
  color: var(--fg-muted);
  font-size: 12px;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}
.cw-mode-btn.active {
  background: var(--accent, #007acc);
  color: #fff;
}
.cw-mode-btn:not(.active):hover {
  background: var(--bg-hover);
}
.cw-select {
  appearance: auto;
  cursor: pointer;
}
.cw-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 16px 14px;
}
.cw-btn {
  padding: 6px 16px;
  border-radius: 5px;
  font-size: 13px;
  cursor: pointer;
  border: none;
  color: var(--fg-muted);
  background: none;
}
.cw-btn.cancel:hover {
  background: var(--bg-hover);
  color: var(--fg);
}
.cw-btn.primary {
  background: var(--accent);
  color: #fff;
}
.cw-btn.primary:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.cw-btn.primary:hover:not(:disabled) {
  opacity: 0.9;
}
</style>
