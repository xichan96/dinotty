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

    <GitBranchMenu
      :visible="branchMenuVisible"
      :pane-id="paneId"
      :current-branch="branch"
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

      <div v-if="!files.length" class="git-panel-state clean">
        <CircleCheck :size="22" aria-hidden="true" />
        <span>{{ t('gitPanel.clean') }}</span>
      </div>

      <section v-if="stagedFiles.length" data-testid="git-staged-section" class="git-section">
        <div class="git-section-header">
          <span>{{ t('gitPanel.stagedChanges') }}</span>
          <span class="git-section-count">{{ stagedFiles.length }}</span>
          <button
            type="button"
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
            v-for="file in stagedFiles"
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
            </span>
          </div>
        </div>
      </section>

      <section v-if="workingFiles.length" data-testid="git-changes-section" class="git-section">
        <div class="git-section-header">
          <span>{{ t('gitPanel.changes') }}</span>
          <span class="git-section-count">{{ workingFiles.length }}</span>
          <button
            type="button"
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
            v-for="file in workingFiles"
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
  Undo2,
} from 'lucide-vue-next'
import { apiUrl, authFetch, getApiBase } from '../../composables/apiBase'
import { useI18n } from '../../composables/useI18n'
import {
  getGitDirectory,
  getGitFileName,
  type GitDiffSelection,
  type GitFileEntry,
  type GitRemoteEntry,
} from '../../utils/gitPanel'
import ConfirmModal from '../ui/ConfirmModal.vue'
import GitBranchMenu from './GitBranchMenu.vue'

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
}>()

const emit = defineEmits<{
  refresh: []
  'view-diff': [selection: GitDiffSelection]
}>()

const { t } = useI18n()
const commitMessage = ref('')
const busy = ref(false)
const errorMessage = ref('')
const statusMessage = ref('')
const discardFile = ref<GitFileEntry | null>(null)
const activeAction = ref('')
const branchMenuVisible = ref(false)

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

const canCommit = computed(function computeCanCommit() {
  // 步骤1：只有存在暂存内容、提交说明非空且没有其他操作时才允许提交。
  return stagedFiles.value.length > 0 && commitMessage.value.trim().length > 0 && !busy.value
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
  // 步骤1：收集当前工作区分组中的唯一文件路径。
  const paths: string[] = []
  for (const file of workingFiles.value) {
    if (!paths.includes(file.path)) {
      paths.push(file.path)
    }
  }
  await stagePaths(paths)
}

async function unstageAll(): Promise<void> {
  // 步骤1：收集当前暂存分组中的唯一文件路径。
  const paths: string[] = []
  for (const file of stagedFiles.value) {
    if (!paths.includes(file.path)) {
      paths.push(file.path)
    }
  }
  await unstagePaths(paths)
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
  const committed = await postGitAction('git-commit', { message })

  // 步骤2：仅在提交成功后清空输入，失败时保留用户内容。
  if (committed) {
    commitMessage.value = ''
  }
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
