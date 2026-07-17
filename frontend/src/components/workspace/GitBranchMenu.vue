<template>
  <section v-if="visible" class="git-branch-menu" :aria-label="t('gitPanel.manageBranches')">
    <header class="git-branch-menu-header">
      <GitBranch :size="14" aria-hidden="true" />
      <span>{{ t('gitPanel.manageBranches') }}</span>
      <button
        type="button"
        class="git-branch-icon-button"
        :title="t('gitPanel.closeBranches')"
        :aria-label="t('gitPanel.closeBranches')"
        @click="emit('close')"
      >
        <X :size="14" />
      </button>
    </header>

    <div class="git-branch-controls">
      <label class="git-branch-search">
        <Search :size="13" aria-hidden="true" />
        <input v-model="searchText" type="search" :placeholder="t('gitPanel.searchBranches')" />
      </label>
      <div class="git-branch-create-row">
        <input
          v-model="newBranchName"
          data-testid="git-branch-create-input"
          type="text"
          :placeholder="t('gitPanel.newBranchName')"
          @keydown.enter.prevent="createBranch"
        />
        <button
          type="button"
          data-testid="git-branch-create-button"
          class="git-branch-icon-button"
          :title="t('gitPanel.createBranch')"
          :aria-label="t('gitPanel.createBranch')"
          :disabled="busy || !newBranchName.trim()"
          @click="createBranch"
        >
          <Plus :size="14" />
        </button>
      </div>
    </div>

    <p v-if="errorMessage" class="git-branch-message error" role="alert">
      {{ errorMessage }}
    </p>
    <div v-if="loading" class="git-branch-empty">{{ t('gitPanel.loadingBranches') }}</div>
    <div v-else class="git-branch-list">
      <section class="git-branch-section">
        <h3>{{ t('gitPanel.localBranches') }}</h3>
        <div
          v-for="branch in filteredLocalBranches"
          :key="`local:${branch.name}`"
          data-testid="git-local-branch-row"
          :data-branch="branch.name"
          class="git-branch-row"
        >
          <template v-if="renamingBranch === branch.name">
            <input
              v-model="renameBranchName"
              data-testid="git-branch-rename-input"
              class="git-branch-rename-input"
              @keydown.enter.prevent="confirmRename(branch.name)"
              @keydown.escape.prevent="cancelRename"
            />
            <button
              type="button"
              data-testid="git-branch-rename-confirm"
              class="git-branch-icon-button"
              :title="t('gitPanel.confirmRename')"
              :aria-label="t('gitPanel.confirmRename')"
              :disabled="busy || !renameBranchName.trim()"
              @click="confirmRename(branch.name)"
            >
              <Check :size="13" />
            </button>
            <button
              type="button"
              class="git-branch-icon-button"
              :title="t('filePreview.cancel')"
              :aria-label="t('filePreview.cancel')"
              @click="cancelRename"
            >
              <X :size="13" />
            </button>
          </template>
          <template v-else>
            <button
              type="button"
              data-testid="git-branch-switch-button"
              class="git-branch-name-button"
              :title="branch.upstream || branch.name"
              :disabled="busy || branch.current"
              @click="switchBranch(branch.name, false)"
            >
              <Check v-if="branch.current" :size="12" class="current-mark" />
              <span>{{ branch.name }}</span>
            </button>
            <span class="git-branch-row-actions">
              <button
                type="button"
                data-testid="git-branch-rename-button"
                class="git-branch-icon-button"
                :title="t('gitPanel.renameBranch')"
                :aria-label="t('gitPanel.renameBranch')"
                :disabled="busy"
                @click="startRename(branch.name)"
              >
                <Pencil :size="12" />
              </button>
              <button
                type="button"
                data-testid="git-branch-delete-button"
                class="git-branch-icon-button danger"
                :title="t('gitPanel.deleteBranch')"
                :aria-label="t('gitPanel.deleteBranch')"
                :disabled="busy || branch.current"
                @click="requestDelete(branch.name)"
              >
                <Trash2 :size="12" />
              </button>
            </span>
          </template>
        </div>
        <p v-if="!filteredLocalBranches.length" class="git-branch-empty">
          {{ t('gitPanel.noBranches') }}
        </p>
      </section>

      <section v-if="remoteBranches.length" class="git-branch-section">
        <h3>{{ t('gitPanel.remoteBranches') }}</h3>
        <div
          v-for="branch in filteredRemoteBranches"
          :key="`remote:${branch.name}`"
          data-testid="git-remote-branch-row"
          :data-branch="branch.name"
          class="git-branch-row"
        >
          <button
            type="button"
            data-testid="git-branch-switch-button"
            class="git-branch-name-button"
            :title="branch.name"
            :disabled="busy"
            @click="switchBranch(branch.name, true)"
          >
            <Cloud :size="12" />
            <span>{{ branch.name }}</span>
          </button>
        </div>
      </section>
    </div>

    <ConfirmModal
      :visible="!!branchPendingDelete"
      :title="t('gitPanel.deleteBranch')"
      :message="t('gitPanel.deleteBranchMessage').replace('{branch}', branchPendingDelete || '')"
      :confirm-text="t('gitPanel.deleteBranch')"
      :cancel-text="t('filePreview.cancel')"
      @confirm="confirmDelete"
      @cancel="branchPendingDelete = null"
    />
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Check, Cloud, GitBranch, Pencil, Plus, Search, Trash2, X } from 'lucide-vue-next'
import { apiUrl, authFetch, getApiBase } from '../../composables/apiBase'
import { useI18n } from '../../composables/useI18n'
import ConfirmModal from '../ui/ConfirmModal.vue'

