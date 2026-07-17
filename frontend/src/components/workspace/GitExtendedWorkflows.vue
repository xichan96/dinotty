<template>
  <section class="git-extended-section" :aria-label="t('gitPanel.extendedWorkflows')">
    <button
      type="button"
      data-testid="git-extended-heading"
      class="git-extended-heading"
      @click="toggleExpanded"
    >
      <ChevronDown :size="13" :class="{ collapsed: !expanded }" />
      <Boxes :size="13" />
      <span>{{ t('gitPanel.extendedWorkflows') }}</span>
    </button>

    <template v-if="expanded">
      <p v-if="errorMessage" class="git-extended-message error" role="alert">
        {{ errorMessage }}
      </p>
      <p v-else-if="statusMessage" class="git-extended-message success" role="status">
        {{ statusMessage }}
      </p>

      <section class="git-extended-group">
        <div class="git-extended-group-header">
          <span>{{ t('gitPanel.worktrees') }}</span>
          <button
            type="button"
            class="git-extended-icon-button"
            :disabled="loadingWorktrees"
            @click="loadWorktrees"
          >
            <RefreshCw :size="13" :class="{ spinning: loadingWorktrees }" />
          </button>
        </div>
        <div class="git-extended-form">
          <input
            v-model="worktreeDirectory"
            type="text"
            :placeholder="t('gitPanel.worktreeDirectory')"
          />
          <input v-model="worktreeBranch" type="text" :placeholder="t('gitPanel.newBranchName')" />
          <input v-model="worktreeStartPoint" type="text" :placeholder="t('gitPanel.tagTarget')" />
          <button
            type="button"
            :disabled="busy || !worktreeDirectory.trim()"
            @click="createWorktree"
          >
            <Plus :size="13" />{{ t('gitPanel.createWorktree') }}
          </button>
        </div>
        <div v-if="worktrees.length" class="git-extended-list">
          <div v-for="worktree in worktrees" :key="worktree.path" class="git-extended-row">
            <span>
              <strong>{{ worktree.branch || t('gitPanel.detachedHead') }}</strong>
              <code>{{ worktree.path }}</code>
            </span>
            <button
              type="button"
              class="git-extended-icon-button danger"
              :disabled="busy"
              @click="removeWorktree(worktree.path)"
            >
              <Trash2 :size="13" />
            </button>
          </div>
        </div>
        <p v-else class="git-extended-empty">{{ t('gitPanel.noWorktrees') }}</p>
      </section>

      <section class="git-extended-group">
        <div class="git-extended-group-header">
          <span>{{ t('gitPanel.submodules') }}</span>
          <button
            type="button"
            class="git-extended-icon-button"
            :disabled="loadingSubmodules"
            @click="loadSubmodules"
          >
            <RefreshCw :size="13" :class="{ spinning: loadingSubmodules }" />
          </button>
        </div>
        <div class="git-extended-options">
          <label
            ><input v-model="submoduleInitialize" type="checkbox" />{{
              t('gitPanel.submoduleInitialize')
            }}</label
          >
          <label
            ><input v-model="submoduleRecursive" type="checkbox" />{{
              t('gitPanel.submoduleRecursive')
            }}</label
          >
          <label
            ><input v-model="submoduleRemote" type="checkbox" />{{
              t('gitPanel.submoduleRemote')
            }}</label
          >
        </div>
        <button
          type="button"
          class="git-extended-command"
          :disabled="busy"
          @click="updateSubmodule('')"
        >
          <Download :size="13" />{{ t('gitPanel.updateAllSubmodules') }}
        </button>
        <div v-if="submodules.length" class="git-extended-list">
          <div v-for="submodule in submodules" :key="submodule.path" class="git-extended-row">
            <span>
              <strong>{{ submodule.path }}</strong>
              <small>{{ submodule.status }} {{ submodule.description }}</small>
            </span>
            <button
              type="button"
              class="git-extended-icon-button"
              :disabled="busy"
              @click="updateSubmodule(submodule.path)"
            >
              <RefreshCw :size="13" />
            </button>
          </div>
        </div>
        <p v-else class="git-extended-empty">{{ t('gitPanel.noSubmodules') }}</p>
      </section>

      <section class="git-extended-group">
        <div class="git-extended-group-header">
          <span>{{ t('gitPanel.gitLfs') }}</span>
          <button
            type="button"
            class="git-extended-icon-button"
            :disabled="loadingLfs"
            @click="loadLfsTracks"
          >
            <RefreshCw :size="13" :class="{ spinning: loadingLfs }" />
          </button>
        </div>
        <div class="git-extended-form">
          <input v-model="lfsPattern" type="text" :placeholder="t('gitPanel.lfsPattern')" />
          <button type="button" :disabled="busy || !lfsPattern.trim()" @click="trackLfsPattern">
            <Plus :size="13" />{{ t('gitPanel.trackLfsPattern') }}
          </button>
        </div>
        <div class="git-extended-form">
          <select v-model="selectedRemote">
            <option value="">{{ t('gitPanel.noRemote') }}</option>
            <option v-for="remote in remotes" :key="remote.name" :value="remote.name">
              {{ remote.name }}
            </option>
          </select>
          <button type="button" :disabled="busy" @click="syncLfs('git-lfs-pull')">
            <Download :size="13" />{{ t('gitPanel.lfsPull') }}
          </button>
          <button type="button" :disabled="busy" @click="syncLfs('git-lfs-push')">
            <Upload :size="13" />{{ t('gitPanel.lfsPush') }}
          </button>
        </div>
        <div v-if="lfsPatterns.length" class="git-extended-tags">
          <code v-for="pattern in lfsPatterns" :key="pattern">{{ pattern }}</code>
        </div>
        <p v-else class="git-extended-empty">{{ t('gitPanel.noLfsPatterns') }}</p>
      </section>
    </template>
  </section>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { Boxes, ChevronDown, Download, Plus, RefreshCw, Trash2, Upload } from 'lucide-vue-next'
