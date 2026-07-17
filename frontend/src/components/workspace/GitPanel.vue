<template>
  <section class="git-panel" :aria-label="t('gitPanel.sourceControl')">
    <header class="git-panel-header">
      <GitBranch :size="15" aria-hidden="true" />
      <button
        type="button"
        data-testid="git-branch-button"
        class="git-panel-branch-button"
        :title="t('gitPanel.manageBranches')"
        :aria-label="t('gitPanel.manageBranches')"
        :disabled="!isGitRepo || busy"
        @click="branchMenuVisible = !branchMenuVisible"
      >
        <span data-testid="git-branch-name" class="git-panel-branch">
          {{ branch || t('gitPanel.detachedHead') }}
        </span>
        <ChevronDown :size="12" />
      </button>
      <button
        type="button"
        class="git-icon-button"
        :title="t('gitPanel.refresh')"
        :aria-label="t('gitPanel.refresh')"
        :disabled="loading || busy"
        @click="emit('refresh')"
      >
        <RefreshCw :size="14" :class="{ spinning: loading }" />
      </button>
    </header>

    <label v-if="repositories && repositories.length > 1" class="git-repository-bar">
      <span>{{ t('gitPanel.repository') }}</span>
      <select
        data-testid="git-repository-select"
        :value="repository || ''"
        @change="emit('select-repository', ($event.target as HTMLSelectElement).value)"
      >
        <option
          v-for="repositoryEntry in repositories"
          :key="repositoryEntry.path"
          :value="repositoryEntry.path"
        >
          {{ repositoryEntry.name }}
        </option>
      </select>
    </label>

    <GitBranchMenu
      :visible="branchMenuVisible"
      :pane-id="paneId"
      :current-branch="branch"
      :repository="repository"
      @close="branchMenuVisible = false"
      @refresh="emit('refresh')"
      @result="handleBranchResult"
    />

    <div v-if="loading && !files.length" class="git-panel-state">
      {{ t('gitPanel.loading') }}
    </div>
    <div v-else-if="!isGitRepo" class="git-panel-state">
      <GitBranch :size="22" aria-hidden="true" />
      <span>{{ t('gitPanel.notRepository') }}</span>
    </div>
    <template v-else>
      <div class="git-panel-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          data-testid="git-changes-tab"
          :aria-selected="panelMode === 'changes'"
          :class="{ active: panelMode === 'changes' }"
          @click="panelMode = 'changes'"
        >
          {{ t('gitPanel.changesTab') }}
        </button>
        <button
          type="button"
          role="tab"
          data-testid="git-history-tab"
          :aria-selected="panelMode === 'history'"
          :class="{ active: panelMode === 'history' }"
          @click="panelMode = 'history'"
        >
          {{ t('gitPanel.history') }}
        </button>
      </div>
      <GitHistoryPanel
        v-if="panelMode === 'history'"
        :pane-id="paneId"
        :current-branch="branch"
        :repository="repository"
        @refresh="emit('refresh')"
        @view-history="emit('view-history', $event)"
      />
      <template v-else>
        <div class="git-remote-bar">
          <span class="git-upstream-copy" :title="remoteTooltip">
            <span data-testid="git-upstream-name" class="git-upstream-name">
              {{ upstream || primaryRemote?.name || t('gitPanel.noUpstream') }}
            </span>
          </span>
          <span v-if="ahead > 0 || behind > 0" class="git-sync-counts">
            <span
              v-if="behind > 0"
              data-testid="git-behind-count"
              class="git-sync-count behind"
              :title="t('gitPanel.behind')"
            >
              <ArrowDown :size="11" />{{ behind }}
            </span>
            <span
              v-if="ahead > 0"
              data-testid="git-ahead-count"
              class="git-sync-count ahead"
              :title="t('gitPanel.ahead')"
            >
              <ArrowUp :size="11" />{{ ahead }}
            </span>
          </span>
          <span class="git-remote-actions">
            <button
              type="button"
              data-testid="git-fetch-button"
              class="git-icon-button"
              :title="t('gitPanel.fetch')"
              :aria-label="t('gitPanel.fetch')"
              :disabled="busy || !primaryRemote"
              @click="runRemoteAction('git-fetch')"
            >
              <LoaderCircle v-if="activeAction === 'git-fetch'" :size="14" class="spinning" />
              <CloudDownload v-else :size="14" />
            </button>
            <button
              type="button"
              data-testid="git-pull-button"
              class="git-icon-button"
              :title="t('gitPanel.pull')"
              :aria-label="t('gitPanel.pull')"
              :disabled="busy || !upstream"
              @click="runRemoteAction('git-pull')"
            >
              <LoaderCircle v-if="activeAction === 'git-pull'" :size="14" class="spinning" />
              <ArrowDownToLine v-else :size="14" />
            </button>
            <button
              v-if="!upstream && primaryRemote && branch"
              type="button"
              data-testid="git-publish-button"
              class="git-icon-button"
              :title="t('gitPanel.publishBranch')"
              :aria-label="t('gitPanel.publishBranch')"
              :disabled="busy"
              @click="publishBranch"
            >
              <LoaderCircle
                v-if="activeAction === 'git-branch-publish'"
                :size="14"
                class="spinning"
              />
              <CloudUpload v-else :size="14" />
            </button>
            <button
              v-else
              type="button"
              data-testid="git-push-button"
              class="git-icon-button"
              :title="t('gitPanel.push')"
              :aria-label="t('gitPanel.push')"
              :disabled="busy || !upstream"
              @click="runRemoteAction('git-push')"
            >
              <LoaderCircle v-if="activeAction === 'git-push'" :size="14" class="spinning" />
              <ArrowUpFromLine v-else :size="14" />
            </button>
          </span>
        </div>

        <div class="git-commit-box">
          <textarea
            v-model="commitMessage"
            data-testid="git-commit-message"
            class="git-commit-message"
            rows="3"
            :placeholder="t('gitPanel.commitPlaceholder')"
            @keydown.ctrl.enter.prevent="commitChanges"
            @keydown.meta.enter.prevent="commitChanges"
          ></textarea>
          <div class="git-commit-options">
            <label>
              <input v-model="amendCommit" data-testid="git-commit-amend" type="checkbox" />
              <span>{{ t('gitPanel.amendCommit') }}</span>
            </label>
            <label>
              <input v-model="signoffCommit" data-testid="git-commit-signoff" type="checkbox" />
              <span>{{ t('gitPanel.signoffCommit') }}</span>
            </label>
          </div>
          <button
            type="button"
            data-testid="git-commit-button"
            class="git-commit-button"
            :disabled="!canCommit"
            @click="commitChanges"
          >
            <Check :size="14" />
            <span>{{ t('gitPanel.commit') }}</span>
          </button>
        </div>

        <p v-if="errorMessage" class="git-panel-message error" role="alert">
          {{ errorMessage }}
        </p>
        <p v-else-if="statusMessage" class="git-panel-message success" role="status">
          {{ statusMessage }}
        </p>

        <GitStashSection :pane-id="paneId" :repository="repository" @refresh="emit('refresh')" />
        <GitAdvancedActions :pane-id="paneId" :repository="repository" @refresh="emit('refresh')" />

        <label class="git-file-search">
          <Search :size="13" aria-hidden="true" />
          <input
            v-model="fileSearch"
            data-testid="git-file-search"
            type="search"
            :placeholder="t('gitPanel.searchChanges')"
          />
        </label>

        <p v-if="statusTruncated" class="git-panel-message warning" role="status">
          {{ t('gitPanel.statusTruncated').replace('{count}', String(totalFiles || files.length)) }}
        </p>

        <div v-if="!files.length" class="git-panel-state clean">
          <CircleCheck :size="22" aria-hidden="true" />
          <span>{{ t('gitPanel.clean') }}</span>
        </div>

        <div
          v-if="files.length && !filteredStagedFiles.length && !filteredWorkingFiles.length"
          class="git-panel-state search-empty"
        >
          {{ t('gitPanel.noMatchingChanges') }}
        </div>

        <section
          v-if="filteredStagedFiles.length"
          data-testid="git-staged-section"
          class="git-section"
        >
          <div class="git-section-header">
            <span>{{ t('gitPanel.stagedChanges') }}</span>
            <span class="git-section-count">{{ filteredStagedFiles.length }}</span>
            <button
              type="button"
              data-testid="git-unstage-all-button"
              class="git-icon-button"
              :title="t('gitPanel.unstageAll')"
              :aria-label="t('gitPanel.unstageAll')"
              :disabled="busy"
              @click="unstageAll"
            >
              <Minus :size="14" />
            </button>
          </div>
          <div class="git-file-list">
            <div
              v-for="file in filteredStagedFiles"
              :key="`staged:${file.path}`"
              data-testid="git-staged-row"
              :data-path="file.path"
              class="git-file-row"
              :class="{ selected: isSelected(file, true) }"
              @click="viewDiff(file, true)"
            >
              <span class="git-status-mark" :class="statusClass(file)">{{ statusMark(file) }}</span>
              <span class="git-file-copy">
                <span class="git-file-name">{{ getGitFileName(file.path) }}</span>
                <span v-if="getGitDirectory(file.path)" class="git-file-directory">
                  {{ getGitDirectory(file.path) }}
                </span>
              </span>
              <span class="git-file-actions">
                <template v-if="file.conflict">
                  <button
                    type="button"
                    data-testid="git-conflict-ours"
                    class="git-icon-button"
                    :title="t('gitPanel.conflictOurs')"
                    :aria-label="t('gitPanel.conflictOurs')"
                    :disabled="busy"
                    @click.stop="resolveConflict(file, 'ours')"
                  >
                    <ArrowLeftToLine :size="13" />
                  </button>
                  <button
                    type="button"
                    data-testid="git-conflict-theirs"
                    class="git-icon-button"
                    :title="t('gitPanel.conflictTheirs')"
                    :aria-label="t('gitPanel.conflictTheirs')"
                    :disabled="busy"
                    @click.stop="resolveConflict(file, 'theirs')"
                  >
                    <ArrowRightToLine :size="13" />
                  </button>
                  <button
                    type="button"
                    data-testid="git-conflict-resolved"
                    class="git-icon-button"
                    :title="t('gitPanel.conflictResolved')"
                    :aria-label="t('gitPanel.conflictResolved')"
                    :disabled="busy"
                    @click.stop="resolveConflict(file, 'resolved')"
                  >
                    <Check :size="13" />
                  </button>
                </template>
                <template v-else>
                  <button
                    type="button"
                    data-testid="git-unstage-button"
                    class="git-icon-button"
                    :title="t('gitPanel.unstage')"
                    :aria-label="t('gitPanel.unstage')"
                    :disabled="busy"
                    @click.stop="unstagePaths([file.path])"
                  >
                    <Minus :size="13" />
                  </button>
                </template>
              </span>
            </div>
          </div>
        </section>

        <section
          v-if="filteredWorkingFiles.length"
          data-testid="git-changes-section"
          class="git-section"
        >
          <div class="git-section-header">
            <span>{{ t('gitPanel.changes') }}</span>
            <span class="git-section-count">{{ filteredWorkingFiles.length }}</span>
            <button
              type="button"
              data-testid="git-stage-all-button"
              class="git-icon-button"
              :title="t('gitPanel.stageAll')"
              :aria-label="t('gitPanel.stageAll')"
              :disabled="busy"
              @click="stageAll"
            >
              <Plus :size="14" />
            </button>
          </div>
          <div class="git-file-list">
            <div
              v-for="file in filteredWorkingFiles"
              :key="`working:${file.path}`"
              data-testid="git-change-row"
              :data-path="file.path"
              class="git-file-row"
              :class="{ selected: isSelected(file, false) }"
              @click="viewDiff(file, false)"
            >
              <span class="git-status-mark" :class="statusClass(file)">{{ statusMark(file) }}</span>
              <span class="git-file-copy">
                <span class="git-file-name">{{ getGitFileName(file.path) }}</span>
                <span v-if="getGitDirectory(file.path)" class="git-file-directory">
                  {{ getGitDirectory(file.path) }}
                </span>
              </span>
              <span class="git-file-actions">
                <button
                  type="button"
                  data-testid="git-discard-button"
                  class="git-icon-button danger"
                  :title="t('gitPanel.discard')"
                  :aria-label="t('gitPanel.discard')"
                  :disabled="busy"
                  @click.stop="requestDiscard(file)"
                >
                  <Undo2 :size="13" />
                </button>
                <button
                  type="button"
                  data-testid="git-stage-button"
                  class="git-icon-button"
                  :title="t('gitPanel.stage')"
                  :aria-label="t('gitPanel.stage')"
                  :disabled="busy || file.conflict"
                  @click.stop="stagePaths([file.path])"
                >
                  <Plus :size="13" />
                </button>
              </span>
            </div>
          </div>
        </section>
      </template>
    </template>

    <ConfirmModal
      :visible="!!discardFile"
      :title="t('gitPanel.discard')"
      :message="t('gitPanel.discardMessage')"
      :confirm-text="t('gitPanel.discard')"
      :cancel-text="t('filePreview.cancel')"
      @confirm="confirmDiscard"
      @cancel="discardFile = null"
    />
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  ArrowDown,
  ArrowDownToLine,
  ArrowLeftToLine,
  ArrowRightToLine,
  ArrowUp,
  ArrowUpFromLine,
  Check,
  ChevronDown,
  CircleCheck,
  CloudDownload,
  CloudUpload,
  GitBranch,
  LoaderCircle,
  Minus,
  Plus,
  RefreshCw,
  Search,
  Undo2,
} from 'lucide-vue-next'
import { apiUrl, authFetch, getApiBase } from '../../composables/apiBase'
import { useI18n } from '../../composables/useI18n'
import {
  getGitDirectory,
  getGitFileName,
  appendGitRepository,
  type GitDiffSelection,
  type GitFileEntry,
  type GitRemoteEntry,
  type GitRepositoryEntry,
} from '../../utils/gitPanel'
import type { GitHistorySelection } from '../../utils/gitHistory'
import ConfirmModal from '../ui/ConfirmModal.vue'
import GitAdvancedActions from './GitAdvancedActions.vue'
import GitBranchMenu from './GitBranchMenu.vue'
import GitHistoryPanel from './GitHistoryPanel.vue'
import GitStashSection from './GitStashSection.vue'

