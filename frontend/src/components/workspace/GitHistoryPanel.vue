<template>
  <section class="git-history-panel" :aria-label="t('gitPanel.history')">
    <div class="git-history-tools">
      <button
        type="button"
        data-testid="git-history-rewrite-button"
        :title="t('gitPanel.rewriteHistory')"
        @click="rebasePlannerVisible = true"
      >
        <ListRestart :size="13" />
        <span>{{ t('gitPanel.rewriteHistory') }}</span>
      </button>
    </div>
    <form class="git-history-search" @submit.prevent="applySearch">
      <Search :size="13" aria-hidden="true" />
      <input
        v-model="searchInput"
        data-testid="git-history-search-input"
        type="search"
        :placeholder="t('gitPanel.historySearchPlaceholder')"
        @keydown.enter.prevent="applySearch"
      />
      <button
        v-if="searchInput"
        type="button"
        class="git-history-icon-button"
        :title="t('gitPanel.clearHistorySearch')"
        :aria-label="t('gitPanel.clearHistorySearch')"
        @click="clearSearch"
      >
        <X :size="13" />
      </button>
    </form>
    <form class="git-history-path" @submit.prevent="applyPathFilter">
      <Search :size="13" aria-hidden="true" />
      <input
        v-model="pathInput"
        data-testid="git-history-path-input"
        type="search"
        :placeholder="t('gitPanel.historyPathPlaceholder')"
        @keydown.enter.prevent="applyPathFilter"
      />
      <button
        v-if="pathInput"
        type="button"
        class="git-history-icon-button"
        :title="t('gitPanel.clearHistoryPath')"
        :aria-label="t('gitPanel.clearHistoryPath')"
        @click="clearPathFilter"
      >
        <X :size="13" />
      </button>
    </form>

    <section class="git-compare-box" :aria-label="t('gitPanel.compareBranches')">
      <div class="git-compare-heading">
        <GitCompareArrows :size="13" aria-hidden="true" />
        <span>{{ t('gitPanel.compareBranches') }}</span>
      </div>
      <label>
        <span>{{ t('gitPanel.compareBase') }}</span>
        <select v-model="compareBase" data-testid="git-compare-base">
          <option v-for="name in branchNames" :key="`base:${name}`" :value="name">
            {{ name }}
          </option>
        </select>
      </label>
      <label>
        <span>{{ t('gitPanel.compareTarget') }}</span>
        <select v-model="compareTarget" data-testid="git-compare-target">
          <option v-for="name in branchNames" :key="`target:${name}`" :value="name">
            {{ name }}
          </option>
        </select>
      </label>
      <button
        type="button"
        data-testid="git-compare-button"
        class="git-compare-button"
        :disabled="!canCompare"
        @click="openComparison"
      >
        {{ t('gitPanel.compare') }}
      </button>
    </section>

    <p v-if="errorMessage" class="git-history-message error" role="alert">
      {{ errorMessage }}
    </p>
    <p v-else-if="statusMessage" class="git-history-message success" role="status">
      {{ statusMessage }}
    </p>
    <div v-if="selectedCommitHashes.length" class="git-history-selection-bar">
      <span>
        {{
          t('gitPanel.selectedCommitCount').replace('{count}', String(selectedCommitHashes.length))
        }}
      </span>
      <button
        type="button"
        class="git-history-icon-button"
        :title="t('gitPanel.clearSelectedCommits')"
        :aria-label="t('gitPanel.clearSelectedCommits')"
        :disabled="batchBusy"
        @click="clearSelectedCommits"
      >
        <X :size="13" />
      </button>
      <button
        type="button"
        data-testid="git-history-cherry-pick-selected"
        class="git-history-batch-button"
        :disabled="batchBusy"
        @click="cherryPickConfirmationVisible = true"
      >
        <Cherry :size="13" />
        <span>
          {{
            t('gitPanel.cherryPickSelected').replace('{count}', String(selectedCommitHashes.length))
          }}
        </span>
      </button>
    </div>
    <div v-if="loading && !commits.length" class="git-history-state">
      {{ t('gitPanel.loadingHistory') }}
    </div>
    <div v-else-if="!commits.length" class="git-history-state">
      {{ t('gitPanel.noHistory') }}
    </div>
    <div v-else class="git-history-list">
      <div v-for="(commit, index) in commits" :key="commit.hash" class="git-history-entry">
        <svg
          data-testid="git-history-graph"
          class="git-history-graph"
          :width="graphWidth(graphRows[index].laneCount)"
          height="48"
          :viewBox="`0 0 ${graphWidth(graphRows[index].laneCount)} 48`"
          aria-hidden="true"
        >
          <line
            v-if="index > 0"
            :x1="graphX(graphRows[index].lane)"
            y1="0"
            :x2="graphX(graphRows[index].lane)"
            y2="14"
            :stroke="graphColor(graphRows[index].lane)"
            stroke-width="2"
          />
          <line
            v-for="(segment, segmentIndex) in graphRows[index].segments"
            :key="`${segmentIndex}:${segment.fromLane}:${segment.toLane}`"
            :x1="graphX(segment.fromLane)"
            :y1="segment.fromLane === graphRows[index].lane ? 14 : 0"
            :x2="graphX(segment.toLane)"
            y2="48"
            :stroke="graphColor(segment.toLane)"
            stroke-width="2"
          />
          <circle
            :cx="graphX(graphRows[index].lane)"
            cy="14"
            r="4"
            :fill="graphColor(graphRows[index].lane)"
            stroke="var(--bg)"
            stroke-width="2"
          />
        </svg>
        <label
          class="git-history-select"
          :title="t('gitPanel.selectCommit').replace('{commit}', commit.shortHash)"
        >
          <input
            data-testid="git-history-select-commit"
            type="checkbox"
            :checked="isCommitSelected(commit.hash)"
            :aria-label="t('gitPanel.selectCommit').replace('{commit}', commit.shortHash)"
            @change="toggleCommitSelection(commit.hash)"
          />
        </label>
        <button
          type="button"
          data-testid="git-history-row"
          class="git-history-row"
          @click="openCommit(commit)"
        >
          <span v-if="commit.decorations.length" class="git-history-refs">
            <span
              v-for="reference in commit.decorations"
              :key="reference"
              data-testid="git-history-ref"
              class="git-history-ref"
              :class="`git-history-ref-${referenceType(reference)}`"
            >
              {{ referenceLabel(reference) }}
            </span>
          </span>
          <span class="git-history-subject">{{ commit.subject }}</span>
          <span class="git-history-meta">
            <code>{{ commit.shortHash }}</code>
            <span>{{ commit.authorName }}</span>
            <time :datetime="commit.authoredAt">{{ formatDate(commit.authoredAt) }}</time>
          </span>
        </button>
        <GitCommitActions
          :pane-id="paneId"
          :repository="repository"
          :commit="commit"
          @refresh="emit('refresh')"
          @result="handleCommitActionResult"
        />
      </div>
      <button
        v-if="hasMore"
        type="button"
        class="git-history-more"
        :disabled="loading"
        @click="loadMore"
      >
        {{ loading ? t('gitPanel.loadingHistory') : t('gitPanel.loadMoreHistory') }}
      </button>
    </div>

    <ConfirmModal
      :visible="cherryPickConfirmationVisible"
      :title="t('gitPanel.cherryPick')"
      :message="cherryPickConfirmationMessage"
      :confirm-text="t('gitPanel.cherryPick')"
      :cancel-text="t('filePreview.cancel')"
      @confirm="confirmCherryPickSelected"
      @cancel="cherryPickConfirmationVisible = false"
    />
    <GitRebasePlanner
      :visible="rebasePlannerVisible"
      :pane-id="paneId"
      :repository="repository"
      @close="rebasePlannerVisible = false"
      @completed="handleRebaseCompleted"
    />
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Cherry, GitCompareArrows, ListRestart, Search, X } from 'lucide-vue-next'
import { apiUrl, authFetch, getApiBase } from '../../composables/apiBase'
import { useI18n } from '../../composables/useI18n'
import { appendGitRepository, isLatestGitRequest } from '../../utils/gitPanel'
import GitCommitActions from './GitCommitActions.vue'
import ConfirmModal from '../ui/ConfirmModal.vue'
import GitRebasePlanner from './GitRebasePlanner.vue'
import {
  buildGitGraphRows,
  mapGitCommitEntry,
  type GitCommitEntry,
  type GitHistoryPathRequest,
  type GitHistorySelection,
} from '../../utils/gitHistory'