interface BranchEntry {
  name: string
  upstream: string | null
  current: boolean
}

const props = defineProps<{
  visible: boolean
  paneId: string
  currentBranch: string | null
}>()

const emit = defineEmits<{
  close: []
  refresh: []
  result: [result: { ok: boolean; message: string }]
}>()

const { t } = useI18n()
const loading = ref(false)
const busy = ref(false)
const errorMessage = ref('')
const searchText = ref('')
const newBranchName = ref('')
const localBranches = ref<BranchEntry[]>([])
const remoteBranches = ref<BranchEntry[]>([])
const renamingBranch = ref<string | null>(null)
const renameBranchName = ref('')
const branchPendingDelete = ref<string | null>(null)

const filteredLocalBranches = computed(function computeFilteredLocalBranches() {
  // 步骤1：按不区分大小写的名称筛选本地分支。
  return filterBranches(localBranches.value, searchText.value)
})

const filteredRemoteBranches = computed(function computeFilteredRemoteBranches() {
  // 步骤1：按同一关键词筛选远程分支。
  return filterBranches(remoteBranches.value, searchText.value)
})

function filterBranches(branches: BranchEntry[], search: string): BranchEntry[] {
  // 步骤1：空关键词保留全部分支，其他情况逐个匹配名称。
  const normalizedSearch = search.trim().toLocaleLowerCase()
  if (!normalizedSearch) return branches
  const result: BranchEntry[] = []
  for (const branch of branches) {
    if (branch.name.toLocaleLowerCase().includes(normalizedSearch)) {
      result.push(branch)
    }
  }
  return result
}

function mapBranchEntries(rawBranches: unknown): BranchEntry[] {
  // 步骤1：只接收包含有效名称的分支对象，避免异常响应破坏列表。
  const result: BranchEntry[] = []
  if (!Array.isArray(rawBranches)) return result
  for (const rawBranch of rawBranches) {
    if (!rawBranch || typeof rawBranch !== 'object') continue
    const branch = rawBranch as Record<string, unknown>
    const name = String(branch.name || '')
    if (!name) continue
    result.push({
      name,
      upstream: typeof branch.upstream === 'string' ? branch.upstream : null,
      current: branch.current === true,
    })
  }
  return result
}