const props = defineProps<{
  paneId: string
  branch: string | null
  upstream: string | null
  ahead: number
  behind: number
  remotes: GitRemoteEntry[]
  isGitRepo: boolean
  loading: boolean
  files: GitFileEntry[]
  selectedDiff?: GitDiffSelection | null
  totalFiles?: number
  statusTruncated?: boolean
  repository?: string
  repositories?: GitRepositoryEntry[]
}>()

const emit = defineEmits<{
  refresh: []
  'view-diff': [selection: GitDiffSelection]
  'view-history': [selection: GitHistorySelection]
  'select-repository': [repository: string]
}>()

const { t } = useI18n()
const commitMessage = ref('')
const amendCommit = ref(false)
const signoffCommit = ref(false)
const busy = ref(false)
const errorMessage = ref('')
const statusMessage = ref('')
const discardFile = ref<GitFileEntry | null>(null)
const activeAction = ref('')
const branchMenuVisible = ref(false)
const panelMode = ref<'changes' | 'history'>('changes')
const fileSearch = ref('')

const primaryRemote = computed(function computePrimaryRemote() {
  // 步骤1：优先使用上游分支所属 remote，其次选择 origin，最后使用第一个 remote。
  const upstreamRemoteName = props.upstream?.split('/')[0] || ''
  for (const remote of props.remotes) {
    if (remote.name === upstreamRemoteName) {
      return remote
    }
  }
  for (const remote of props.remotes) {
    if (remote.name === 'origin') {
      return remote
    }
  }
  return props.remotes[0] || null
})