import { apiUrl, authFetch, getApiBase } from '../../composables/apiBase'
import { useI18n } from '../../composables/useI18n'
import { appendGitRepository, type GitRemoteEntry } from '../../utils/gitPanel'

interface GitWorktreeEntry {
  path: string
  branch: string
  detached: boolean
  locked: boolean
  prunable: boolean
}

interface GitSubmoduleEntry {
  path: string
  status: string
  description: string
}

const props = defineProps<{
  paneId: string
  repository?: string
  remotes: GitRemoteEntry[]
}>()

const emit = defineEmits<{
  refresh: []
}>()

const { t } = useI18n()
const expanded = ref(false)
const busy = ref(false)
const loadingWorktrees = ref(false)
const loadingSubmodules = ref(false)
const loadingLfs = ref(false)
const errorMessage = ref('')
const statusMessage = ref('')
const worktrees = ref<GitWorktreeEntry[]>([])
const submodules = ref<GitSubmoduleEntry[]>([])
const lfsPatterns = ref<string[]>([])
const worktreeDirectory = ref('')
const worktreeBranch = ref('')
const worktreeStartPoint = ref('')
const submoduleInitialize = ref(true)
const submoduleRecursive = ref(true)
const submoduleRemote = ref(false)
const lfsPattern = ref('')
const selectedRemote = ref('')

function buildQuery(): string {
  // 步骤1：所有扩展工作流都绑定当前 pane 和仓库。
  const query = new URLSearchParams({ pane_id: props.paneId })
  appendGitRepository(query, props.repository)
  return query.toString()
}

function clearMessages(): void {
  // 步骤1：每次新操作前清理旧结果。
  errorMessage.value = ''
  statusMessage.value = ''
}

async function parseResponse(response: Response): Promise<Record<string, unknown>> {
  // 步骤1：后端部分 Git 命令可能没有 JSON body，失败时返回空对象。
  return await response.json().catch(function emptyExtendedResult() {
    return {}
  })
}

