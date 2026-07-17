<template>
  <section class="git-stash-section" :aria-label="t('gitPanel.stashes')">
    <button type="button" class="git-stash-heading" @click="expanded = !expanded">
      <ChevronDown :size="13" :class="{ collapsed: !expanded }" />
      <Archive :size="13" />
      <span>{{ t('gitPanel.stashes') }}</span>
      <span class="git-stash-count">{{ stashes.length }}</span>
    </button>
    <template v-if="expanded">
      <form class="git-stash-save" @submit.prevent="saveStash">
        <input
          v-model="message"
          data-testid="git-stash-message"
          type="text"
          :placeholder="t('gitPanel.stashMessagePlaceholder')"
        />
        <select v-model="stashMode" data-testid="git-stash-mode" :disabled="busy">
          <option value="all">{{ t('gitPanel.stashAllChanges') }}</option>
          <option value="staged">{{ t('gitPanel.stashStagedChanges') }}</option>
          <option value="selected">{{ t('gitPanel.stashSelectedFiles') }}</option>
        </select>
        <button
          type="button"
          data-testid="git-stash-save"
          class="git-stash-icon-button"
          :title="t('gitPanel.stashSave')"
          :aria-label="t('gitPanel.stashSave')"
          :disabled="busy || !canSaveStash"
          @click="saveStash"
        >
          <ArchiveRestore :size="13" />
        </button>
        <div class="git-stash-options">
          <label>
            <input
              v-model="includeUntracked"
              data-testid="git-stash-untracked"
              type="checkbox"
              :disabled="busy || stashMode === 'staged'"
            />
            <span>{{ t('gitPanel.stashIncludeUntracked') }}</span>
          </label>
          <label>
            <input
              v-model="keepIndex"
              data-testid="git-stash-keep-index"
              type="checkbox"
              :disabled="busy || stashMode === 'staged'"
            />
            <span>{{ t('gitPanel.stashKeepIndex') }}</span>
          </label>
        </div>
        <div v-if="stashMode === 'selected'" class="git-stash-paths">
          <label v-for="file in availableFiles" :key="file.path">
            <input
              v-model="selectedPaths"
              data-testid="git-stash-path"
              :data-path="file.path"
              type="checkbox"
              :value="file.path"
              :disabled="busy"
            />
            <span>{{ file.path }}</span>
          </label>
          <p v-if="!availableFiles.length">{{ t('gitPanel.noStashFiles') }}</p>
        </div>
      </form>

      <p v-if="errorMessage" class="git-stash-message error" role="alert">
        {{ errorMessage }}
      </p>
      <div v-if="loading" class="git-stash-state">{{ t('gitPanel.loadingStashes') }}</div>
      <div v-else-if="!stashes.length" class="git-stash-state">{{ t('gitPanel.noStashes') }}</div>
      <div v-else class="git-stash-list">
        <div v-for="stash in stashes" :key="stash.reference" class="git-stash-entry">
          <div data-testid="git-stash-row" class="git-stash-row">
            <span class="git-stash-copy">
              <span class="git-stash-title">{{ stash.message }}</span>
              <span class="git-stash-meta">
                <code>{{ stash.reference }}</code>
                <time :datetime="stash.createdAt">{{ formatDate(stash.createdAt) }}</time>
              </span>
            </span>
            <span class="git-stash-actions">
              <button
                type="button"
                data-testid="git-stash-view-diff"
                class="git-stash-icon-button"
                :title="t('gitPanel.stashViewDiff')"
                :aria-label="t('gitPanel.stashViewDiff')"
                :disabled="busy"
                @click="toggleStashDiff(stash.reference)"
              >
                <FileDiff :size="13" />
              </button>
              <button
                type="button"
                data-testid="git-stash-apply"
                class="git-stash-icon-button"
                :title="t('gitPanel.stashApply')"
                :aria-label="t('gitPanel.stashApply')"
                :disabled="busy"
                @click="runStashAction('git-stash-apply', stash.reference)"
              >
                <Download :size="13" />
              </button>
              <button
                type="button"
                data-testid="git-stash-pop"
                class="git-stash-icon-button"
                :title="t('gitPanel.stashPop')"
                :aria-label="t('gitPanel.stashPop')"
                :disabled="busy"
                @click="runStashAction('git-stash-pop', stash.reference)"
              >
                <PackageOpen :size="13" />
              </button>
              <button
                type="button"
                data-testid="git-stash-drop"
                class="git-stash-icon-button danger"
                :title="t('gitPanel.stashDrop')"
                :aria-label="t('gitPanel.stashDrop')"
                :disabled="busy"
                @click="stashPendingDrop = stash.reference"
              >
                <Trash2 :size="13" />
              </button>
            </span>
          </div>
          <div v-if="selectedStashReference === stash.reference" class="git-stash-diff">
            <GitPatchContent
              :loading="diffLoading"
              :error="diffErrorMessage"
              :patch="stashPatch"
              :loading-text="t('gitPanel.loadingStashDiff')"
              :empty-text="t('gitPanel.noStashDiff')"
              :diff-label="t('gitPanel.stashDiff')"
              :search-placeholder="t('gitPanel.searchDiff')"
              :load-more-text="t('gitPanel.loadMoreDiffLines')"
              :wrap-text="t('gitPanel.wrapDiffLines')"
              :inline-view-text="t('gitPanel.inlineDiffView')"
              :split-view-text="t('gitPanel.splitDiffView')"
            />
          </div>
        </div>
      </div>
    </template>

    <ConfirmModal
      :visible="!!stashPendingDrop"
      :title="t('gitPanel.stashDrop')"
      :message="t('gitPanel.stashDropMessage').replace('{reference}', stashPendingDrop || '')"
      :confirm-text="t('gitPanel.stashDrop')"
      :cancel-text="t('filePreview.cancel')"
      @confirm="dropStash"
      @cancel="stashPendingDrop = null"
    />
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  Archive,
  ArchiveRestore,
  ChevronDown,
  Download,
  FileDiff,
  PackageOpen,
  Trash2,
} from 'lucide-vue-next'
import { apiUrl, authFetch, getApiBase } from '../../composables/apiBase'
import { useI18n } from '../../composables/useI18n'
import { appendGitRepository } from '../../utils/gitPanel'
import ConfirmModal from '../ui/ConfirmModal.vue'
import GitPatchContent from './GitPatchContent.vue'