const remoteTooltip = computed(function computeRemoteTooltip() {
  // 步骤1：在悬停提示中展示远程名称和 Fetch 地址，不占用紧凑面板空间。
  if (!primaryRemote.value) return t('gitPanel.noRemote')
  const remote = primaryRemote.value
  return remote.fetchUrl ? `${remote.name}: ${remote.fetchUrl}` : remote.name
})

const stagedFiles = computed(function computeStagedFiles() {
  // 步骤1：保留所有具有 index 状态的文件，包括同时存在工作区修改的文件。
  const result: GitFileEntry[] = []
  for (const file of props.files) {
    if (file.staged) {
      result.push(file)
    }
  }
  return result
})

const workingFiles = computed(function computeWorkingFiles() {
  // 步骤1：保留所有具有 worktree 状态的文件，包括同时已经暂存的文件。
  const result: GitFileEntry[] = []
  for (const file of props.files) {
    if (file.unstaged) {
      result.push(file)
    }
  }
  return result
})

const filteredStagedFiles = computed(function computeFilteredStagedFiles() {
  // 步骤1：只过滤界面显示，保留 stagedFiles 供全部操作使用。
  return filterFiles(stagedFiles.value, fileSearch.value)
})

const filteredWorkingFiles = computed(function computeFilteredWorkingFiles() {
  // 步骤1：只过滤界面显示，保留 workingFiles 供全部操作使用。
  return filterFiles(workingFiles.value, fileSearch.value)
})