interface BranchEntry {
  name: string
}

const props = defineProps<{
  paneId: string
  currentBranch: string | null
  repository?: string
  requestedPath?: GitHistoryPathRequest | null
}>()

const emit = defineEmits<{
  'view-history': [selection: GitHistorySelection]
  refresh: []
}>()

const { t } = useI18n()
const pageSize = 50
const commits = ref<GitCommitEntry[]>([])
const branchNames = ref<string[]>([])
const initialRequestedPath = props.requestedPath?.path.trim() || ''
const pathInput = ref(initialRequestedPath)
const activePath = ref(initialRequestedPath)
const searchInput = ref('')
const activeSearch = ref('')
const compareBase = ref('')
const compareTarget = ref('')
const loading = ref(false)
const hasMore = ref(false)
const errorMessage = ref('')
const statusMessage = ref('')
const selectedCommitHashes = ref<string[]>([])
const cherryPickConfirmationVisible = ref(false)
const batchBusy = ref(false)
const rebasePlannerVisible = ref(false)
let branchRequestId = 0
let historyRequestId = 0

const graphRows = computed(function computeGraphRows() {
  // 步骤1：提交列表每次加载或追加后重新计算连续图谱泳道。
  return buildGitGraphRows(commits.value)
})

const canCompare = computed(function computeCanCompare() {
  // 步骤1：只有选择两个不同分支时才允许比较。
  return (
    compareBase.value.length > 0 &&
    compareTarget.value.length > 0 &&
    compareBase.value !== compareTarget.value
  )
})

