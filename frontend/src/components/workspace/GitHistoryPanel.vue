<template>
  <section class="git-history-panel" :aria-label="t('gitPanel.history')">
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
    <div v-if="loading && !commits.length" class="git-history-state">
      {{ t('gitPanel.loadingHistory') }}
    </div>
    <div v-else-if="!commits.length" class="git-history-state">
      {{ t('gitPanel.noHistory') }}
    </div>
    <div v-else class="git-history-list">
      <button
        v-for="commit in commits"
        :key="commit.hash"
        type="button"
        data-testid="git-history-row"
        class="git-history-row"
        @click="openCommit(commit)"
      >
        <span class="git-history-subject">{{ commit.subject }}</span>
        <span class="git-history-meta">
          <code>{{ commit.shortHash }}</code>
          <span>{{ commit.authorName }}</span>
          <time :datetime="commit.authoredAt">{{ formatDate(commit.authoredAt) }}</time>
        </span>
      </button>
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
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { GitCompareArrows, Search, X } from 'lucide-vue-next'
import { apiUrl, authFetch, getApiBase } from '../../composables/apiBase'
import { useI18n } from '../../composables/useI18n'
import {
  mapGitCommitEntry,
  type GitCommitEntry,
  type GitHistorySelection,
} from '../../utils/gitHistory'

interface BranchEntry {
  name: string
}

const props = defineProps<{
  paneId: string
  currentBranch: string | null
}>()

const emit = defineEmits<{
  'view-history': [selection: GitHistorySelection]
}>()

const { t } = useI18n()
const pageSize = 50
const commits = ref<GitCommitEntry[]>([])
const branchNames = ref<string[]>([])
const pathInput = ref('')
const activePath = ref('')
const compareBase = ref('')
const compareTarget = ref('')
const loading = ref(false)
const hasMore = ref(false)
const errorMessage = ref('')

const canCompare = computed(function computeCanCompare() {
  // 步骤1：只有选择两个不同分支时才允许比较。
  return (
    compareBase.value.length > 0 &&
    compareTarget.value.length > 0 &&
    compareBase.value !== compareTarget.value
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
  try {
    await getApiBase()
    const query = new URLSearchParams({ pane_id: props.paneId })
    const response = await authFetch(apiUrl(`/api/workspace/git-branches?${query}`))
    const result = await response.json().catch(function emptyBranchResult() {
      return {}
    })
    if (!response.ok) return

    // 步骤2：合并分支列表，并默认比较主分支与当前分支。
    const names: string[] = []
    mapBranchNames(result.local, names)
    mapBranchNames(result.remote, names)
    branchNames.value = names
    compareTarget.value = props.currentBranch || names[0] || ''
    compareBase.value = findDefaultBase(names, compareTarget.value)
  } catch {
    branchNames.value = []
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
    if (activePath.value) query.set('path', activePath.value)
    const response = await authFetch(apiUrl(`/api/workspace/git-log?${query}`))
    const result = await response.json().catch(function emptyHistoryResult() {
      return {}
    })
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
    errorMessage.value = t('gitPanel.historyFailed')
  } finally {
    loading.value = false
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

watch(
  function watchHistoryRepository() {
    return [props.paneId, props.currentBranch]
  },
  function reloadHistoryRepository() {
    void loadBranches()
    void loadHistory(false)
  },
  { immediate: true }
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

.git-history-path {
  min-height: 34px;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 6px 4px 9px;
  border-bottom: 1px solid var(--border);
  color: var(--fg-muted);
}

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

.git-history-row {
  width: 100%;
  min-height: 48px;
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding: 7px 9px;
  border: 0;
  border-bottom: 1px solid color-mix(in srgb, var(--border) 65%, transparent);
  color: var(--fg);
  background: transparent;
  text-align: left;
  cursor: pointer;
}

.git-history-row:hover,
.git-history-row:focus-visible {
  background: var(--bg-hover);
  outline: none;
  box-shadow: inset 2px 0 0 var(--accent);
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