function filterFiles(sourceFiles: GitFileEntry[], searchText: string): GitFileEntry[] {
  // 步骤1：空搜索返回完整列表，其他情况按仓库相对路径不区分大小写匹配。
  const search = searchText.trim().toLocaleLowerCase()
  if (!search) return sourceFiles
  const result: GitFileEntry[] = []
  for (const file of sourceFiles) {
    if (file.path.toLocaleLowerCase().includes(search)) {
      result.push(file)
    }
  }
  return result
}

const canCommit = computed(function computeCanCommit() {
  // 步骤1：只有存在暂存内容、提交说明非空且没有其他操作时才允许提交。
  const hasCommitContent = stagedFiles.value.length > 0 || amendCommit.value
  return hasCommitContent && commitMessage.value.trim().length > 0 && !busy.value
})

function statusMark(file: GitFileEntry): string {
  // 步骤1：使用 Git 常见的单字母状态，保持列表紧凑易扫读。
  if (file.conflict) return '!'
  if (file.status === 'untracked') return 'U'
  if (file.status === 'staged_new') return 'A'
  if (file.status.includes('deleted')) return 'D'
  if (file.status === 'renamed') return 'R'
  return 'M'
}

function statusClass(file: GitFileEntry): string {
  // 步骤1：把状态映射到稳定的语义颜色类。
  if (file.conflict) return 'conflict'
  if (file.status === 'untracked' || file.status === 'staged_new') return 'added'
  if (file.status.includes('deleted')) return 'deleted'
  return 'modified'
}