const cherryPickConfirmationMessage = computed(function computeCherryPickConfirmationMessage() {
  // 步骤1：在确认消息中显示提交数量，并明确按选择顺序执行。
  return t('gitPanel.cherryPickSelectedMessage').replace(
    '{count}',
    String(selectedCommitHashes.value.length)
  )
})

function mapBranchNames(rawBranches: unknown, result: string[]): void {
  // 步骤1：逐个读取有效分支名称，并避免本地和远程列表产生重复项。
  if (!Array.isArray(rawBranches)) return
  for (const rawBranch of rawBranches) {
    if (!rawBranch || typeof rawBranch !== 'object') continue
    const branch = rawBranch as BranchEntry
    const name = String(branch.name || '')
    if (name && !result.includes(name)) {
      result.push(name)
    }
  }
}

async function loadBranches(): Promise<void> {
  // 步骤1：读取可用于历史比较的本地和远程分支。
  const requestId = ++branchRequestId
  const requestedRepository = props.repository || ''
  try {
    await getApiBase()
    const query = new URLSearchParams({ pane_id: props.paneId })
    appendGitRepository(query, requestedRepository)
    const response = await authFetch(apiUrl(`/api/workspace/git-branches?${query}`))
    const result = await response.json().catch(function emptyBranchResult() {
      return {}
    })
    if (
      !isLatestGitRequest(requestId, branchRequestId, requestedRepository, props.repository || '')
    ) {
      return
    }
    if (!response.ok) return

    // 步骤2：合并分支列表，并默认比较主分支与当前分支。
    const names: string[] = []
    mapBranchNames(result.local, names)
    mapBranchNames(result.remote, names)
    branchNames.value = names
    compareTarget.value = props.currentBranch || names[0] || ''
    compareBase.value = findDefaultBase(names, compareTarget.value)
  } catch {
    if (
      isLatestGitRequest(requestId, branchRequestId, requestedRepository, props.repository || '')
    ) {
      branchNames.value = []
    }
  }
}

