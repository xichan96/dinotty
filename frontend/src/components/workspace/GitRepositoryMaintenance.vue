<template>
  <section class="git-maintenance-section" :aria-label="t('gitPanel.repositoryMaintenance')">
    <button
      type="button"
      data-testid="git-maintenance-heading"
      class="git-maintenance-heading"
      @click="toggleExpanded"
    >
      <ChevronDown :size="13" :class="{ collapsed: !expanded }" />
      <ShieldCheck :size="13" />
      <span>{{ t('gitPanel.repositoryMaintenance') }}</span>
    </button>

    <template v-if="expanded">
      <p v-if="errorMessage" class="git-maintenance-message error" role="alert">
        {{ errorMessage }}
      </p>
      <p v-else-if="statusMessage" class="git-maintenance-message success" role="status">
        {{ statusMessage }}
      </p>

      <section class="git-maintenance-group" :aria-label="t('gitPanel.gitIgnore')">
        <div class="git-maintenance-group-header">
          <span>{{ t('gitPanel.gitIgnore') }}</span>
          <button
            type="button"
            class="git-maintenance-icon-button"
            :title="t('gitPanel.refreshGitIgnore')"
            :aria-label="t('gitPanel.refreshGitIgnore')"
            :disabled="loadingIgnore"
            @click="loadGitIgnore"
          >
            <RefreshCw :size="13" :class="{ spinning: loadingIgnore }" />
          </button>
        </div>
        <textarea
          v-model="ignoreContent"
          data-testid="git-ignore-editor"
          :placeholder="t('gitPanel.gitIgnorePlaceholder')"
          spellcheck="false"
        ></textarea>
        <button
          type="button"
          data-testid="git-ignore-save"
          class="git-maintenance-command"
          :disabled="savingIgnore || loadingIgnore"
          @click="saveGitIgnore"
        >
          <LoaderCircle v-if="savingIgnore" :size="13" class="spinning" />
          <Save v-else :size="13" />
          <span>{{ t('gitPanel.saveGitIgnore') }}</span>
        </button>
      </section>

      <section class="git-maintenance-group" :aria-label="t('gitPanel.cleanUntracked')">
        <div class="git-maintenance-group-header">
          <span>{{ t('gitPanel.cleanUntracked') }}</span>
          <button
            type="button"
            data-testid="git-clean-preview"
            class="git-maintenance-command compact"
            :disabled="loadingPreview || cleaning"
            @click="loadCleanPreview"
          >
            <LoaderCircle v-if="loadingPreview" :size="13" class="spinning" />
            <Search v-else :size="13" />
            <span>{{ t('gitPanel.previewClean') }}</span>
          </button>
        </div>
        <p class="git-maintenance-note">{{ t('gitPanel.cleanSafetyNote') }}</p>
        <template v-if="previewLoaded">
          <div v-if="cleanPaths.length" class="git-clean-selection-tools">
            <span>
              {{
                t('gitPanel.cleanSelectedCount')
                  .replace('{selected}', String(selectedCount))
                  .replace('{total}', String(cleanPaths.length))
              }}
            </span>
            <button type="button" @click="selectAllCleanPaths">
              {{ t('gitPanel.selectAll') }}
            </button>
            <button type="button" @click="selectNoCleanPaths">
              {{ t('gitPanel.selectNone') }}
            </button>
          </div>
          <div v-if="cleanPaths.length" class="git-clean-list">
            <label
              v-for="path in cleanPaths"
              :key="path"
              data-testid="git-clean-row"
              class="git-clean-row"
            >
              <input
                type="checkbox"
                :checked="isCleanPathSelected(path)"
                @change="toggleCleanPath(path)"
              />
              <Folder v-if="path.endsWith('/')" :size="12" />
              <File v-else :size="12" />
              <code>{{ path }}</code>
            </label>
          </div>
          <p v-else class="git-maintenance-empty">{{ t('gitPanel.nothingToClean') }}</p>
          <button
            v-if="cleanPaths.length"
            type="button"
            data-testid="git-clean-selected"
            class="git-maintenance-command danger"
            :disabled="selectedCount === 0 || cleaning"
            @click="cleanConfirmationVisible = true"
          >
            <Trash2 :size="13" />
            <span>{{ t('gitPanel.cleanSelected') }}</span>
          </button>
        </template>
      </section>

      <section class="git-maintenance-group" :aria-label="t('gitPanel.safetyBackups')">
        <div class="git-maintenance-group-header">
          <span>{{ t('gitPanel.safetyBackups') }}</span>
          <button
            type="button"
            class="git-maintenance-icon-button"
            :disabled="loadingBackups"
            @click="loadBackups"
          >
            <RefreshCw :size="13" :class="{ spinning: loadingBackups }" />
          </button>
        </div>
        <div v-if="backups.length" class="git-backup-list">
          <div
            v-for="backup in backups"
            :key="backup.name"
            data-testid="git-backup-row"
            class="git-backup-row"
          >
            <span>
              <strong>{{ backup.reason }}</strong>
              <code>{{ backup.paths.join(', ') }}</code>
              <small>{{ formatBackupSize(backup.size) }}</small>
            </span>
            <button
              type="button"
              data-testid="git-backup-restore"
              class="git-maintenance-icon-button"
              :title="t('gitPanel.restoreBackup')"
              @click="backupPendingAction = { backup, action: 'restore' }"
            >
              <ArchiveRestore :size="13" />
            </button>
            <button
              type="button"
              class="git-maintenance-icon-button danger"
              :title="t('gitPanel.deleteBackup')"
              @click="backupPendingAction = { backup, action: 'delete' }"
            >
              <Trash2 :size="13" />
            </button>
          </div>
        </div>
        <p v-else class="git-maintenance-empty">{{ t('gitPanel.noSafetyBackups') }}</p>
      </section>
    </template>

    <ConfirmModal
      :visible="cleanConfirmationVisible"
      :title="t('gitPanel.cleanSelected')"
      :message="cleanConfirmationMessage"
      :confirm-text="t('gitPanel.cleanSelected')"
      :cancel-text="t('filePreview.cancel')"
      @confirm="cleanSelectedPaths"
      @cancel="cleanConfirmationVisible = false"
    />
    <ConfirmModal
      :visible="!!backupPendingAction"
      :title="backupActionTitle"
      :message="backupActionMessage"
      :confirm-text="backupActionTitle"
      :cancel-text="t('filePreview.cancel')"
      @confirm="runBackupAction"
      @cancel="backupPendingAction = null"
    />
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  ArchiveRestore,
  ChevronDown,
  File,
  Folder,
  LoaderCircle,
  RefreshCw,
  Save,
  Search,
  ShieldCheck,
  Trash2,
} from 'lucide-vue-next'
import { apiUrl, authFetch, getApiBase } from '../../composables/apiBase'
import { useI18n } from '../../composables/useI18n'
import { appendGitRepository } from '../../utils/gitPanel'
import ConfirmModal from '../ui/ConfirmModal.vue'