async function postGitAction(endpoint: string, body: Record<string, unknown>): Promise<boolean> {
  // 步骤1：发送结构化请求并把真实 Git 输出显示给用户。
  busy.value = true
  clearMessages()
  try {
    await getApiBase()
    const response = await authFetch(apiUrl(`/api/workspace/${endpoint}?${buildQuery()}`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const result = await parseResponse(response)
    if (!response.ok) {
      errorMessage.value = String(result.error || t('gitPanel.extendedOperationFailed'))
      return false
    }
    statusMessage.value = String(result.output || t('gitPanel.extendedOperationSucceeded'))
    emit('refresh')
    return true
  } catch {
    errorMessage.value = t('gitPanel.extendedOperationFailed')
    return false
  } finally {
    busy.value = false
  }
}

function toggleExpanded(): void {
  // 步骤1：首次展开时加载三类扩展状态。
  expanded.value = !expanded.value
  if (expanded.value) {
    void loadWorktrees()
    void loadSubmodules()
    void loadLfsTracks()
  }
}

async function loadWorktrees(): Promise<void> {
  // 步骤1：读取当前仓库 worktree 列表。
  loadingWorktrees.value = true
  clearMessages()
  try {
    await getApiBase()
    const response = await authFetch(apiUrl(`/api/workspace/git-worktrees?${buildQuery()}`))
    const result = await parseResponse(response)
    if (!response.ok) {
      errorMessage.value = String(result.error || t('gitPanel.extendedOperationFailed'))
      return
    }
    worktrees.value = Array.isArray(result.worktrees)
      ? (result.worktrees as GitWorktreeEntry[])
      : []
  } catch {
    errorMessage.value = t('gitPanel.extendedOperationFailed')
  } finally {
    loadingWorktrees.value = false
  }
}

async function createWorktree(): Promise<void> {
  // 步骤1：创建成功后刷新 worktree 列表。
  const succeeded = await postGitAction('git-worktree-create', {
    directory: worktreeDirectory.value.trim(),
    branch: worktreeBranch.value.trim(),
    start_point: worktreeStartPoint.value.trim(),
  })
  if (succeeded) {
    worktreeDirectory.value = ''
    worktreeBranch.value = ''
    worktreeStartPoint.value = ''
    await loadWorktrees()
  }
}

async function removeWorktree(path: string): Promise<void> {
  // 步骤1：删除选中的 worktree，然后刷新列表。
  const succeeded = await postGitAction('git-worktree-remove', { path, force: true })
  if (succeeded) await loadWorktrees()
}

async function loadSubmodules(): Promise<void> {
  // 步骤1：读取子模块状态。
  loadingSubmodules.value = true
  clearMessages()
  try {
    await getApiBase()
    const response = await authFetch(apiUrl(`/api/workspace/git-submodules?${buildQuery()}`))
    const result = await parseResponse(response)
    if (!response.ok) {
      errorMessage.value = String(result.error || t('gitPanel.extendedOperationFailed'))
      return
    }
    submodules.value = Array.isArray(result.submodules)
      ? (result.submodules as GitSubmoduleEntry[])
      : []
  } catch {
    errorMessage.value = t('gitPanel.extendedOperationFailed')
  } finally {
    loadingSubmodules.value = false
  }
}

async function updateSubmodule(path: string): Promise<void> {
  // 步骤1：按当前选项更新全部或单个子模块。
  const succeeded = await postGitAction('git-submodule-update', {
    path,
    initialize: submoduleInitialize.value,
    recursive: submoduleRecursive.value,
    remote: submoduleRemote.value,
  })
  if (succeeded) await loadSubmodules()
}

async function loadLfsTracks(): Promise<void> {
  // 步骤1：读取 LFS 跟踪模式。
  loadingLfs.value = true
  clearMessages()
  try {
    await getApiBase()
    const response = await authFetch(apiUrl(`/api/workspace/git-lfs-tracks?${buildQuery()}`))
    const result = await parseResponse(response)
    if (!response.ok) {
      errorMessage.value = String(result.error || t('gitPanel.extendedOperationFailed'))
      return
    }
    lfsPatterns.value = Array.isArray(result.patterns) ? (result.patterns as string[]) : []
  } catch {
    errorMessage.value = t('gitPanel.extendedOperationFailed')
  } finally {
    loadingLfs.value = false
  }
}

async function trackLfsPattern(): Promise<void> {
  // 步骤1：添加 LFS 跟踪模式，并刷新模式列表。
  const succeeded = await postGitAction('git-lfs-track', { pattern: lfsPattern.value.trim() })
  if (succeeded) {
    lfsPattern.value = ''
    await loadLfsTracks()
  }
}

async function syncLfs(endpoint: 'git-lfs-pull' | 'git-lfs-push'): Promise<void> {
  // 步骤1：按选中的 Remote 同步 LFS 对象。
  await postGitAction(endpoint, { remote: selectedRemote.value })
}
</script>

<style scoped>
.git-extended-section {
  border-bottom: 1px solid var(--border);
}

.git-extended-heading,
.git-extended-command,
.git-extended-form button {
  width: 100%;
  border: 0;
  color: var(--fg);
  background: transparent;
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
}

.git-extended-heading {
  padding: 7px 10px;
  font-size: 12px;
}

.git-extended-heading .collapsed {
  transform: rotate(-90deg);
}

.git-extended-group {
  padding: 8px 10px;
  border-top: 1px solid var(--border);
}

.git-extended-group-header,
.git-extended-row,
.git-extended-options,
.git-extended-form {
  display: flex;
  align-items: center;
  gap: 6px;
}

.git-extended-group-header {
  justify-content: space-between;
  margin-bottom: 6px;
  font-size: 12px;
  font-weight: 600;
}

.git-extended-form {
  flex-wrap: wrap;
  margin-bottom: 6px;
}

.git-extended-form input,
.git-extended-form select {
  min-width: 0;
  flex: 1 1 110px;
  border: 1px solid var(--border);
  color: var(--fg);
  background: var(--input-bg, var(--bg));
  border-radius: 4px;
  padding: 4px 6px;
  font-size: 12px;
}

.git-extended-form button,
.git-extended-command {
  justify-content: center;
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 4px 7px;
  font-size: 12px;
}

.git-extended-options {
  flex-wrap: wrap;
  margin-bottom: 6px;
  font-size: 11px;
  color: var(--muted);
}

.git-extended-list {
  display: grid;
  gap: 4px;
}

.git-extended-row {
  justify-content: space-between;
  min-width: 0;
  padding: 5px 0;
}

.git-extended-row span {
  min-width: 0;
  display: grid;
  gap: 2px;
}

.git-extended-row code,
.git-extended-tags code {
  color: var(--muted);
  font-size: 11px;
}

.git-extended-icon-button {
  border: 0;
  color: var(--muted);
  background: transparent;
  cursor: pointer;
}

.git-extended-icon-button.danger {
  color: var(--danger, #f87171);
}

.git-extended-message,
.git-extended-empty {
  margin: 6px 10px;
  font-size: 12px;
  color: var(--muted);
}

.git-extended-message.error {
  color: var(--danger, #f87171);
}

.git-extended-message.success {
  color: var(--success, #22c55e);
}

.git-extended-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}

.spinning {
  animation: git-extended-spin 0.8s linear infinite;
}

@keyframes git-extended-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