function findDefaultBase(names: string[], target: string): string {
  // 步骤1：优先使用常见主分支，其次使用第一个不同于目标的分支。
  const preferredNames = ['main', 'master']
  for (const preferredName of preferredNames) {
    if (preferredName !== target && names.includes(preferredName)) {
      return preferredName
    }
  }
  for (const name of names) {
    if (name !== target) return name
  }
  return ''
}

async function loadHistory(append: boolean): Promise<void> {
  // 步骤1：按当前路径和分页位置读取提交历史。
  const requestId = ++historyRequestId
  const requestedRepository = props.repository || ''
  loading.value = true
  errorMessage.value = ''
  try {
    await getApiBase()
    const skip = append ? commits.value.length : 0
    const query = new URLSearchParams({
      pane_id: props.paneId,
      skip: String(skip),
      limit: String(pageSize),
    })
    appendGitRepository(query, requestedRepository)
    if (activePath.value) query.set('path', activePath.value)
    if (activeSearch.value) query.set('search', activeSearch.value)
    const response = await authFetch(apiUrl(`/api/workspace/git-log?${query}`))
    const result = await response.json().catch(function emptyHistoryResult() {
      return {}
    })
    if (
      !isLatestGitRequest(requestId, historyRequestId, requestedRepository, props.repository || '')
    ) {
      return
    }
    if (!response.ok) {
      errorMessage.value = result.error || t('gitPanel.historyFailed')
      return
    }

    // 步骤2：显式转换接口字段，并按是否加载更多更新列表。
    const nextCommits: GitCommitEntry[] = []
    if (Array.isArray(result.commits)) {
      for (const rawCommit of result.commits) {
        if (!rawCommit || typeof rawCommit !== 'object') continue
        nextCommits.push(mapGitCommitEntry(rawCommit as Record<string, unknown>))
      }
    }
    if (append) {
      commits.value.push(...nextCommits)
    } else {
      commits.value = nextCommits
    }
    hasMore.value = result.has_more === true
  } catch {
    if (
      isLatestGitRequest(requestId, historyRequestId, requestedRepository, props.repository || '')
    ) {
      errorMessage.value = t('gitPanel.historyFailed')
    }
  } finally {
    if (
      isLatestGitRequest(requestId, historyRequestId, requestedRepository, props.repository || '')
    ) {
      loading.value = false
    }
  }
}

function handleCommitActionResult(message: string, error: boolean): void {
  // 步骤1：把提交操作结果显示在历史面板顶部，成功消息与错误消息互斥。
  if (error) {
    errorMessage.value = message
    statusMessage.value = ''
    return
  }
  statusMessage.value = message
  errorMessage.value = ''
  void loadHistory(false)
}

function handleRebaseCompleted(message: string): void {
  // 步骤1：关闭规划器并刷新历史与仓库状态，展示 Git 返回的重写结果。
  rebasePlannerVisible.value = false
  statusMessage.value = message
  errorMessage.value = ''
  clearSelectedCommits()
  void loadHistory(false)
  emit('refresh')
}

function isCommitSelected(hash: string): boolean {
  // 步骤1：按完整提交 ID 判断复选框状态。
  return selectedCommitHashes.value.includes(hash)
}

function toggleCommitSelection(hash: string): void {
  // 步骤1：已选择的提交再次勾选时移除，否则按点击顺序追加。
  const selectedIndex = selectedCommitHashes.value.indexOf(hash)
  if (selectedIndex >= 0) {
    selectedCommitHashes.value.splice(selectedIndex, 1)
    return
  }
  selectedCommitHashes.value.push(hash)
}