function isSelected(file: GitFileEntry, staged: boolean): boolean {
  // 步骤1：同时匹配文件路径与暂存分组，区分双状态文件的两个 diff。
  return props.selectedDiff?.filePath === file.path && props.selectedDiff.staged === staged
}

function viewDiff(file: GitFileEntry, staged: boolean): void {
  // 步骤1：把当前分组传给差异查看器，确保读取正确的 index 或 worktree diff。
  emit('view-diff', {
    filePath: file.path,
    staged,
    untracked: !staged && file.status === 'untracked',
    conflict: file.conflict,
  })
}

async function postGitAction(endpoint: string, body: Record<string, unknown>): Promise<boolean> {
  // 步骤1：重置反馈并向当前终端工作区发送 Git 操作。
  busy.value = true
  activeAction.value = endpoint
  errorMessage.value = ''
  statusMessage.value = ''
  try {
    await getApiBase()
    const query = new URLSearchParams({ pane_id: props.paneId })
    appendGitRepository(query, props.repository)
    const response = await authFetch(apiUrl(`/api/workspace/${endpoint}?${query}`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const result = await response.json().catch(function emptyResult() {
      return {}
    })
    if (!response.ok) {
      errorMessage.value = result.error || t('gitPanel.operationFailed')
      return false
    }

    // 步骤2：成功后显示结果并要求父级重新读取仓库状态。
    statusMessage.value = result.output || t('gitPanel.operationSucceeded')
    emit('refresh')
    return true
  } catch {
    errorMessage.value = t('gitPanel.operationFailed')
    return false
  } finally {
    busy.value = false
    activeAction.value = ''
  }
}

async function runRemoteAction(endpoint: 'git-fetch' | 'git-pull' | 'git-push'): Promise<void> {
  // 步骤1：复用统一 Git 操作流程，并在成功后刷新 ahead、behind 与文件状态。
  await postGitAction(endpoint, {})
}

async function publishBranch(): Promise<void> {
  // 步骤1：使用当前 remote 与本地分支发布并建立 upstream。
  const remote = primaryRemote.value
  if (!remote || !props.branch) return
  await postGitAction('git-branch-publish', {
    remote: remote.name,
    branch: props.branch,
  })
}

function handleBranchResult(result: { ok: boolean; message: string }): void {
  // 步骤1：把分支弹层的操作结果显示在主 Git 面板反馈区。
  if (result.ok) {
    errorMessage.value = ''
    statusMessage.value = result.message
  } else {
    statusMessage.value = ''
    errorMessage.value = result.message
  }
}

async function stagePaths(paths: string[]): Promise<void> {
  // 步骤1：暂存指定文件列表。
  await postGitAction('git-stage', { paths })
}

async function unstagePaths(paths: string[]): Promise<void> {
  // 步骤1：取消暂存指定文件列表。
  await postGitAction('git-unstage', { paths })
}

async function stageAll(): Promise<void> {
  // 步骤1：由后端直接暂存仓库全部更改，避免大仓库截断列表漏掉文件。
  await postGitAction('git-stage-all', {})
}

async function unstageAll(): Promise<void> {
  // 步骤1：由后端直接取消整个仓库的暂存，保证“全部”语义准确。
  await postGitAction('git-unstage-all', {})
}

function requestDiscard(file: GitFileEntry): void {
  // 步骤1：保存待丢弃文件，交给确认弹窗阻止误操作。
  discardFile.value = file
}

async function confirmDiscard(): Promise<void> {
  // 步骤1：读取并清空待处理文件，防止重复确认。
  const file = discardFile.value
  discardFile.value = null
  if (!file) return

  // 步骤2：明确告诉后端未跟踪文件需要删除而不是 git restore。
  await postGitAction('git-discard', {
    path: file.path,
    untracked: file.status === 'untracked',
  })
}

async function commitChanges(): Promise<void> {
  // 步骤1：在可提交状态下发送去除首尾空白的提交说明。
  if (!canCommit.value) return
  const message = commitMessage.value.trim()
  const body: Record<string, unknown> = { message }
  if (amendCommit.value) body.amend = true
  if (signoffCommit.value) body.signoff = true
  const committed = await postGitAction('git-commit', body)

  // 步骤2：仅在提交成功后清空输入，失败时保留用户内容。
  if (committed) {
    commitMessage.value = ''
    amendCommit.value = false
  }
}

async function resolveConflict(
  file: GitFileEntry,
  resolution: 'ours' | 'theirs' | 'resolved'
): Promise<void> {
  // 步骤1：把冲突文件和用户选择的解决方式交给后端，并复用统一操作反馈。
  await postGitAction('git-conflict-resolve', { path: file.path, resolution })
}
</script>

<style scoped>
.git-panel {
  position: relative;
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: auto;
  color: var(--fg);
  background: var(--tab-bg);
}

.git-panel-branch-button {
  min-width: 0;
  flex: 1;
  height: 27px;
  display: flex;
  align-items: center;
  gap: 3px;
  padding: 0 3px;
  overflow: hidden;
  border: 0;
  border-radius: 3px;
  color: inherit;
  background: transparent;
  cursor: pointer;
}

.git-panel-branch-button:hover:not(:disabled),
.git-panel-branch-button:focus-visible {
  background: var(--bg-hover);
  outline: 1px solid var(--accent);
  outline-offset: -1px;
}

.git-panel-branch-button:disabled {
  cursor: default;
}

.git-panel-header,
.git-section-header {
  min-height: 32px;
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 0 8px;
  border-bottom: 1px solid var(--border);
}

.git-panel-header {
  color: var(--fg-muted);
}

.git-repository-bar {
  min-height: 31px;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: center;
  gap: 7px;
  padding: 3px 7px 3px 9px;
  border-bottom: 1px solid var(--border);
  color: var(--fg-muted);
  font-size: 9px;
}

.git-repository-bar select {
  min-width: 0;
  height: 25px;
  border: 1px solid var(--border);
  border-radius: 3px;
  color: var(--fg);
  background: var(--bg);
  font-family: var(--font-mono);
  font-size: 9px;
}

.git-panel-tabs {
  min-height: 31px;
  display: grid;
  grid-template-columns: 1fr 1fr;
  padding: 3px 6px;
  border-bottom: 1px solid var(--border);
  background: var(--tab-bg);
}

.git-panel-tabs button {
  min-width: 0;
  border: 0;
  border-bottom: 2px solid transparent;
  color: var(--fg-muted);
  background: transparent;
  cursor: pointer;
  font-size: 11px;
}

.git-panel-tabs button:hover,
.git-panel-tabs button:focus-visible {
  color: var(--fg-bright);
  background: var(--bg-hover);
  outline: none;
}

.git-panel-tabs button.active {
  border-bottom-color: var(--accent);
  color: var(--fg-bright);
}

.git-panel-branch {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--fg-bright);
}

.git-remote-bar {
  min-height: 31px;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 4px 0 9px;
  border-bottom: 1px solid var(--border);
  color: var(--fg-muted);
}

.git-upstream-copy {
  min-width: 0;
  flex: 1;
  overflow: hidden;
}

.git-upstream-name {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--font-mono);
  font-size: 10px;
}