async function loadBranches(): Promise<void> {
  // 步骤1：读取当前仓库的本地和远程分支列表。
  loading.value = true
  errorMessage.value = ''
  try {
    await getApiBase()
    const query = new URLSearchParams({ pane_id: props.paneId })
    const response = await authFetch(apiUrl(`/api/workspace/git-branches?${query}`))
    const result = await response.json().catch(function emptyBranchResult() {
      return {}
    })
    if (!response.ok) {
      errorMessage.value = result.error || t('gitPanel.branchOperationFailed')
      return
    }
    localBranches.value = mapBranchEntries(result.local)
    remoteBranches.value = mapBranchEntries(result.remote)
  } catch {
    errorMessage.value = t('gitPanel.branchOperationFailed')
  } finally {
    loading.value = false
  }
}

async function postBranchAction(endpoint: string, body: Record<string, unknown>): Promise<boolean> {
  // 步骤1：向当前 pane 对应的仓库发送分支操作。
  busy.value = true
  errorMessage.value = ''
  try {
    await getApiBase()
    const query = new URLSearchParams({ pane_id: props.paneId })
    const response = await authFetch(apiUrl(`/api/workspace/${endpoint}?${query}`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const result = await response.json().catch(function emptyBranchActionResult() {
      return {}
    })
    if (!response.ok) {
      const message = result.error || t('gitPanel.branchOperationFailed')
      errorMessage.value = message
      emit('result', { ok: false, message })
      return false
    }

    // 步骤2：成功后刷新分支列表和父级 Git 状态。
    emit('result', {
      ok: true,
      message: result.output || t('gitPanel.branchOperationSucceeded'),
    })
    await loadBranches()
    emit('refresh')
    return true
  } catch {
    const message = t('gitPanel.branchOperationFailed')
    errorMessage.value = message
    emit('result', { ok: false, message })
    return false
  } finally {
    busy.value = false
  }
}

async function switchBranch(name: string, remote: boolean): Promise<void> {
  // 步骤1：切换本地分支，或从远程引用创建跟踪分支。
  const switched = await postBranchAction('git-branch-switch', { name, remote })
  if (switched) emit('close')
}

async function createBranch(): Promise<void> {
  // 步骤1：去掉首尾空白并创建、切换到新分支。
  const name = newBranchName.value.trim()
  if (!name) return
  const created = await postBranchAction('git-branch-create', { name })
  if (created) {
    newBranchName.value = ''
    emit('close')
  }
}

function startRename(name: string): void {
  // 步骤1：进入内联重命名状态并预填原名称。
  renamingBranch.value = name
  renameBranchName.value = name
}

function cancelRename(): void {
  // 步骤1：退出重命名状态并清空临时输入。
  renamingBranch.value = null
  renameBranchName.value = ''
}

async function confirmRename(oldName: string): Promise<void> {
  // 步骤1：发送旧名称和新名称，成功后退出编辑状态。
  const newName = renameBranchName.value.trim()
  if (!newName || newName === oldName) {
    cancelRename()
    return
  }
  const renamed = await postBranchAction('git-branch-rename', {
    old_name: oldName,
    new_name: newName,
  })
  if (renamed) cancelRename()
}

function requestDelete(name: string): void {
  // 步骤1：保存待删除分支，交给确认弹窗阻止误操作。
  branchPendingDelete.value = name
}

async function confirmDelete(): Promise<void> {
  // 步骤1：清空确认状态后执行非强制分支删除。
  const name = branchPendingDelete.value
  branchPendingDelete.value = null
  if (!name) return
  await postBranchAction('git-branch-delete', { name })
}

watch(
  function watchMenuVisibility() {
    return [props.visible, props.paneId]
  },
  function reloadVisibleMenu() {
    if (props.visible) {
      void loadBranches()
    }
  },
  { immediate: true }
)
</script>

<style scoped>
.git-branch-menu {
  position: absolute;
  inset: 32px 0 auto 0;
  z-index: 20;
  max-height: calc(100% - 32px);
  display: flex;
  flex-direction: column;
  color: var(--fg);
  background: var(--bg-surface, var(--bg));
  border-bottom: 1px solid var(--border);
  box-shadow: 0 8px 18px rgba(0, 0, 0, 0.28);
}

.git-branch-menu-header,
.git-branch-create-row,
.git-branch-search,
.git-branch-row,
.git-branch-name-button,
.git-branch-row-actions {
  display: flex;
  align-items: center;
}

.git-branch-menu-header {
  min-height: 32px;
  gap: 7px;
  padding: 0 5px 0 9px;
  border-bottom: 1px solid var(--border);
  color: var(--fg-bright);
  font-size: 11px;
  font-weight: 600;
}

.git-branch-menu-header > span {
  flex: 1;
}

.git-branch-controls {
  padding: 7px;
  border-bottom: 1px solid var(--border);
}

.git-branch-search,
.git-branch-create-row {
  min-height: 29px;
  border: 1px solid var(--border);
  background: var(--bg);
}

.git-branch-search {
  gap: 6px;
  padding: 0 7px;
}

.git-branch-create-row {
  margin-top: 5px;
}

.git-branch-search:focus-within,
.git-branch-create-row:focus-within {
  border-color: var(--accent);
}

.git-branch-search input,
.git-branch-create-row input,
.git-branch-rename-input {
  min-width: 0;
  flex: 1;
  border: 0;
  outline: 0;
  color: var(--fg);
  background: transparent;
  font-family: var(--font-mono);
  font-size: 11px;
}

.git-branch-list {
  min-height: 0;
  overflow: auto;
  padding-bottom: 8px;
}

.git-branch-section h3 {
  position: sticky;
  top: 0;
  z-index: 1;
  margin: 0;
  padding: 7px 9px 4px;
  color: var(--fg-muted);
  background: var(--bg-surface, var(--bg));
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
}

.git-branch-row {
  min-height: 29px;
  gap: 3px;
  padding: 1px 4px 1px 8px;
}

.git-branch-row:hover {
  background: var(--bg-hover);
}

.git-branch-name-button {
  min-width: 0;
  flex: 1;
  gap: 5px;
  height: 27px;
  padding: 0;
  overflow: hidden;
  border: 0;
  color: var(--fg);
  background: transparent;
  cursor: pointer;
  font-family: var(--font-mono);
  font-size: 11px;
  text-align: left;
}

.git-branch-name-button span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.git-branch-name-button:disabled {
  cursor: default;
}

.current-mark {
  flex: 0 0 auto;
  color: var(--color-green, #62b478);
}

.git-branch-row-actions {
  flex: 0 0 auto;
  opacity: 0;
}

.git-branch-row:hover .git-branch-row-actions,
.git-branch-row:focus-within .git-branch-row-actions {
  opacity: 1;
}

.git-branch-icon-button {
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

.git-branch-icon-button:hover:not(:disabled),
.git-branch-icon-button:focus-visible {
  color: var(--fg-bright);
  background: var(--bg-hover);
  outline: 1px solid var(--accent);
  outline-offset: -1px;
}

.git-branch-icon-button.danger:hover:not(:disabled) {
  color: var(--color-red, #dc6262);
}

.git-branch-icon-button:disabled {
  opacity: 0.4;
  cursor: default;
}

.git-branch-rename-input {
  height: 25px;
  padding: 0 5px;
  border: 1px solid var(--accent);
}

.git-branch-message,
.git-branch-empty {
  margin: 0;
  padding: 8px 9px;
  color: var(--fg-muted);
  font-size: 11px;
}

.git-branch-message.error {
  color: var(--color-red, #dc6262);
}

@media (hover: none) {
  .git-branch-row-actions {
    opacity: 1;
  }
}
</style>