function clearSelectedCommits(): void {
  // 步骤1：清空批量选择和尚未确认的操作状态。
  selectedCommitHashes.value = []
  cherryPickConfirmationVisible.value = false
}

async function confirmCherryPickSelected(): Promise<void> {
  // 步骤1：复制当前选择并关闭确认框，防止请求过程中选择变化影响顺序。
  const commitsToCherryPick = selectedCommitHashes.value.slice()
  cherryPickConfirmationVisible.value = false
  if (!commitsToCherryPick.length || batchBusy.value) return

  // 步骤2：一次发送有序提交数组，并把真实结果反馈到历史面板。
  batchBusy.value = true
  errorMessage.value = ''
  statusMessage.value = ''
  try {
    await getApiBase()
    const query = new URLSearchParams({ pane_id: props.paneId })
    appendGitRepository(query, props.repository)
    const response = await authFetch(apiUrl(`/api/workspace/git-cherry-pick?${query}`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ commits: commitsToCherryPick }),
    })
    const result = await response.json().catch(function emptyCherryPickResult() {
      return {}
    })
    if (!response.ok) {
      errorMessage.value = result.error || t('gitPanel.commitActionFailed')
      return
    }
    statusMessage.value = result.output || t('gitPanel.commitActionSucceeded')
    clearSelectedCommits()
    await loadHistory(false)
    emit('refresh')
  } catch {
    errorMessage.value = t('gitPanel.commitActionFailed')
  } finally {
    batchBusy.value = false
  }
}

function applyPathFilter(): void {
  // 步骤1：保存去除首尾空白的仓库相对路径，然后从第一页重新加载。
  activePath.value = pathInput.value.trim()
  void loadHistory(false)
}

function clearPathFilter(): void {
  // 步骤1：同时清空输入值和已生效路径，然后恢复完整历史。
  pathInput.value = ''
  activePath.value = ''
  void loadHistory(false)
}

function applySearch(): void {
  // 步骤1：保存去除首尾空白的关键词并从第一页重新加载。
  activeSearch.value = searchInput.value.trim()
  void loadHistory(false)
}

function clearSearch(): void {
  // 步骤1：同时清空输入和已生效关键词，再恢复完整历史。
  searchInput.value = ''
  activeSearch.value = ''
  void loadHistory(false)
}

function loadMore(): void {
  // 步骤1：在当前列表后追加下一页提交。
  if (!loading.value && hasMore.value) void loadHistory(true)
}

function openCommit(commit: GitCommitEntry): void {
  // 步骤1：把提交元数据和当前文件筛选范围交给主预览区。
  emit('view-history', {
    kind: 'commit',
    hash: commit.hash,
    shortHash: commit.shortHash,
    subject: commit.subject,
    authorName: commit.authorName,
    authoredAt: commit.authoredAt,
    path: activePath.value || null,
  })
}

function openComparison(): void {
  // 步骤1：把已验证的两个分支交给主预览区加载比较结果。
  if (!canCompare.value) return
  emit('view-history', {
    kind: 'compare',
    base: compareBase.value,
    target: compareTarget.value,
  })
}

function formatDate(value: string): string {
  // 步骤1：使用当前系统地区格式显示日期，无法解析时保留原始值。
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })
}

function graphWidth(laneCount: number): number {
  // 步骤1：每条泳道使用固定宽度，避免提交数量变化时侧栏抖动。
  return Math.max(laneCount, 1) * 14 + 8
}

function graphX(lane: number): number {
  // 步骤1：返回泳道中心点，供节点和连接线共享。
  return lane * 14 + 8
}

function graphColor(lane: number): string {
  // 步骤1：循环使用易区分的固定颜色，合并分支不依赖单一色相。
  const colors = ['#5aa9e6', '#f28e66', '#62b478', '#c792ea', '#e5b95c', '#d96c75']
  return colors[lane % colors.length]
}