interface GitStashEntry {
  reference: string
  hash: string
  createdAt: string
  message: string
}

interface StashFileEntry {
  path: string
  staged: boolean
  unstaged: boolean
}

const props = defineProps<{
  paneId: string
  repository?: string
  files?: StashFileEntry[]
}>()

const emit = defineEmits<{
  refresh: []
}>()

const { t } = useI18n()
const expanded = ref(true)
const loading = ref(false)
const busy = ref(false)
const message = ref('')
const stashMode = ref<'all' | 'staged' | 'selected'>('all')
const includeUntracked = ref(false)
const keepIndex = ref(false)
const selectedPaths = ref<string[]>([])
const errorMessage = ref('')
const stashes = ref<GitStashEntry[]>([])
const stashPendingDrop = ref<string | null>(null)
const selectedStashReference = ref<string | null>(null)
const stashPatch = ref('')
const diffLoading = ref(false)
const diffErrorMessage = ref('')

const availableFiles = computed(function computeAvailableFiles() {
  // 步骤1：只显示当前 Git 状态中确实有暂存或工作区变化的文件。
  const result: StashFileEntry[] = []
  const files = props.files || []
  for (const file of files) {
    if (file.staged || file.unstaged) {
      result.push(file)
    }
  }
  return result
})

const canSaveStash = computed(function computeCanSaveStash() {
  // 步骤1：选中文件模式至少需要一个路径，其他模式交给 Git 判断是否有更改。
  if (stashMode.value === 'selected') {
    return selectedPaths.value.length > 0
  }
  return true
})

