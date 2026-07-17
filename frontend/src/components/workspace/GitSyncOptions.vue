<template>
  <section v-if="visible" class="git-sync-options" :aria-label="t('gitPanel.syncOptions')">
    <header class="git-sync-header">
      <SlidersHorizontal :size="14" aria-hidden="true" />
      <span>{{ t('gitPanel.syncOptions') }}</span>
      <button
        type="button"
        class="git-sync-icon-button"
        :title="t('gitPanel.closeSyncOptions')"
        :aria-label="t('gitPanel.closeSyncOptions')"
        @click="emit('close')"
      >
        <X :size="14" />
      </button>
    </header>

    <label class="git-sync-remote">
      <span>{{ t('gitPanel.currentRemote') }}</span>
      <select v-model="activeRemoteName" :disabled="busy || !remotes.length" @change="selectRemote">
        <option v-if="!remotes.length" value="">{{ t('gitPanel.noRemote') }}</option>
        <option v-for="remote in remotes" :key="remote.name" :value="remote.name">
          {{ remote.name }}
        </option>
      </select>
    </label>

    <p v-if="errorMessage" class="git-sync-message error" role="alert">{{ errorMessage }}</p>
    <p v-else-if="statusMessage" class="git-sync-message success" role="status">
      {{ statusMessage }}
    </p>

    <section class="git-sync-group">
      <h3>{{ t('gitPanel.fetch') }}</h3>
      <label class="git-sync-check">
        <input v-model="fetchAllRemotes" data-testid="git-fetch-all-remotes" type="checkbox" />
        <span>{{ t('gitPanel.fetchAllRemotes') }}</span>
      </label>
      <button
        type="button"
        data-testid="git-sync-fetch-button"
        class="git-sync-action-button"
        :disabled="busy || (!fetchAllRemotes && !activeRemoteName)"
        @click="fetchRemote"
      >
        <CloudDownload :size="13" />
        <span>{{ t('gitPanel.fetch') }}</span>
      </button>
    </section>

    <section class="git-sync-group">
      <h3>{{ t('gitPanel.pull') }}</h3>
      <select v-model="pullStrategy" data-testid="git-pull-strategy" :disabled="busy">
        <option value="ff-only">{{ t('gitPanel.pullFastForward') }}</option>
        <option value="rebase">{{ t('gitPanel.pullRebase') }}</option>
        <option value="merge">{{ t('gitPanel.pullMerge') }}</option>
      </select>
      <input
        v-model="pullRemoteBranch"
        data-testid="git-pull-remote-branch"
        type="text"
        autocomplete="off"
        spellcheck="false"
        :placeholder="t('gitPanel.remoteBranch')"
      />
      <button
        type="button"
        data-testid="git-sync-pull-button"
        class="git-sync-action-button"
        :disabled="busy || !activeRemoteName || !pullRemoteBranch.trim()"
        @click="pullRemote"
      >
        <ArrowDownToLine :size="13" />
        <span>{{ t('gitPanel.pull') }}</span>
      </button>
    </section>

    <section class="git-sync-group">
      <h3>{{ t('gitPanel.push') }}</h3>
      <input
        v-model="pushRemoteBranch"
        data-testid="git-push-remote-branch"
        type="text"
        autocomplete="off"
        spellcheck="false"
        :placeholder="t('gitPanel.remoteBranch')"
      />
      <div class="git-sync-checks">
        <label class="git-sync-check">
          <input v-model="pushTags" data-testid="git-push-tags" type="checkbox" />
          <span>{{ t('gitPanel.pushTags') }}</span>
        </label>
        <label class="git-sync-check">
          <input v-model="forceWithLease" data-testid="git-force-with-lease" type="checkbox" />
          <span>{{ t('gitPanel.forceWithLease') }}</span>
        </label>
      </div>
      <div class="git-sync-button-row">
        <button
          type="button"
          data-testid="git-sync-push-button"
          class="git-sync-action-button"
          :disabled="busy || !activeRemoteName || !branch || !pushRemoteBranch.trim()"
          @click="pushRemote"
        >
          <ArrowUpFromLine :size="13" />
          <span>{{ t('gitPanel.push') }}</span>
        </button>
        <button
          type="button"
          data-testid="git-remote-branch-delete-button"
          class="git-sync-action-button danger"
          :disabled="busy || !activeRemoteName || !pushRemoteBranch.trim()"
          @click="deletePending = true"
        >
          <Trash2 :size="13" />
          <span>{{ t('gitPanel.deleteRemoteBranch') }}</span>
        </button>
      </div>
    </section>

    <ConfirmModal
      :visible="deletePending"
      :title="t('gitPanel.deleteRemoteBranch')"
      :message="deleteMessage"
      :confirm-text="t('gitPanel.deleteRemoteBranch')"
      :cancel-text="t('filePreview.cancel')"
      @confirm="deleteRemoteBranch"
      @cancel="deletePending = false"
    />
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  CloudDownload,
  SlidersHorizontal,
  Trash2,
  X,
} from 'lucide-vue-next'
import { apiUrl, authFetch, getApiBase } from '../../composables/apiBase'
import { useI18n } from '../../composables/useI18n'
import { appendGitRepository, type GitRemoteEntry } from '../../utils/gitPanel'
import ConfirmModal from '../ui/ConfirmModal.vue'

