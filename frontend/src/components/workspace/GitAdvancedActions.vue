<template>
  <section class="git-advanced-section" :aria-label="t('gitPanel.advancedActions')">
    <button type="button" class="git-advanced-heading" @click="expanded = !expanded">
      <ChevronDown :size="13" :class="{ collapsed: !expanded }" />
      <Wrench :size="13" />
      <span>{{ t('gitPanel.advancedActions') }}</span>
    </button>
    <template v-if="expanded">
      <div v-if="currentOperation" class="git-operation-banner" role="status">
        <span>
          {{ t('gitPanel.operationInProgress').replace('{operation}', currentOperation) }}
        </span>
        <button type="button" :disabled="busy" @click="controlOperation('continue')">
          {{ t('gitPanel.continueOperation') }}
        </button>
        <button type="button" class="danger" :disabled="busy" @click="controlOperation('abort')">
          {{ t('gitPanel.abortOperation') }}
        </button>
      </div>

      <p v-if="errorMessage" class="git-advanced-message error" role="alert">
        {{ errorMessage }}
      </p>
      <p v-else-if="statusMessage" class="git-advanced-message success" role="status">
        {{ statusMessage }}
      </p>

      <div class="git-advanced-group">
        <h3>{{ t('gitPanel.branchOperations') }}</h3>
        <select v-model="selectedSource" data-testid="git-advanced-source">
          <option value="" disabled>{{ t('gitPanel.selectSourceBranch') }}</option>
          <option v-for="branchName in branchNames" :key="branchName" :value="branchName">
            {{ branchName }}
          </option>
        </select>
        <div class="git-advanced-button-row">
          <button
            type="button"
            data-testid="git-merge-button"
            :disabled="busy || !selectedSource"
            @click="runSourceAction('git-merge')"
          >
            <GitMerge :size="13" />{{ t('gitPanel.merge') }}
          </button>
          <button
            type="button"
            data-testid="git-rebase-button"
            :disabled="busy || !selectedSource"
            @click="runSourceAction('git-rebase')"
          >
            <GitPullRequestArrow :size="13" />{{ t('gitPanel.rebase') }}
          </button>
        </div>
      </div>

      <div class="git-advanced-group">
        <h3>{{ t('gitPanel.commitOperations') }}</h3>
        <input
          v-model="commitHash"
          data-testid="git-advanced-commit"
          type="text"
          :placeholder="t('gitPanel.commitHashPlaceholder')"
        />
        <div class="git-advanced-button-row">
          <button
            type="button"
            data-testid="git-cherry-pick-button"
            :disabled="busy || !commitHash.trim()"
            @click="runCommitAction('git-cherry-pick')"
          >
            <Cherry :size="13" />{{ t('gitPanel.cherryPick') }}
          </button>
          <button
            type="button"
            data-testid="git-revert-commit-button"
            :disabled="busy || !commitHash.trim()"
            @click="runCommitAction('git-revert-commit')"
          >
            <RotateCcw :size="13" />{{ t('gitPanel.revertCommit') }}
          </button>
        </div>
      </div>

      <div class="git-advanced-group">
        <h3>{{ t('gitPanel.reset') }}</h3>
        <div class="git-reset-row">
          <input v-model="resetTarget" type="text" :placeholder="t('gitPanel.resetTarget')" />
          <select v-model="resetMode">
            <option value="soft">soft</option>
            <option value="mixed">mixed</option>
            <option value="hard">hard</option>
          </select>
          <button
            type="button"
            :disabled="busy || !resetTarget.trim()"
            @click="resetPending = true"
          >
            {{ t('gitPanel.reset') }}
          </button>
        </div>
      </div>

      <div class="git-advanced-group">
        <h3>{{ t('gitPanel.tags') }}</h3>
        <div class="git-tag-create">
          <input v-model="tagName" type="text" :placeholder="t('gitPanel.tagName')" />
          <input v-model="tagTarget" type="text" :placeholder="t('gitPanel.tagTarget')" />
          <label>
            <input v-model="annotatedTag" type="checkbox" />
            <span>{{ t('gitPanel.annotatedTag') }}</span>
          </label>
          <input
            v-if="annotatedTag"
            v-model="tagMessage"
            type="text"
            :placeholder="t('gitPanel.tagMessage')"
          />
          <button type="button" :disabled="!canCreateTag" @click="createTag">
            <Plus :size="13" />{{ t('gitPanel.createTag') }}
          </button>
        </div>
        <div v-if="tags.length" class="git-tag-list">
          <div v-for="tag in tags" :key="tag.name" data-testid="git-tag-row" class="git-tag-row">
            <span class="git-tag-copy">
              <span>{{ tag.name }}</span>
              <code>{{ tag.target.slice(0, 8) }}</code>
            </span>
            <button
              type="button"
              class="git-advanced-icon-button danger"
              :title="t('gitPanel.deleteTag')"
              :aria-label="t('gitPanel.deleteTag')"
              @click="tagPendingDelete = tag.name"
            >
              <Trash2 :size="13" />
            </button>
          </div>
        </div>
      </div>
    </template>

    <ConfirmModal
      :visible="resetPending"
      :title="t('gitPanel.reset')"
      :message="resetConfirmationMessage"
      :confirm-text="t('gitPanel.reset')"
      :cancel-text="t('filePreview.cancel')"
      @confirm="confirmReset"
      @cancel="resetPending = false"
    />
    <ConfirmModal
      :visible="!!tagPendingDelete"
      :title="t('gitPanel.deleteTag')"
      :message="t('gitPanel.deleteTagMessage').replace('{tag}', tagPendingDelete || '')"
      :confirm-text="t('gitPanel.deleteTag')"
      :cancel-text="t('filePreview.cancel')"
      @confirm="deleteTag"
      @cancel="tagPendingDelete = null"
    />
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  Cherry,
  ChevronDown,
  GitMerge,
  GitPullRequestArrow,
  Plus,
  RotateCcw,
  Trash2,
  Wrench,
} from 'lucide-vue-next'
import { apiUrl, authFetch, getApiBase } from '../../composables/apiBase'
import { useI18n } from '../../composables/useI18n'
import { appendGitRepository } from '../../utils/gitPanel'
import ConfirmModal from '../ui/ConfirmModal.vue'