async function loadStashes(): Promise<void> {
  // 步骤1：读取当前仓库的 Stash 列表并转换接口字段。
  loading.value = true
  errorMessage.value = ''
  try {
    await getApiBase()
    const query = new URLSearchParams({ pane_id: props.paneId })
    appendGitRepository(query, props.repository)
    const response = await authFetch(apiUrl(`/api/workspace/git-stashes?${query}`))
    const result = await response.json().catch(function emptyStashResult() {
      return {}
    })
    if (!response.ok) {
      errorMessage.value = result.error || t('gitPanel.stashOperationFailed')
      return
    }
    const nextStashes: GitStashEntry[] = []
    if (Array.isArray(result.stashes)) {
      for (const rawStash of result.stashes) {
        if (!rawStash || typeof rawStash !== 'object') continue
        const stash = rawStash as Record<string, unknown>
        nextStashes.push({
          reference: String(stash.reference || ''),
          hash: String(stash.hash || ''),
          createdAt: String(stash.created_at || ''),
          message: String(stash.message || ''),
        })
      }
    }
    stashes.value = nextStashes
  } catch {
    errorMessage.value = t('gitPanel.stashOperationFailed')
  } finally {
    loading.value = false
  }
}

async function postStashAction(endpoint: string, body: Record<string, unknown>): Promise<boolean> {
  // 步骤1：向当前仓库发送单个 Stash 操作并显示真实错误。
  busy.value = true
  errorMessage.value = ''
  try {
    await getApiBase()
    const query = new URLSearchParams({ pane_id: props.paneId })
    appendGitRepository(query, props.repository)
    const response = await authFetch(apiUrl(`/api/workspace/${endpoint}?${query}`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const result = await response.json().catch(function emptyStashActionResult() {
      return {}
    })
    if (!response.ok) {
      errorMessage.value = result.error || t('gitPanel.stashOperationFailed')
      return false
    }

    // 步骤2：成功后刷新 Stash 列表和工作区 Git 状态。
    await loadStashes()
    emit('refresh')
    return true
  } catch {
    errorMessage.value = t('gitPanel.stashOperationFailed')
    return false
  } finally {
    busy.value = false
  }
}

async function saveStash(): Promise<void> {
  // 步骤1：按保存范围生成互斥的 staged_only 和 paths 参数。
  const paths: string[] = []
  if (stashMode.value === 'selected') {
    for (const path of selectedPaths.value) {
      paths.push(path)
    }
  }
  const stagedOnly = stashMode.value === 'staged'
  const saved = await postStashAction('git-stash-save', {
    message: message.value.trim(),
    include_untracked: stagedOnly ? false : includeUntracked.value,
    keep_index: stagedOnly ? false : keepIndex.value,
    staged_only: stagedOnly,
    paths,
  })
  if (saved) {
    message.value = ''
    selectedPaths.value = []
  }
}

async function runStashAction(endpoint: string, reference: string): Promise<void> {
  // 步骤1：对用户点击的明确 Stash 引用执行应用或弹出。
  await postStashAction(endpoint, { reference })
}

async function toggleStashDiff(reference: string): Promise<void> {
  // 步骤1：再次点击当前 Stash 时关闭差异，点击其他记录时切换目标。
  if (selectedStashReference.value === reference) {
    selectedStashReference.value = null
    stashPatch.value = ''
    diffErrorMessage.value = ''
    return
  }
  selectedStashReference.value = reference
  stashPatch.value = ''
  diffErrorMessage.value = ''
  diffLoading.value = true

  // 步骤2：读取 Stash 补丁，并交给统一 Diff 组件渲染。
  try {
    await getApiBase()
    const query = new URLSearchParams({ pane_id: props.paneId })
    appendGitRepository(query, props.repository)
    query.set('reference', reference)
    const response = await authFetch(apiUrl(`/api/workspace/git-stash-diff?${query}`))
    const result = await response.json().catch(function emptyStashDiffResult() {
      return {}
    })
    if (!response.ok) {
      diffErrorMessage.value = result.error || t('gitPanel.stashDiffFailed')
      return
    }
    stashPatch.value = typeof result.patch === 'string' ? result.patch : ''
  } catch {
    diffErrorMessage.value = t('gitPanel.stashDiffFailed')
  } finally {
    diffLoading.value = false
  }
}

async function dropStash(): Promise<void> {
  // 步骤1：读取并清除待删除引用，防止重复确认。
  const reference = stashPendingDrop.value
  stashPendingDrop.value = null
  if (!reference) return
  await postStashAction('git-stash-drop', { reference })
}

function formatDate(value: string): string {
  // 步骤1：按系统地区显示日期，无法解析时保留原始值。
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })
}