const props = defineProps<{
  paneId: string
  repository?: string
}>()

interface GitBackupEntry {
  name: string
  reason: string
  createdAt: number
  paths: string[]
  size: number
}

const emit = defineEmits<{
  refresh: []
}>()

const { t } = useI18n()
const expanded = ref(false)
const loadingIgnore = ref(false)
const savingIgnore = ref(false)
const loadingPreview = ref(false)
const cleaning = ref(false)
const previewLoaded = ref(false)
const cleanConfirmationVisible = ref(false)
const loadingBackups = ref(false)
const ignoreContent = ref('')
const cleanPaths = ref<string[]>([])
const selectedCleanPaths = ref<Set<string>>(new Set())
const errorMessage = ref('')
const statusMessage = ref('')
const backups = ref<GitBackupEntry[]>([])
const backupPendingAction = ref<{
  backup: GitBackupEntry
  action: 'restore' | 'delete'
} | null>(null)

const selectedCount = computed(function countSelectedCleanPaths() {
  return selectedCleanPaths.value.size
})

const cleanConfirmationMessage = computed(function computeCleanConfirmationMessage() {
  return t('gitPanel.cleanConfirmation').replace('{count}', String(selectedCount.value))
})

const backupActionTitle = computed(function computeBackupActionTitle() {
  return backupPendingAction.value?.action === 'delete'
    ? t('gitPanel.deleteBackup')
    : t('gitPanel.restoreBackup')
})