const props = defineProps<{
  visible: boolean
  paneId: string
  repository?: string
  remotes: GitRemoteEntry[]
  branch: string | null
  upstream: string | null
  selectedRemoteName: string
}>()

const emit = defineEmits<{
  close: []
  refresh: []
  'select-remote': [name: string]
}>()

const { t } = useI18n()
const activeRemoteName = ref('')
const fetchAllRemotes = ref(false)
const pullStrategy = ref<'ff-only' | 'rebase' | 'merge'>('ff-only')
const pullRemoteBranch = ref('')
const pushRemoteBranch = ref('')
const pushTags = ref(false)
const forceWithLease = ref(false)
const deletePending = ref(false)
const busy = ref(false)
const errorMessage = ref('')
const statusMessage = ref('')

const deleteMessage = computed(function computeDeleteMessage() {
  // 步骤1：在确认信息中明确 Remote 和分支，降低误删风险。
  const target = `${activeRemoteName.value}/${pushRemoteBranch.value.trim()}`
  return t('gitPanel.deleteRemoteBranchMessage').replace('{branch}', target)
})

function selectRemote(): void {
  // 步骤1：同步当前 Remote，并让新 Remote 默认使用本地分支同名目标。
  emit('select-remote', activeRemoteName.value)
  pullRemoteBranch.value = props.branch || ''
  pushRemoteBranch.value = props.branch || ''
}

async function postSyncAction(endpoint: string, body: Record<string, unknown>): Promise<boolean> {
  // 步骤1：向当前仓库发送结构化同步选项。
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
    const result = await response.json().catch(function emptySyncActionResult() {
      return {}
    })
    if (!response.ok) {
      errorMessage.value = result.error || t('gitPanel.syncOperationFailed')
      return false
    }

    // 步骤2：成功后显示 Git 输出并刷新同步计数、分支和标签。
    statusMessage.value = result.output || t('gitPanel.syncOperationSucceeded')
    emit('refresh')
    return true
  } catch {
    errorMessage.value = t('gitPanel.syncOperationFailed')
    return false
  } finally {
    busy.value = false
  }
}

async function fetchRemote(): Promise<void> {
  // 步骤1：按复选框获取一个或全部 Remote，并始终清理失效引用。
  await postSyncAction('git-fetch', {
    remote: activeRemoteName.value,
    all: fetchAllRemotes.value,
  })
}

async function pullRemote(): Promise<void> {
  // 步骤1：从当前 Remote 的目标分支按选定策略拉取。
  const branch = pullRemoteBranch.value.trim()
  if (!activeRemoteName.value || !branch) return
  await postSyncAction('git-pull', {
    remote: activeRemoteName.value,
    branch,
    strategy: pullStrategy.value,
  })
}

async function pushRemote(): Promise<void> {
  // 步骤1：把当前本地分支推送到目标分支，并附带标签与安全强推选项。
  const remoteBranch = pushRemoteBranch.value.trim()
  if (!activeRemoteName.value || !props.branch || !remoteBranch) return
  await postSyncAction('git-push', {
    remote: activeRemoteName.value,
    branch: props.branch,
    remote_branch: remoteBranch,
    push_tags: pushTags.value,
    force_with_lease: forceWithLease.value,
  })
}

async function deleteRemoteBranch(): Promise<void> {
  // 步骤1：清除确认状态，再删除当前 Remote 的目标分支。
  deletePending.value = false
  const branch = pushRemoteBranch.value.trim()
  if (!activeRemoteName.value || !branch) return
  await postSyncAction('git-remote-branch-delete', {
    remote: activeRemoteName.value,
    branch,
  })
}