watch(
  function watchStashRepository() {
    return [props.paneId, props.repository]
  },
  function loadSelectedRepositoryStashes() {
    // 步骤1：仓库切换后关闭旧差异并读取新仓库 Stash。
    selectedStashReference.value = null
    stashPatch.value = ''
    void loadStashes()
  },
  { immediate: true }
)
</script>

<style scoped>
.git-stash-section {
  border-bottom: 1px solid var(--border);
}

.git-stash-heading {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  min-height: 31px;
  border: 0;
  padding: 0 8px;
  color: var(--fg-bright);
  background: var(--tab-bg);
  font-size: 10px;
  font-weight: 600;
  text-align: left;
  text-transform: uppercase;
  cursor: pointer;
}

.git-stash-heading:hover,
.git-stash-heading:focus-visible {
  background: var(--bg-hover);
  outline: none;
}

.git-stash-heading svg:first-child {
  transition: transform 0.15s ease;
}

.git-stash-heading svg.collapsed {
  transform: rotate(-90deg);
}

.git-stash-heading span:first-of-type {
  flex: 1;
}

.git-stash-count {
  color: var(--fg-muted);
  font-family: var(--font-mono);
}

.git-stash-save {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(78px, auto) 26px;
  gap: 5px;
  padding: 7px;
  border-top: 1px solid var(--border);
}

.git-stash-save > input[type='text'],
.git-stash-save > select {
  min-width: 0;
  min-height: 27px;
  box-sizing: border-box;
  border: 1px solid var(--border);
  border-radius: 3px;
  padding: 0 6px;
  color: var(--fg);
  background: var(--bg);
  font-size: 9px;
}

.git-stash-save > input[type='text'] {
  font-family: var(--font-mono);
}

.git-stash-options {
  display: flex;
  grid-column: 1 / -1;
  flex-wrap: wrap;
  gap: 10px;
}

.git-stash-options label,
.git-stash-paths label {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--fg-muted);
  font-size: 9px;
}

.git-stash-options input,
.git-stash-paths input {
  width: 13px;
  height: 13px;
  margin: 0;
}

.git-stash-paths {
  display: flex;
  grid-column: 1 / -1;
  max-height: 112px;
  flex-direction: column;
  gap: 4px;
  overflow: auto;
  padding: 5px;
  border: 1px solid var(--border);
}

.git-stash-paths label span {
  overflow: hidden;
  font-family: var(--font-mono);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.git-stash-paths p {
  margin: 0;
  color: var(--fg-muted);
  font-size: 9px;
}

.git-stash-icon-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border: 0;
  border-radius: 3px;
  color: var(--fg-muted);
  background: transparent;
  cursor: pointer;
}

.git-stash-icon-button:hover:not(:disabled) {
  color: var(--fg-bright);
  background: var(--bg-hover);
}

.git-stash-icon-button.danger:hover:not(:disabled) {
  color: var(--error, #e06c75);
}

.git-stash-icon-button:disabled {
  opacity: 0.5;
  cursor: default;
}

.git-stash-message,
.git-stash-state {
  margin: 0;
  padding: 7px 8px;
  border-top: 1px solid var(--border);
  color: var(--fg-muted);
  font-size: 9px;
}

.git-stash-message.error {
  color: var(--error, #e06c75);
}

.git-stash-entry {
  border-top: 1px solid var(--border);
}

.git-stash-row {
  display: flex;
  align-items: center;
  gap: 5px;
  min-height: 37px;
  padding: 4px 7px;
}

.git-stash-copy {
  display: flex;
  flex: 1;
  min-width: 0;
  flex-direction: column;
  gap: 2px;
}

.git-stash-title {
  overflow: hidden;
  color: var(--fg-bright);
  font-size: 9px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.git-stash-meta {
  display: flex;
  gap: 6px;
  color: var(--fg-muted);
  font-size: 8px;
}

.git-stash-meta code {
  font-family: var(--font-mono);
}

.git-stash-actions {
  display: inline-flex;
  flex: 0 0 auto;
}

.git-stash-diff {
  border-top: 1px solid var(--border);
}
</style>