.git-sync-counts,
.git-remote-actions,
.git-sync-count {
  display: inline-flex;
  align-items: center;
}

.git-sync-counts {
  flex: 0 0 auto;
  gap: 5px;
}

.git-sync-count {
  gap: 1px;
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 600;
}

.git-sync-count.behind {
  color: var(--color-blue, #69a7d8);
}

.git-sync-count.ahead {
  color: var(--color-green, #62b478);
}

.git-remote-actions {
  flex: 0 0 auto;
}

.git-icon-button {
  width: 26px;
  height: 26px;
  flex: 0 0 26px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 3px;
  color: var(--fg-muted);
  background: transparent;
  cursor: pointer;
}

.git-icon-button:hover:not(:disabled),
.git-icon-button:focus-visible {
  color: var(--fg-bright);
  background: var(--bg-hover);
  outline: 1px solid var(--accent);
  outline-offset: -1px;
}

.git-icon-button.danger:hover:not(:disabled) {
  color: var(--color-red, #d94f4f);
}

.git-icon-button:disabled {
  opacity: 0.4;
  cursor: default;
}

.git-commit-box {
  padding: 8px;
  border-bottom: 1px solid var(--border);
}

.git-commit-message {
  width: 100%;
  min-height: 56px;
  resize: vertical;
  box-sizing: border-box;
  border: 1px solid var(--border);
  border-radius: 3px;
  padding: 7px 8px;
  color: var(--fg);
  background: var(--bg);
  font: inherit;
  font-size: 12px;
  line-height: 1.4;
}

.git-commit-message:focus {
  border-color: var(--accent);
  outline: none;
}

.git-commit-options {
  min-height: 25px;
  display: flex;
  align-items: center;
  gap: 12px;
  color: var(--fg-muted);
  font-size: 9px;
}

.git-commit-options label {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  cursor: pointer;
}

.git-commit-options input {
  margin: 0;
}

.git-commit-button {
  width: 100%;
  min-height: 30px;
  margin-top: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border: 1px solid transparent;
  border-radius: 3px;
  color: #fff;
  background: var(--accent, #0e639c);
  cursor: pointer;
  font-size: 12px;
}

.git-commit-button:disabled {
  opacity: 0.42;
  cursor: default;
}

.git-panel-message {
  margin: 0;
  padding: 7px 9px;
  border-bottom: 1px solid var(--border);
  font-size: 11px;
  line-height: 1.4;
  white-space: pre-wrap;
}

.git-panel-message.error {
  color: var(--color-red, #e06c75);
}

.git-panel-message.success {
  color: var(--color-green, #62b478);
}

.git-panel-message.warning {
  color: var(--color-orange, #d7a148);
}

.git-file-search {
  min-height: 34px;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 9px;
  border-bottom: 1px solid var(--border);
  color: var(--fg-muted);
}

.git-file-search input {
  min-width: 0;
  flex: 1;
  height: 25px;
  border: 0;
  color: var(--fg);
  background: transparent;
  font-size: 10px;
  outline: none;
}

.git-panel-state {
  min-height: 120px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 9px;
  padding: 16px;
  color: var(--fg-muted);
  text-align: center;
  font-size: 12px;
}

.git-panel-state.clean {
  color: var(--color-green, #62b478);
}

.git-panel-state.search-empty {
  min-height: 72px;
}

.git-section {
  border-bottom: 1px solid var(--border);
}

.git-section-header {
  position: sticky;
  top: 0;
  z-index: 1;
  background: var(--tab-bg);
  color: var(--fg-bright);
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
}

.git-section-header > :first-child {
  flex: 1;
}

.git-section-count {
  min-width: 18px;
  text-align: center;
  color: var(--fg-muted);
  font-family: var(--font-mono);
}

.git-file-list {
  padding: 2px 0;
}

.git-file-row {
  min-height: 31px;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 2px 4px 2px 8px;
  cursor: pointer;
}

.git-file-row:hover,
.git-file-row.selected {
  background: var(--bg-hover);
}

.git-file-row.selected {
  box-shadow: inset 2px 0 0 var(--accent);
}

.git-status-mark {
  width: 14px;
  flex: 0 0 14px;
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 700;
  text-align: center;
}

.git-status-mark.added {
  color: var(--color-green, #4fb36b);
}

.git-status-mark.modified {
  color: var(--color-orange, #d7a148);
}

.git-status-mark.deleted,
.git-status-mark.conflict {
  color: var(--color-red, #dc6262);
}

.git-file-copy {
  min-width: 0;
  flex: 1;
  display: flex;
  align-items: baseline;
  gap: 5px;
  overflow: hidden;
}

.git-file-name,
.git-file-directory {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.git-file-name {
  flex: 0 1 auto;
  color: var(--fg);
  font-size: 12px;
}

.git-file-directory {
  flex: 1 1 auto;
  color: var(--fg-muted);
  font-size: 10px;
}

.git-file-actions {
  display: flex;
  opacity: 0;
}

.git-file-row:hover .git-file-actions,
.git-file-row:focus-within .git-file-actions {
  opacity: 1;
}

.spinning {
  animation: git-spin 0.8s linear infinite;
}

@keyframes git-spin {
  to {
    transform: rotate(360deg);
  }
}

@media (prefers-reduced-motion: reduce) {
  .spinning {
    animation: none;
  }
}

@media (hover: none) {
  .git-file-actions {
    opacity: 1;
  }
}
</style>