function referenceLabel(reference: string): string {
  // 步骤1：移除 Git 装饰前缀，只保留用户识别的分支或标签名称。
  return reference
    .replace(/^HEAD -> /, '')
    .replace(/^tag: /, '')
    .replace(/^refs\/heads\//, '')
    .replace(/^refs\/remotes\//, '')
    .replace(/^refs\/tags\//, '')
}

function referenceType(reference: string): 'head' | 'tag' | 'remote' | 'branch' {
  // 步骤1：按引用类型返回稳定样式名称。
  if (reference.startsWith('HEAD -> ')) return 'head'
  if (reference.startsWith('tag: ')) return 'tag'
  if (reference.includes('refs/remotes/') || reference.includes('/')) return 'remote'
  return 'branch'
}

watch(
  function watchHistoryRepository() {
    return [props.paneId, props.currentBranch, props.repository]
  },
  function reloadHistoryRepository() {
    void loadBranches()
    void loadHistory(false)
  },
  { immediate: true }
)

watch(
  function watchRequestedHistoryPath() {
    return props.requestedPath?.requestId
  },
  function applyRequestedHistoryPath() {
    // 步骤1：文件树请求到达时同步输入值和生效路径，并从第一页加载。
    const request = props.requestedPath
    if (!request) return
    const requestedPath = request.path.trim()
    pathInput.value = requestedPath
    activePath.value = requestedPath
    void loadHistory(false)
  }
)
</script>

<style scoped>
.git-history-panel {
  min-height: 0;
  display: flex;
  flex: 1;
  flex-direction: column;
  overflow: hidden;
}

.git-history-tools {
  min-height: 32px;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  padding: 3px 7px;
  border-bottom: 1px solid var(--border);
}

.git-history-tools button {
  min-height: 25px;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 0 7px;
  border: 1px solid var(--border);
  border-radius: 3px;
  color: var(--fg-muted);
  background: var(--tab-bg);
  cursor: pointer;
  font-size: 9px;
}

.git-history-tools button:hover,
.git-history-tools button:focus-visible {
  border-color: var(--accent);
  color: var(--fg);
  background: var(--bg-hover);
  outline: none;
}

.git-history-search,
.git-history-path {
  min-height: 34px;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 6px 4px 9px;
  border-bottom: 1px solid var(--border);
  color: var(--fg-muted);
}

.git-history-search input,
.git-history-path input {
  min-width: 0;
  flex: 1;
  height: 25px;
  border: 0;
  color: var(--fg);
  background: transparent;
  font-size: 11px;
  outline: none;
}

.git-history-icon-button {
  width: 25px;
  height: 25px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 3px;
  color: var(--fg-muted);
  background: transparent;
  cursor: pointer;
}

.git-history-icon-button:hover,
.git-history-icon-button:focus-visible {
  color: var(--fg-bright);
  background: var(--bg-hover);
}

.git-compare-box {
  display: grid;
  grid-template-columns: 1fr 1fr auto;
  gap: 5px;
  padding: 7px;
  border-bottom: 1px solid var(--border);
}

.git-compare-heading {
  grid-column: 1 / -1;
  display: flex;
  align-items: center;
  gap: 5px;
  color: var(--fg-muted);
  font-size: 10px;
  text-transform: uppercase;
}

.git-compare-box label {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
  color: var(--fg-muted);
  font-size: 9px;
}

.git-compare-box select {
  min-width: 0;
  height: 27px;
  border: 1px solid var(--border);
  border-radius: 3px;
  color: var(--fg);
  background: var(--bg);
  font-size: 10px;
}

.git-compare-button,
.git-history-more {
  border: 1px solid var(--border);
  border-radius: 3px;
  color: var(--fg);
  background: var(--tab-bg);
  cursor: pointer;
  font-size: 10px;
}

.git-compare-button {
  align-self: end;
  height: 27px;
  padding: 0 8px;
}

.git-compare-button:hover:not(:disabled),
.git-history-more:hover:not(:disabled) {
  border-color: var(--accent);
  background: var(--bg-hover);
}

.git-compare-button:disabled,
.git-history-more:disabled {
  opacity: 0.45;
  cursor: default;
}

.git-history-message {
  margin: 0;
  padding: 7px 9px;
  border-bottom: 1px solid var(--border);
  font-size: 11px;
}

.git-history-message.error {
  color: var(--color-red, #e06c75);
}

.git-history-message.success {
  color: var(--color-green, #62b478);
}

.git-history-selection-bar {
  min-height: 34px;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 7px;
  border-bottom: 1px solid var(--border);
  color: var(--fg-muted);
  background: var(--tab-bg);
  font-size: 10px;
}

.git-history-selection-bar > span:first-child {
  min-width: 0;
  flex: 1;
}

.git-history-batch-button {
  min-height: 25px;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 0 7px;
  border: 1px solid var(--border);
  border-radius: 3px;
  color: var(--fg);
  background: var(--bg);
  cursor: pointer;
  font-size: 9px;
}

.git-history-batch-button:hover,
.git-history-batch-button:focus-visible {
  border-color: var(--accent);
  background: var(--bg-hover);
  outline: none;
}

.git-history-batch-button:disabled {
  cursor: default;
  opacity: 0.5;
}

.git-history-state {
  min-height: 110px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  color: var(--fg-muted);
  text-align: center;
  font-size: 11px;
}

.git-history-list {
  min-height: 0;
  flex: 1;
  overflow: auto;
  padding: 2px 0 8px;
}

.git-history-entry {
  min-width: 0;
  min-height: 48px;
  display: flex;
  align-items: stretch;
  border-bottom: 1px solid color-mix(in srgb, var(--border) 65%, transparent);
}

.git-history-entry:hover,
.git-history-entry:focus-within {
  background: var(--bg-hover);
  box-shadow: inset 2px 0 0 var(--accent);
}

.git-history-graph {
  min-width: 22px;
  flex: 0 0 auto;
  overflow: visible;
}

.git-history-row {
  min-width: 0;
  flex: 1;
  min-height: 48px;
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding: 7px 9px;
  border: 0;
  color: var(--fg);
  background: transparent;
  text-align: left;
  cursor: pointer;
}

.git-history-select {
  width: 26px;
  flex: 0 0 26px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}

.git-history-select input {
  width: 14px;
  height: 14px;
  margin: 0;
  accent-color: var(--accent);
  cursor: pointer;
}

.git-history-row:hover,
.git-history-row:focus-visible {
  background: transparent;
  outline: none;
}

.git-history-refs {
  min-width: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 3px;
}

.git-history-ref {
  max-width: 100%;
  overflow: hidden;
  padding: 1px 4px;
  border: 1px solid var(--border);
  border-radius: 3px;
  color: var(--fg-muted);
  background: var(--tab-bg);
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 8px;
}

.git-history-ref-head {
  border-color: color-mix(in srgb, var(--accent) 70%, var(--border));
  color: var(--accent);
}

.git-history-ref-tag {
  border-color: color-mix(in srgb, #e5b95c 70%, var(--border));
  color: #e5b95c;
}

.git-history-ref-remote {
  border-color: color-mix(in srgb, #62b478 65%, var(--border));
  color: #62b478;
}

.git-history-subject {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--fg-bright);
  font-size: 11px;
}

.git-history-meta {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 7px;
  color: var(--fg-muted);
  font-size: 9px;
}

.git-history-meta code {
  color: var(--color-blue, #69a7d8);
  font-family: var(--font-mono);
}

.git-history-meta span {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.git-history-meta time {
  flex: 0 0 auto;
}

.git-history-more {
  width: calc(100% - 14px);
  min-height: 28px;
  margin: 7px;
}
</style>