interface GitTagEntry {
  name: string
  target: string
  createdAt: string
  subject: string
}

const props = defineProps<{
  paneId: string
  repository?: string
}>()

const emit = defineEmits<{
  refresh: []
}>()

const { t } = useI18n()
const expanded = ref(false)
const busy = ref(false)
const errorMessage = ref('')
const statusMessage = ref('')
const branchNames = ref<string[]>([])
const selectedSource = ref('')
const commitHash = ref('')
const resetTarget = ref('HEAD')
const resetMode = ref<'soft' | 'mixed' | 'hard'>('mixed')
const resetPending = ref(false)
const currentOperation = ref<string | null>(null)
const tags = ref<GitTagEntry[]>([])
const tagName = ref('')
const tagTarget = ref('HEAD')
const annotatedTag = ref(false)
const tagMessage = ref('')
const tagPendingDelete = ref<string | null>(null)

const canCreateTag = computed(function computeCanCreateTag() {
  // 步骤1：标签名和目标必须存在，附注标签还必须填写说明。
  if (busy.value || !tagName.value.trim() || !tagTarget.value.trim()) return false
  if (annotatedTag.value && !tagMessage.value.trim()) return false
  return true
})

const resetConfirmationMessage = computed(function computeResetConfirmationMessage() {
  // 步骤1：hard 模式明确提示会丢弃工作区更改，其他模式说明目标和模式。
  const key = resetMode.value === 'hard' ? 'gitPanel.hardResetMessage' : 'gitPanel.resetMessage'
  return t(key).replace('{target}', resetTarget.value).replace('{mode}', resetMode.value)
})

async function getJson(endpoint: string): Promise<Record<string, unknown>> {
  // 步骤1：读取当前仓库的高级操作辅助数据。
  await getApiBase()
  const query = new URLSearchParams({ pane_id: props.paneId })
  appendGitRepository(query, props.repository)
  const response = await authFetch(apiUrl(`/api/workspace/${endpoint}?${query}`))
  if (!response.ok) return {}
  return response.json().catch(function emptyAdvancedResult() {
    return {}
  })
}

