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
              <small v-if="worktree.current">{{ t('gitPanel.currentWorktree') }}</small>
              <small v-else-if="worktree.dirty">{{ t('gitPanel.dirtyWorktree') }}</small>
              <small v-if="worktree.locked">{{ t('gitPanel.lockedWorktree') }}</small>
              <small v-if="worktree.prunable">{{ t('gitPanel.prunableWorktree') }}</small>
            </span>
            <button
              v-if="!worktree.current"
              type="button"
              data-testid="git-worktree-lock"
              class="git-extended-icon-button"
              :disabled="busy"
              :title="worktree.locked ? t('gitPanel.unlockWorktree') : t('gitPanel.lockWorktree')"
              @click="runWorktreeAction(worktree.locked ? 'unlock' : 'lock', worktree.path)"
            >
              <UnlockKeyhole v-if="worktree.locked" :size="13" />
              <LockKeyhole v-else :size="13" />
            </button>
            <button
              v-if="!worktree.current"
              type="button"
              data-testid="git-worktree-remove"
              class="git-extended-icon-button danger"
              :disabled="busy"
              @click="requestRemoveWorktree(worktree)"
            >
              <Trash2 :size="13" />
            </button>
          </div>
        </div>
        <p v-else class="git-extended-empty">{{ t('gitPanel.noWorktrees') }}</p>
        <div class="git-extended-options">
          <button type="button" :disabled="busy" @click="runWorktreeAction('prune')">
            <ListRestart :size="13" />{{ t('gitPanel.pruneWorktrees') }}
          </button>
          <button type="button" :disabled="busy" @click="runWorktreeAction('repair')">
            <Wrench :size="13" />{{ t('gitPanel.repairWorktrees') }}
          </button>
        </div>
        <div class="git-extended-form">
          <select v-model="worktreeMovePath">
            <option value="">{{ t('gitPanel.selectWorktree') }}</option>
            <option
              v-for="worktree in movableWorktrees"
              :key="worktree.path"
              :value="worktree.path"
            >
              {{ worktree.branch || worktree.path }}
            </option>
          </select>
          <input v-model="worktreeMoveTarget" type="text" :placeholder="t('gitPanel.moveTarget')" />
          <button
            type="button"
            :disabled="busy || !worktreeMovePath || !worktreeMoveTarget.trim()"
            @click="moveWorktree"
          >
            <Move :size="13" />{{ t('gitPanel.moveWorktree') }}
          </button>
        </div>
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
        <div class="git-extended-form">
          <input v-model="submoduleUrl" type="text" :placeholder="t('gitPanel.submoduleUrl')" />
          <input v-model="submodulePath" type="text" :placeholder="t('gitPanel.submodulePath')" />
          <input
            v-model="submoduleBranch"
            type="text"
            :placeholder="t('gitPanel.submoduleBranch')"
          />
          <button
            type="button"
            :disabled="busy || !submoduleUrl.trim() || !submodulePath.trim()"
            @click="addSubmodule"
          >
            <Plus :size="13" />{{ t('gitPanel.addSubmodule') }}
          </button>
        </div>
        <button
          type="button"
          class="git-extended-command"
          :disabled="busy"
          @click="updateSubmodule('')"
        >
          <Download :size="13" />{{ t('gitPanel.updateAllSubmodules') }}
        </button>
        <button
          type="button"
          class="git-extended-command"
          :disabled="busy"
          @click="syncSubmodule('')"
        >
          <Link :size="13" />{{ t('gitPanel.syncAllSubmodules') }}
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
              :title="t('gitPanel.syncSubmodule')"
              @click="syncSubmodule(submodule.path)"
            >
              <Link :size="13" />
            </button>
            <button
              type="button"
              data-testid="git-submodule-deinit"
              class="git-extended-icon-button"
              :disabled="busy"
              :title="t('gitPanel.deinitSubmodule')"
              @click="submodulePendingDeinit = submodule.path"
            >
              <Unplug :size="13" />
            </button>
            <button
              type="button"
              class="git-extended-icon-button"
              :disabled="busy"
              @click="updateSubmodule(submodule.path)"
            >
              <RefreshCw :size="13" />
            </button>
            <button
              type="button"
              class="git-extended-icon-button danger"
              :disabled="busy"
              @click="submodulePendingRemoval = submodule.path"
            >
              <Trash2 :size="13" />
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
          <select v-model="selectedRemote" data-testid="git-lfs-remote">
            <option value="">{{ t('gitPanel.noRemote') }}</option>
            <option v-for="remote in remotes" :key="remote.name" :value="remote.name">
              {{ remote.name }}
            </option>
          </select>
          <input
            v-model="lfsReference"
            data-testid="git-lfs-reference"
            type="text"
            :disabled="lfsPushAll"
            :placeholder="t('gitPanel.lfsReference')"
          />
          <label class="git-extended-check">
            <input v-model="lfsPushAll" data-testid="git-lfs-push-all" type="checkbox" />
            <span>{{ t('gitPanel.lfsPushAll') }}</span>
          </label>
          <button type="button" :disabled="busy" @click="syncLfs('git-lfs-pull')">
            <Download :size="13" />{{ t('gitPanel.lfsPull') }}
          </button>
          <button
            type="button"
            data-testid="git-lfs-push"
            :disabled="busy || !selectedRemote || (!lfsPushAll && !lfsReference.trim())"
            @click="syncLfs('git-lfs-push')"
          >
            <Upload :size="13" />{{ t('gitPanel.lfsPush') }}
          </button>
        </div>
        <div v-if="lfsPatterns.length" class="git-extended-tags">
          <span v-for="pattern in lfsPatterns" :key="pattern">
            <code>{{ pattern }}</code>
            <button
              type="button"
              data-testid="git-lfs-untrack"
              class="git-extended-icon-button danger"
              :disabled="busy"
              @click="untrackLfsPattern(pattern)"
            >
              <X :size="12" />
            </button>
          </span>
        </div>
        <p v-else class="git-extended-empty">{{ t('gitPanel.noLfsPatterns') }}</p>
        <div class="git-extended-form">
          <input v-model="lfsLockPath" type="text" :placeholder="t('gitPanel.lfsLockPath')" />
          <button type="button" :disabled="busy || !lfsLockPath.trim()" @click="lockLfsPath">
            <LockKeyhole :size="13" />{{ t('gitPanel.lfsLock') }}
          </button>
        </div>
        <div v-if="lfsLocks.length" class="git-extended-list">
          <div v-for="lock in lfsLocks" :key="lock.id || lock.path" class="git-extended-row">
            <span
              ><strong>{{ lock.path }}</strong
              ><small>{{ lock.owner }}</small></span
            >
            <button
              type="button"
              class="git-extended-icon-button"
              :disabled="busy"
              @click="unlockLfsPath(lock.path)"
            >
              <UnlockKeyhole :size="13" />
            </button>
          </div>
        </div>
      </section>
    </template>
    <ConfirmModal
      :visible="!!worktreePendingRemoval"
      :title="t('gitPanel.removeWorktree')"
      :message="worktreeRemovalMessage"
      :confirm-text="t('gitPanel.removeWorktree')"
      :cancel-text="t('filePreview.cancel')"
      @confirm="removeWorktree"
      @cancel="worktreePendingRemoval = null"
    />
    <ConfirmModal
      :visible="!!submodulePendingDeinit"
      :title="t('gitPanel.deinitSubmodule')"
      :message="submoduleDeinitMessage"
      :confirm-text="t('gitPanel.deinitSubmodule')"
      :cancel-text="t('filePreview.cancel')"
      @confirm="deinitSubmodule"
      @cancel="submodulePendingDeinit = ''"
    />
    <ConfirmModal
      :visible="!!submodulePendingRemoval"
      :title="t('gitPanel.removeSubmodule')"
      :message="submoduleRemovalMessage"
      :confirm-text="t('gitPanel.removeSubmodule')"
      :cancel-text="t('filePreview.cancel')"
      @confirm="removeSubmodule"
      @cancel="submodulePendingRemoval = ''"
    />
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  Boxes,
  ChevronDown,
  Download,
  Link,
  ListRestart,
  LockKeyhole,
  Move,
  Plus,
  RefreshCw,
  Trash2,
  Unplug,
  UnlockKeyhole,
  Upload,
  Wrench,
  X,
} from 'lucide-vue-next'
import { apiUrl, authFetch, getApiBase } from '../../composables/apiBase'
import { useI18n } from '../../composables/useI18n'
import { appendGitRepository, type GitRemoteEntry } from '../../utils/gitPanel'
import ConfirmModal from '../ui/ConfirmModal.vue'