const backupActionMessage = computed(function computeBackupActionMessage() {
  // 步骤1：确认信息显示服务端生成的备份名称。
  return t('gitPanel.backupActionMessage').replace(
    '{name}',
    backupPendingAction.value?.backup.name || ''
  )
})

function buildQuery(): string {
  // 步骤1：维护操作始终绑定当前 pane 和仓库。
  const query = new URLSearchParams({ pane_id: props.paneId })
  appendGitRepository(query, props.repository)
  return query.toString()
}

function clearMessages(): void {
  // 步骤1：每次新操作前清理旧结果，避免状态混淆。
  errorMessage.value = ''
  statusMessage.value = ''
}

function toggleExpanded(): void {
  // 步骤1：首次展开时读取仓库根 .gitignore。
  expanded.value = !expanded.value
  if (expanded.value) {
    void loadGitIgnore()
    void loadBackups()
  }
}

async function loadBackups(): Promise<void> {
  // 步骤1：读取服务端结构化备份并转换固定字段。
  loadingBackups.value = true
  try {
    await getApiBase()
    const response = await authFetch(apiUrl(`/api/workspace/git-backups?${buildQuery()}`))
    const result = await response.json()
    const nextBackups: GitBackupEntry[] = []
    if (response.ok && Array.isArray(result.backups)) {
      for (const backup of result.backups) {
        const paths: string[] = []
        if (Array.isArray(backup.paths)) {
          for (const value of backup.paths) {
            paths.push(String(value))
          }
        }
        nextBackups.push({
          name: String(backup.name || ''),
          reason: String(backup.reason || ''),
          createdAt: Number(backup.created_at || 0),
          paths,
          size: Number(backup.size || 0),
        })
      }
    }
    backups.value = nextBackups
  } catch {
    errorMessage.value = t('gitPanel.backupOperationFailed')
  } finally {
    loadingBackups.value = false
  }
}

function formatBackupSize(size: number): string {
  // 步骤1：紧凑显示字节或 MiB，避免长数字撑开侧栏。
  if (size < 1024 * 1024) return `${Math.ceil(size / 1024)} KiB`
  return `${(size / 1024 / 1024).toFixed(1)} MiB`
}

async function runBackupAction(): Promise<void> {
  // 步骤1：恢复和删除都通过确认状态发送服务端生成的名称。
  const pendingAction = backupPendingAction.value
  backupPendingAction.value = null
  if (!pendingAction) return
  const endpoint = pendingAction.action === 'restore' ? 'git-backup-restore' : 'git-backup-delete'
  try {
    await getApiBase()
    const response = await authFetch(apiUrl(`/api/workspace/${endpoint}?${buildQuery()}`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: pendingAction.backup.name, confirm: true }),
    })
    if (!response.ok) {
      const result = await response.json().catch(function emptyBackupResult() {
        return {}
      })
      errorMessage.value = result.error || t('gitPanel.backupOperationFailed')
      return
    }
    emit('refresh')
    await loadBackups()
  } catch {
    errorMessage.value = t('gitPanel.backupOperationFailed')
  }
}

async function loadGitIgnore(): Promise<void> {
  // 步骤1：读取仓库根忽略规则。
  loadingIgnore.value = true
  clearMessages()
  try {
    await getApiBase()
    const response = await authFetch(apiUrl(`/api/workspace/git-ignore?${buildQuery()}`))
    const result = await response.json()
    if (!response.ok) {
      errorMessage.value = result.error || t('gitPanel.gitIgnoreFailed')
      return
    }
    ignoreContent.value = String(result.content || '')
  } catch {
    errorMessage.value = t('gitPanel.gitIgnoreFailed')
  } finally {
    loadingIgnore.value = false
  }
}