async function loadBranches(): Promise<void> {
  // 步骤1：合并本地和远程分支名称，供 Merge 与 Rebase 选择。
  const result = await getJson('git-branches')
  const names: string[] = []
  const groups = [result.local, result.remote]
  for (const group of groups) {
    if (!Array.isArray(group)) continue
    for (const rawBranch of group) {
      if (!rawBranch || typeof rawBranch !== 'object') continue
      const branch = rawBranch as Record<string, unknown>
      const name = String(branch.name || '')
      if (name && !names.includes(name)) names.push(name)
    }
  }
  branchNames.value = names
}

async function loadTags(): Promise<void> {
  // 步骤1：读取并转换本地标签列表。
  const result = await getJson('git-tags')
  const nextTags: GitTagEntry[] = []
  if (Array.isArray(result.tags)) {
    for (const rawTag of result.tags) {
      if (!rawTag || typeof rawTag !== 'object') continue
      const tag = rawTag as Record<string, unknown>
      nextTags.push({
        name: String(tag.name || ''),
        target: String(tag.target || ''),
        createdAt: String(tag.created_at || ''),
        subject: String(tag.subject || ''),
      })
    }
  }
  tags.value = nextTags
}

async function loadOperationState(): Promise<void> {
  // 步骤1：读取当前是否有需要继续或中止的 Git 操作。
  const result = await getJson('git-operation-state')
  currentOperation.value = typeof result.operation === 'string' ? result.operation : null
}

async function postAction(endpoint: string, body: Record<string, unknown>): Promise<boolean> {
  // 步骤1：发送经过界面约束的高级操作并显示真实 Git 结果。
  busy.value = true
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
    const result = await response.json().catch(function emptyAdvancedActionResult() {
      return {}
    })
    if (!response.ok) {
      errorMessage.value = String(result.error || t('gitPanel.advancedOperationFailed'))
      return false
    }
    statusMessage.value = String(result.output || t('gitPanel.advancedOperationSucceeded'))
    emit('refresh')
    return true
  } catch {
    errorMessage.value = t('gitPanel.advancedOperationFailed')
    return false
  } finally {
    busy.value = false
  }
}

async function refreshAuxiliaryData(): Promise<void> {
  // 步骤1：操作后并行刷新操作状态、分支和标签。
  await Promise.all([loadOperationState(), loadBranches(), loadTags()])
}

async function runSourceAction(endpoint: 'git-merge' | 'git-rebase'): Promise<void> {
  // 步骤1：执行选定来源分支的 Merge 或 Rebase。
  if (!selectedSource.value) return
  await postAction(endpoint, { source: selectedSource.value })
  await refreshAuxiliaryData()
}

async function runCommitAction(endpoint: 'git-cherry-pick' | 'git-revert-commit'): Promise<void> {
  // 步骤1：执行明确提交 ID 的 Cherry-pick 或 Revert。
  const commit = commitHash.value.trim()
  if (!commit) return
  const succeeded = await postAction(endpoint, { commit })
  if (succeeded) commitHash.value = ''
  await refreshAuxiliaryData()
}

async function controlOperation(action: 'continue' | 'abort'): Promise<void> {
  // 步骤1：只对后端识别出的进行中操作执行继续或中止。
  if (!currentOperation.value) return
  await postAction('git-operation-action', { operation: currentOperation.value, action })
  await refreshAuxiliaryData()
}

async function confirmReset(): Promise<void> {
  // 步骤1：确认后发送 Reset；hard 模式额外携带后端要求的确认标记。
  resetPending.value = false
  await postAction('git-reset', {
    target: resetTarget.value.trim(),
    mode: resetMode.value,
    confirm_hard: resetMode.value === 'hard',
  })
  await refreshAuxiliaryData()
}

async function createTag(): Promise<void> {
  // 步骤1：创建轻量或附注标签，并在成功后清空名称和说明。
  if (!canCreateTag.value) return
  const succeeded = await postAction('git-tag-create', {
    name: tagName.value.trim(),
    target: tagTarget.value.trim(),
    annotated: annotatedTag.value,
    message: tagMessage.value.trim(),
  })
  if (succeeded) {
    tagName.value = ''
    tagMessage.value = ''
  }
  await loadTags()
}

async function deleteTag(): Promise<void> {
  // 步骤1：读取并清除待删除标签，确认后删除该本地标签。
  const name = tagPendingDelete.value
  tagPendingDelete.value = null
  if (!name) return
  await postAction('git-tag-delete', { name })
  await loadTags()
}