interface GitWorktreeEntry {
  path: string
  branch: string
  detached: boolean
  locked: boolean
  prunable: boolean
  dirty: boolean
  current: boolean
}

interface GitSubmoduleEntry {
  path: string
  status: string
  description: string
}

interface GitLfsLockEntry {
  id: string
  path: string
  owner: string
}

const props = defineProps<{
  paneId: string
  repository?: string
  remotes: GitRemoteEntry[]
  branch: string | null
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
const worktreeMovePath = ref('')
const worktreeMoveTarget = ref('')
const submoduleInitialize = ref(true)
const submoduleRecursive = ref(true)
const submoduleRemote = ref(false)
const lfsPattern = ref('')
const selectedRemote = ref('')
const lfsReference = ref(props.branch || '')
const lfsPushAll = ref(false)
const worktreePendingRemoval = ref<GitWorktreeEntry | null>(null)
const submoduleUrl = ref('')
const submodulePath = ref('')
const submoduleBranch = ref('')
const submodulePendingRemoval = ref('')
const submodulePendingDeinit = ref('')
const lfsLockPath = ref('')
const lfsLocks = ref<GitLfsLockEntry[]>([])

const movableWorktrees = computed(function computeMovableWorktrees() {
  // 步骤1：当前和锁定 Worktree 不进入移动目标列表。
  return worktrees.value.filter(function canMoveWorktree(worktree) {
    return !worktree.current && !worktree.locked
  })
})

const worktreeRemovalMessage = computed(function computeWorktreeRemovalMessage() {
  // 步骤1：脏 Worktree 明确提示会执行强制删除并已先备份改动。
  const worktree = worktreePendingRemoval.value
  if (!worktree) return ''
  const key = worktree.dirty
    ? 'gitPanel.removeDirtyWorktreeMessage'
    : 'gitPanel.removeWorktreeMessage'
  return t(key).replace('{path}', worktree.path)
})

const submoduleRemovalMessage = computed(function computeSubmoduleRemovalMessage() {
  // 步骤1：确认信息显示即将完整移除的子模块路径。
  return t('gitPanel.removeSubmoduleMessage').replace('{path}', submodulePendingRemoval.value)
})

const submoduleDeinitMessage = computed(function computeSubmoduleDeinitMessage() {
  // 步骤1：停用确认保留配置语义，并显示明确路径。
  return t('gitPanel.deinitSubmoduleMessage').replace('{path}', submodulePendingDeinit.value)
})

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

async function runWorktreeAction(
  action: 'lock' | 'unlock' | 'prune' | 'repair' | 'move',
  path = '',
  target = ''
): Promise<void> {
  // 步骤1：所有 Worktree 管理动作使用同一固定契约，成功后刷新列表。
  const succeeded = await postGitAction('git-worktree-action', { action, path, target })
  if (succeeded) await loadWorktrees()
}

async function moveWorktree(): Promise<void> {
  // 步骤1：移动成功后清空目标输入。
  await runWorktreeAction('move', worktreeMovePath.value, worktreeMoveTarget.value.trim())
  worktreeMovePath.value = ''
  worktreeMoveTarget.value = ''
}

function requestRemoveWorktree(worktree: GitWorktreeEntry): void {
  // 步骤1：保存列表中的完整状态，确认时据此选择普通或强制删除。
  worktreePendingRemoval.value = worktree
}

async function removeWorktree(): Promise<void> {
  // 步骤1：确认后删除选中的 Worktree；脏目录由后端先备份再强制删除。
  const worktree = worktreePendingRemoval.value
  worktreePendingRemoval.value = null
  if (!worktree) return
  const succeeded = await postGitAction('git-worktree-remove', {
    path: worktree.path,
    force: worktree.dirty,
    confirm_force: worktree.dirty,
  })
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

async function addSubmodule(): Promise<void> {
  // 步骤1：添加 URL、路径和可选跟踪分支，成功后刷新列表。
  const succeeded = await postGitAction('git-submodule-add', {
    url: submoduleUrl.value.trim(),
    path: submodulePath.value.trim(),
    branch: submoduleBranch.value.trim(),
  })
  if (succeeded) {
    submoduleUrl.value = ''
    submodulePath.value = ''
    submoduleBranch.value = ''
    await loadSubmodules()
  }
}

async function syncSubmodule(path: string): Promise<void> {
  // 步骤1：同步全部或指定子模块 URL。
  const succeeded = await postGitAction('git-submodule-sync', { path, confirm: false })
  if (succeeded) await loadSubmodules()
}

async function removeSubmodule(): Promise<void> {
  // 步骤1：确认后完整移除子模块，后端负责先备份。
  const path = submodulePendingRemoval.value
  submodulePendingRemoval.value = ''
  if (!path) return
  const succeeded = await postGitAction('git-submodule-remove', { path, confirm: true })
  if (succeeded) await loadSubmodules()
}

async function deinitSubmodule(): Promise<void> {
  // 步骤1：确认后只停用子模块，保留仓库配置和 Gitlink。
  const path = submodulePendingDeinit.value
  submodulePendingDeinit.value = ''
  if (!path) return
  const succeeded = await postGitAction('git-submodule-deinit', { path, confirm: true })
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
    await loadLfsLocks()
  } catch {
    errorMessage.value = t('gitPanel.extendedOperationFailed')
  } finally {
    loadingLfs.value = false
  }
}

async function loadLfsLocks(): Promise<void> {
  // 步骤1：读取 LFS 锁；工具不支持时保留空列表。
  try {
    await getApiBase()
    const response = await authFetch(apiUrl(`/api/workspace/git-lfs-locks?${buildQuery()}`))
    const result = await parseResponse(response)
    lfsLocks.value =
      response.ok && Array.isArray(result.locks) ? (result.locks as GitLfsLockEntry[]) : []
  } catch {
    lfsLocks.value = []
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
  // 步骤1：Pull 只需要 Remote，Push 还必须携带 ref 或全量模式。
  if (endpoint === 'git-lfs-push') {
    await postGitAction(endpoint, {
      remote: selectedRemote.value,
      reference: lfsReference.value.trim(),
      all: lfsPushAll.value,
    })
    return
  }
  await postGitAction(endpoint, { remote: selectedRemote.value })
}

async function untrackLfsPattern(pattern: string): Promise<void> {
  // 步骤1：取消一个服务端返回的现有模式。
  const succeeded = await postGitAction('git-lfs-untrack', { pattern })
  if (succeeded) await loadLfsTracks()
}

async function lockLfsPath(): Promise<void> {
  // 步骤1：锁定明确路径并刷新锁列表。
  const path = lfsLockPath.value.trim()
  if (!path) return
  const succeeded = await postGitAction('git-lfs-lock', { path, force: false })
  if (succeeded) {
    lfsLockPath.value = ''
    await loadLfsLocks()
  }
}

async function unlockLfsPath(path: string): Promise<void> {
  // 步骤1：默认执行普通解锁，权限冲突由后端返回真实错误。
  const succeeded = await postGitAction('git-lfs-unlock', { path, force: false })
  if (succeeded) await loadLfsLocks()
}

watch(
  function watchLfsDefaults() {
    return [props.remotes, props.branch]
  },
  function synchronizeLfsDefaults() {
    // 步骤1：保留有效 Remote，否则优先 origin；分支变化时同步默认 ref。
    let remoteExists = false
    for (const remote of props.remotes) {
      if (remote.name === selectedRemote.value) remoteExists = true
    }
    if (!remoteExists) {
      selectedRemote.value = ''
      for (const remote of props.remotes) {
        if (remote.name === 'origin') selectedRemote.value = remote.name
      }
      if (!selectedRemote.value) selectedRemote.value = props.remotes[0]?.name || ''
    }
    lfsReference.value = props.branch || ''
  },
  { immediate: true }
)
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