async function saveGitIgnore(): Promise<void> {
  // 步骤1：保存编辑器中的完整内容并刷新 Git 状态。
  savingIgnore.value = true
  clearMessages()
  try {
    await getApiBase()
    const response = await authFetch(apiUrl(`/api/workspace/git-ignore?${buildQuery()}`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: ignoreContent.value }),
    })
    const result = await response.json()
    if (!response.ok) {
      errorMessage.value = result.error || t('gitPanel.gitIgnoreFailed')
      return
    }
    statusMessage.value = t('gitPanel.gitIgnoreSaved')
    emit('refresh')
  } catch {
    errorMessage.value = t('gitPanel.gitIgnoreFailed')
  } finally {
    savingIgnore.value = false
  }
}

async function loadCleanPreview(): Promise<void> {
  // 步骤1：读取 Git dry-run 路径，并默认勾选本次预览的所有项目。
  loadingPreview.value = true
  previewLoaded.value = false
  clearMessages()
  try {
    await getApiBase()
    const response = await authFetch(apiUrl(`/api/workspace/git-clean-preview?${buildQuery()}`))
    const result = await response.json()
    if (!response.ok) {
      errorMessage.value = result.error || t('gitPanel.cleanPreviewFailed')
      return
    }
    const nextPaths: string[] = []
    if (Array.isArray(result.paths)) {
      for (const value of result.paths) {
        const path = String(value || '')
        if (path) nextPaths.push(path)
      }
    }
    cleanPaths.value = nextPaths
    selectedCleanPaths.value = new Set(nextPaths)
    previewLoaded.value = true
  } catch {
    errorMessage.value = t('gitPanel.cleanPreviewFailed')
  } finally {
    loadingPreview.value = false
  }
}

function isCleanPathSelected(path: string): boolean {
  // 步骤1：复选框状态来自当前选择集合。
  return selectedCleanPaths.value.has(path)
}

function toggleCleanPath(path: string): void {
  // 步骤1：复制集合后切换单项，确保 Vue 检测到状态变化。
  const nextSelection = new Set(selectedCleanPaths.value)
  if (nextSelection.has(path)) nextSelection.delete(path)
  else nextSelection.add(path)
  selectedCleanPaths.value = nextSelection
}

function selectAllCleanPaths(): void {
  // 步骤1：选中当前预览的全部路径。
  selectedCleanPaths.value = new Set(cleanPaths.value)
}

function selectNoCleanPaths(): void {
  // 步骤1：清空选择但保留预览结果。
  selectedCleanPaths.value = new Set()
}

async function cleanSelectedPaths(): Promise<void> {
  // 步骤1：按预览顺序构造明确选择的路径列表。
  cleanConfirmationVisible.value = false
  const paths: string[] = []
  for (const path of cleanPaths.value) {
    if (selectedCleanPaths.value.has(path)) paths.push(path)
  }
  if (!paths.length) return

  // 步骤2：提交确认后的路径，成功后重新预览并刷新仓库状态。
  cleaning.value = true
  clearMessages()
  try {
    await getApiBase()
    const response = await authFetch(apiUrl(`/api/workspace/git-clean?${buildQuery()}`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paths }),
    })
    const result = await response.json()
    if (!response.ok) {
      errorMessage.value = result.error || t('gitPanel.cleanFailed')
      return
    }
    emit('refresh')
    await loadCleanPreview()
    statusMessage.value = t('gitPanel.cleanCompleted')
  } catch {
    errorMessage.value = t('gitPanel.cleanFailed')
  } finally {
    cleaning.value = false
  }
}
</script>

<style scoped>
.git-maintenance-section {
  border-bottom: 1px solid var(--border);
}

.git-maintenance-heading {
  width: 100%;
  min-height: 31px;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 8px;
  border: 0;
  color: var(--fg-muted);
  background: transparent;
  cursor: pointer;
  font-size: 10px;
  text-align: left;
  text-transform: uppercase;
}

.git-maintenance-heading:hover,
.git-maintenance-heading:focus-visible {
  color: var(--fg-bright);
  background: var(--bg-hover);
  outline: none;
}