watch(
  function watchAdvancedRepository() {
    return [props.paneId, props.repository]
  },
  function loadAdvancedData() {
    // 步骤1：组件挂载或仓库切换后并行读取分支、标签和进行中操作。
    void refreshAuxiliaryData()
  },
  { immediate: true }
)
</script>

<style scoped>
.git-advanced-section {
  border-bottom: 1px solid var(--border);
}

.git-advanced-heading {
  width: 100%;
  min-height: 31px;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 8px;
  border: 0;
  color: var(--fg-bright);
  background: var(--tab-bg);
  cursor: pointer;
  font-size: 10px;
  font-weight: 600;
  text-align: left;
  text-transform: uppercase;
}

.git-advanced-heading:hover,
.git-advanced-heading:focus-visible {
  background: var(--bg-hover);
  outline: none;
}

.git-advanced-heading svg:first-child {
  transition: transform 0.15s ease;
}

.git-advanced-heading svg.collapsed {
  transform: rotate(-90deg);
}

.git-operation-banner {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 6px 7px;
  border-top: 1px solid var(--border);
  color: var(--color-orange, #d7a148);
  font-size: 9px;
}

.git-operation-banner span {
  min-width: 0;
  flex: 1;
}

.git-operation-banner button,
.git-advanced-button-row button,
.git-reset-row button,
.git-tag-create > button {
  min-height: 27px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  border: 1px solid var(--border);
  border-radius: 3px;
  color: var(--fg);
  background: var(--tab-bg);
  cursor: pointer;
  font-size: 9px;
}

.git-operation-banner button:hover:not(:disabled),
.git-advanced-button-row button:hover:not(:disabled),
.git-reset-row button:hover:not(:disabled),
.git-tag-create > button:hover:not(:disabled) {
  border-color: var(--accent);
  background: var(--bg-hover);
}

.git-operation-banner button.danger {
  color: var(--color-red, #e06c75);
}

.git-advanced-section button:disabled {
  opacity: 0.4;
  cursor: default;
}

.git-advanced-message {
  margin: 0;
  padding: 6px 8px;
  border-top: 1px solid var(--border);
  font-size: 9px;
}

.git-advanced-message.error {
  color: var(--color-red, #e06c75);
}

.git-advanced-message.success {
  color: var(--color-green, #62b478);
}

.git-advanced-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 7px;
  border-top: 1px solid var(--border);
}

.git-advanced-group h3 {
  margin: 0;
  color: var(--fg-muted);
  font-size: 9px;
  font-weight: 600;
  text-transform: uppercase;
}

.git-advanced-group input[type='text'],
.git-advanced-group select {
  min-width: 0;
  height: 27px;
  box-sizing: border-box;
  border: 1px solid var(--border);
  border-radius: 3px;
  padding: 0 6px;
  color: var(--fg);
  background: var(--bg);
  font-size: 9px;
}

.git-advanced-group input:focus,
.git-advanced-group select:focus {
  border-color: var(--accent);
  outline: none;
}

.git-advanced-button-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 5px;
}

.git-reset-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 64px auto;
  gap: 5px;
}

.git-tag-create {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 5px;
}

.git-tag-create label {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--fg-muted);
  font-size: 9px;
}

.git-tag-create label input {
  margin: 0;
}

.git-tag-create > button {
  min-width: 0;
}

.git-tag-list {
  border-top: 1px solid var(--border);
}

.git-tag-row {
  min-height: 31px;
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 2px 2px 2px 7px;
  border-bottom: 1px solid color-mix(in srgb, var(--border) 65%, transparent);
}

.git-tag-copy {
  min-width: 0;
  flex: 1;
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 9px;
}

.git-tag-copy span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--fg-bright);
}

.git-tag-copy code {
  color: var(--fg-muted);
  font-family: var(--font-mono);
}

.git-advanced-icon-button {
  width: 26px;
  height: 26px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 3px;
  color: var(--fg-muted);
  background: transparent;
  cursor: pointer;
}

.git-advanced-icon-button:hover,
.git-advanced-icon-button:focus-visible {
  color: var(--fg-bright);
  background: var(--bg-hover);
  outline: 1px solid var(--accent);
  outline-offset: -1px;
}

.git-advanced-icon-button.danger:hover {
  color: var(--color-red, #e06c75);
}

@media (prefers-reduced-motion: reduce) {
  .git-advanced-heading svg:first-child {
    transition: none;
  }
}
</style>