watch(
  function watchSyncRepository() {
    return [props.selectedRemoteName, props.remotes, props.upstream, props.branch]
  },
  function synchronizeSyncDefaults() {
    // 步骤1：保留有效选择，否则回退到 Upstream、origin 或首个 Remote。
    let nextRemote = props.selectedRemoteName
    let selectionExists = false
    for (const remote of props.remotes) {
      if (remote.name === nextRemote) {
        selectionExists = true
        break
      }
    }
    if (!selectionExists) {
      const upstreamRemote = props.upstream?.split('/')[0] || ''
      nextRemote = ''
      for (const remote of props.remotes) {
        if (remote.name === upstreamRemote) {
          nextRemote = remote.name
          break
        }
      }
      if (!nextRemote) {
        for (const remote of props.remotes) {
          if (remote.name === 'origin') {
            nextRemote = remote.name
            break
          }
        }
      }
      if (!nextRemote) {
        nextRemote = props.remotes[0]?.name || ''
      }
    }
    activeRemoteName.value = nextRemote

    // 步骤2：同一 Remote 的 Upstream 优先成为默认目标，否则使用本地分支同名目标。
    const upstreamParts = props.upstream?.split('/') || []
    let targetBranch = props.branch || ''
    if (upstreamParts.length > 1 && upstreamParts[0] === nextRemote) {
      targetBranch = upstreamParts.slice(1).join('/')
    }
    pullRemoteBranch.value = targetBranch
    pushRemoteBranch.value = targetBranch
  },
  { immediate: true }
)
</script>

<style scoped>
.git-sync-options {
  border-bottom: 1px solid var(--border);
  background: var(--bg);
}

.git-sync-header {
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 32px;
  padding: 0 7px;
  border-bottom: 1px solid var(--border);
  color: var(--fg-bright);
  background: var(--tab-bg);
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
}

.git-sync-header span {
  flex: 1;
}

.git-sync-icon-button {
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

.git-sync-icon-button:hover {
  color: var(--fg-bright);
  background: var(--bg-hover);
}

.git-sync-remote {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: center;
  gap: 8px;
  padding: 8px;
  color: var(--fg-muted);
  font-size: 9px;
}

.git-sync-remote select,
.git-sync-group select,
.git-sync-group input[type='text'] {
  min-width: 0;
  min-height: 27px;
  box-sizing: border-box;
  border: 1px solid var(--border);
  border-radius: 3px;
  padding: 0 6px;
  color: var(--fg);
  background: var(--bg);
  font-family: var(--font-mono);
  font-size: 9px;
}

.git-sync-message {
  margin: 0;
  padding: 5px 8px;
  border-top: 1px solid var(--border);
  font-size: 9px;
  white-space: pre-wrap;
}

.git-sync-message.error {
  color: var(--error, #e06c75);
}

.git-sync-message.success {
  color: var(--color-green, #78b159);
}

.git-sync-group {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 6px;
  padding: 8px;
  border-top: 1px solid var(--border);
}

.git-sync-group h3 {
  grid-column: 1 / -1;
  margin: 0;
  color: var(--fg-muted);
  font-size: 9px;
  font-weight: 600;
  text-transform: uppercase;
}

.git-sync-checks {
  display: flex;
  grid-column: 1 / -1;
  flex-wrap: wrap;
  gap: 10px;
}

.git-sync-check {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--fg-muted);
  font-size: 9px;
}

.git-sync-check input {
  width: 13px;
  height: 13px;
  margin: 0;
}

.git-sync-action-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  min-height: 27px;
  border: 1px solid var(--border);
  border-radius: 3px;
  padding: 0 7px;
  color: var(--fg);
  background: var(--tab-bg);
  font-size: 9px;
  cursor: pointer;
}

.git-sync-action-button:hover:not(:disabled) {
  background: var(--bg-hover);
}

.git-sync-action-button.danger:hover:not(:disabled) {
  color: var(--error, #e06c75);
}

.git-sync-action-button:disabled {
  opacity: 0.5;
  cursor: default;
}

.git-sync-button-row {
  display: grid;
  grid-column: 1 / -1;
  grid-template-columns: 1fr 1fr;
  gap: 5px;
}
</style>