.git-maintenance-heading svg:first-child {
  transition: transform 0.15s ease;
}

.git-maintenance-heading svg.collapsed {
  transform: rotate(-90deg);
}

.git-maintenance-message,
.git-maintenance-note,
.git-maintenance-empty {
  margin: 0;
  padding: 6px 8px;
  color: var(--fg-muted);
  font-size: 9px;
}

.git-maintenance-message.error {
  color: var(--color-red, #e06c75);
}

.git-maintenance-message.success {
  color: var(--color-green, #62b478);
}

.git-maintenance-group {
  display: grid;
  gap: 6px;
  padding: 8px;
  border-top: 1px solid var(--border);
}

.git-maintenance-group-header,
.git-clean-selection-tools {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--fg-muted);
  font-size: 9px;
}

.git-maintenance-group-header > span,
.git-clean-selection-tools > span {
  min-width: 0;
  flex: 1;
}

.git-maintenance-icon-button {
  width: 24px;
  height: 24px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 3px;
  color: var(--fg-muted);
  background: transparent;
  cursor: pointer;
}

.git-maintenance-section textarea {
  width: 100%;
  min-height: 118px;
  resize: vertical;
  border: 1px solid var(--border);
  border-radius: 3px;
  color: var(--fg);
  background: var(--bg);
  font-family: var(--font-mono);
  font-size: 9px;
  line-height: 1.5;
}

.git-maintenance-command,
.git-clean-selection-tools button {
  min-height: 26px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  border: 1px solid var(--border);
  border-radius: 3px;
  color: var(--fg-muted);
  background: transparent;
  cursor: pointer;
  font-size: 9px;
}

.git-maintenance-command.compact {
  min-height: 24px;
  padding: 0 7px;
}

.git-maintenance-command.danger {
  color: var(--color-red, #e06c75);
}

.git-maintenance-command:hover:not(:disabled),
.git-maintenance-command:focus-visible,
.git-clean-selection-tools button:hover,
.git-clean-selection-tools button:focus-visible {
  border-color: var(--accent);
  color: var(--fg-bright);
  background: var(--bg-hover);
  outline: none;
}

.git-maintenance-command:disabled {
  cursor: default;
  opacity: 0.45;
}

.git-clean-selection-tools button {
  min-height: 22px;
  padding: 0 5px;
}

.git-clean-list {
  max-height: 180px;
  overflow: auto;
  border: 1px solid var(--border);
  border-radius: 3px;
}

.git-clean-row {
  min-height: 25px;
  display: grid;
  grid-template-columns: 16px 14px minmax(0, 1fr);
  align-items: center;
  gap: 4px;
  padding: 0 6px;
  border-bottom: 1px solid var(--border);
  color: var(--fg-muted);
  cursor: pointer;
}

.git-clean-row:last-child {
  border-bottom: 0;
}

.git-clean-row:hover {
  background: var(--bg-hover);
}

.git-clean-row input {
  margin: 0;
  accent-color: var(--accent);
}

.git-clean-row code {
  min-width: 0;
  overflow: hidden;
  font-size: 9px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.git-backup-list {
  border: 1px solid var(--border);
}

.git-backup-row {
  min-height: 38px;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 6px;
  border-bottom: 1px solid var(--border);
}

.git-backup-row:last-child {
  border-bottom: 0;
}

.git-backup-row > span {
  min-width: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
}

.git-backup-row code {
  overflow: hidden;
  font-size: 8px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.git-backup-row small {
  color: var(--fg-muted);
  font-size: 8px;
}

.git-maintenance-icon-button.danger:hover {
  color: var(--color-red, #e06c75);
}

.spinning {
  animation: git-maintenance-spin 0.8s linear infinite;
}

@keyframes git-maintenance-spin {
  to {
    transform: rotate(360deg);
  }
}

@media (prefers-reduced-motion: reduce) {
  .git-maintenance-heading svg:first-child {
    transition: none;
  }

  .spinning {
    animation: none;
  }
}
</style>
