<template>
  <section v-if="visible" class="git-remote-manager" :aria-label="t('gitPanel.manageRemotes')">
    <header class="git-remote-manager-header">
      <Network :size="14" aria-hidden="true" />
      <span>{{ t('gitPanel.manageRemotes') }}</span>
      <button
        type="button"
        class="git-remote-icon-button"
        :title="t('gitPanel.closeRemotes')"
        :aria-label="t('gitPanel.closeRemotes')"
        @click="emit('close')"
      >
        <X :size="14" />
      </button>
    </header>

    <div class="git-remote-current">
      <label>
        <span>{{ t('gitPanel.currentRemote') }}</span>
        <select
          v-model="activeRemoteName"
          data-testid="git-remote-select"
          :disabled="busy || !remotes.length"
          @change="selectRemote"
        >
          <option v-if="!remotes.length" value="">{{ t('gitPanel.noRemote') }}</option>
          <option v-for="remote in remotes" :key="remote.name" :value="remote.name">
            {{ remote.name }}
          </option>
        </select>
      </label>
    </div>

    <form class="git-remote-add" @submit.prevent="addRemote">
      <input
        v-model="newRemoteName"
        data-testid="git-remote-add-name"
        type="text"
        autocomplete="off"
        spellcheck="false"
        :placeholder="t('gitPanel.remoteName')"
      />
      <input
        v-model="newRemoteUrl"
        data-testid="git-remote-add-url"
        type="text"
        autocomplete="off"
        spellcheck="false"
        :placeholder="t('gitPanel.remoteUrl')"
      />
      <button
        type="button"
        data-testid="git-remote-add-button"
        class="git-remote-icon-button"
        :title="t('gitPanel.addRemote')"
        :aria-label="t('gitPanel.addRemote')"
        :disabled="busy || !newRemoteName.trim() || !newRemoteUrl.trim()"
        @click="addRemote"
      >
        <Plus :size="14" />
      </button>
    </form>

    <p v-if="errorMessage" class="git-remote-message error" role="alert">
      {{ errorMessage }}
    </p>
    <p v-else-if="statusMessage" class="git-remote-message success" role="status">
      {{ statusMessage }}
    </p>

    <div class="git-remote-list">
      <div
        v-for="remote in remotes"
        :key="remote.name"
        class="git-remote-row"
        :data-remote="remote.name"
      >
        <template v-if="editingRemoteName === remote.name">
          <div class="git-remote-edit-fields">
            <input
              v-model="editRemoteName"
              data-testid="git-remote-edit-name"
              type="text"
              autocomplete="off"
              spellcheck="false"
              :aria-label="t('gitPanel.remoteName')"
            />
            <input
              v-model="editFetchUrl"
              data-testid="git-remote-edit-fetch-url"
              type="text"
              autocomplete="off"
              spellcheck="false"
              :aria-label="t('gitPanel.fetchUrl')"
            />
            <input
              v-model="editPushUrl"
              data-testid="git-remote-edit-push-url"
              type="text"
              autocomplete="off"
              spellcheck="false"
              :aria-label="t('gitPanel.pushUrl')"
            />
          </div>
          <span class="git-remote-row-actions">
            <button
              type="button"
              data-testid="git-remote-edit-confirm"
              class="git-remote-icon-button"
              :title="t('gitPanel.confirmRemoteEdit')"
              :aria-label="t('gitPanel.confirmRemoteEdit')"
              :disabled="busy || !canSaveRemote"
              @click="saveRemote"
            >
              <Check :size="13" />
            </button>
            <button
              type="button"
              class="git-remote-icon-button"
              :title="t('filePreview.cancel')"
              :aria-label="t('filePreview.cancel')"
              :disabled="busy"
              @click="cancelRemoteEdit"
            >
              <X :size="13" />
            </button>
          </span>
        </template>
        <template v-else>
          <span class="git-remote-copy">
            <strong>{{ remote.name }}</strong>
            <span :title="remote.fetchUrl">{{ remote.fetchUrl }}</span>
            <span v-if="remote.pushUrl !== remote.fetchUrl" :title="remote.pushUrl">
              {{ remote.pushUrl }}
            </span>
          </span>
          <span class="git-remote-row-actions">
            <button
              type="button"
              data-testid="git-remote-edit-button"
              class="git-remote-icon-button"
              :title="t('gitPanel.editRemote')"
              :aria-label="t('gitPanel.editRemote')"
              :disabled="busy"
              @click="startRemoteEdit(remote)"
            >
              <Pencil :size="12" />
            </button>
            <button
              type="button"
              data-testid="git-remote-delete-button"
              class="git-remote-icon-button danger"
              :title="t('gitPanel.deleteRemote')"
              :aria-label="t('gitPanel.deleteRemote')"
              :disabled="busy"
              @click="remotePendingDelete = remote.name"
            >
              <Trash2 :size="12" />
            </button>
          </span>
        </template>
      </div>
      <p v-if="!remotes.length" class="git-remote-empty">{{ t('gitPanel.noRemote') }}</p>
    </div>

    <section v-if="branch" class="git-upstream-section">
      <h3>{{ t('gitPanel.manageUpstream') }}</h3>
      <p v-if="upstream" class="git-upstream-current">{{ upstream }}</p>
      <div class="git-upstream-controls">
        <input
          v-model="remoteBranch"
          data-testid="git-upstream-remote-branch"
          type="text"
          autocomplete="off"
          spellcheck="false"
          :placeholder="t('gitPanel.remoteBranch')"
        />
        <button
          type="button"
          data-testid="git-upstream-set-button"
          class="git-remote-action-button"
          :disabled="busy || !activeRemoteName || !remoteBranch.trim()"
          @click="setUpstream"
        >
          <Link :size="13" />
          <span>{{ t('gitPanel.setUpstream') }}</span>
        </button>
        <button
          v-if="upstream"
          type="button"
          data-testid="git-upstream-unset-button"
          class="git-remote-action-button danger"
          :disabled="busy"
          @click="unsetUpstream"
        >
          <Link2Off :size="13" />
          <span>{{ t('gitPanel.unsetUpstream') }}</span>
        </button>
      </div>
    </section>

    <ConfirmModal
      :visible="!!remotePendingDelete"
      :title="t('gitPanel.deleteRemote')"
      :message="t('gitPanel.deleteRemoteMessage').replace('{remote}', remotePendingDelete || '')"
      :confirm-text="t('gitPanel.deleteRemote')"
      :cancel-text="t('filePreview.cancel')"
      @confirm="deleteRemote"
      @cancel="remotePendingDelete = null"
    />
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Check, Link, Link2Off, Network, Pencil, Plus, Trash2, X } from 'lucide-vue-next'
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
  result: [result: { ok: boolean; message: string }]
  'select-remote': [name: string]
}>()

const { t } = useI18n()
const activeRemoteName = ref('')
const newRemoteName = ref('')
const newRemoteUrl = ref('')
const editingRemoteName = ref<string | null>(null)
const editRemoteName = ref('')
const editFetchUrl = ref('')
const editPushUrl = ref('')
const remoteBranch = ref('')
const remotePendingDelete = ref<string | null>(null)
const busy = ref(false)
const errorMessage = ref('')
const statusMessage = ref('')

const canSaveRemote = computed(function computeCanSaveRemote() {
  // 步骤1：Remote 修改要求名称、Fetch 地址和 Push 地址全部存在。
  return !!editRemoteName.value.trim() && !!editFetchUrl.value.trim() && !!editPushUrl.value.trim()
})

function selectRemote(): void {
  // 步骤1：把本地选择同步给主 Git 面板，后续远程操作使用同一 Remote。
  emit('select-remote', activeRemoteName.value)
}

async function postRemoteAction(endpoint: string, body: Record<string, string>): Promise<boolean> {
  // 步骤1：向当前仓库发送固定 Remote 或 Upstream 操作。
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
    const result = await response.json().catch(function emptyRemoteActionResult() {
      return {}
    })
    if (!response.ok) {
      errorMessage.value = result.error || t('gitPanel.remoteOperationFailed')
      emit('result', { ok: false, message: errorMessage.value })
      return false
    }

    // 步骤2：成功后通知主面板重新读取 Remote、Upstream 和同步状态。
    statusMessage.value = result.output || t('gitPanel.remoteOperationSucceeded')
    emit('result', { ok: true, message: statusMessage.value })
    emit('refresh')
    return true
  } catch {
    errorMessage.value = t('gitPanel.remoteOperationFailed')
    emit('result', { ok: false, message: errorMessage.value })
    return false
  } finally {
    busy.value = false
  }
}

async function addRemote(): Promise<void> {
  // 步骤1：添加 Remote，并在成功后选中它和清空输入框。
  const name = newRemoteName.value.trim()
  const url = newRemoteUrl.value.trim()
  if (!name || !url) return
  const succeeded = await postRemoteAction('git-remote-add', { name, url })
  if (succeeded) {
    activeRemoteName.value = name
    emit('select-remote', name)
    newRemoteName.value = ''
    newRemoteUrl.value = ''
  }
}

function startRemoteEdit(remote: GitRemoteEntry): void {
  // 步骤1：把当前 Remote 的三个可编辑字段复制到行内表单。
  editingRemoteName.value = remote.name
  editRemoteName.value = remote.name
  editFetchUrl.value = remote.fetchUrl
  editPushUrl.value = remote.pushUrl || remote.fetchUrl
}

function cancelRemoteEdit(): void {
  // 步骤1：退出编辑并清空临时字段。
  editingRemoteName.value = null
  editRemoteName.value = ''
  editFetchUrl.value = ''
  editPushUrl.value = ''
}

async function saveRemote(): Promise<void> {
  // 步骤1：保存名称和两个地址，并在重命名成功后同步当前选择。
  const originalName = editingRemoteName.value
  const newName = editRemoteName.value.trim()
  const fetchUrl = editFetchUrl.value.trim()
  const pushUrl = editPushUrl.value.trim()
  if (!originalName || !newName || !fetchUrl || !pushUrl) return
  const succeeded = await postRemoteAction('git-remote-update', {
    name: originalName,
    new_name: newName,
    fetch_url: fetchUrl,
    push_url: pushUrl,
  })
  if (succeeded) {
    if (activeRemoteName.value === originalName) {
      activeRemoteName.value = newName
      emit('select-remote', newName)
    }
    cancelRemoteEdit()
  }
}

async function deleteRemote(): Promise<void> {
  // 步骤1：读取并清除待删除名称，再执行删除操作。
  const name = remotePendingDelete.value
  remotePendingDelete.value = null
  if (!name) return
  const succeeded = await postRemoteAction('git-remote-delete', { name })
  if (succeeded && activeRemoteName.value === name) {
    activeRemoteName.value = ''
    emit('select-remote', '')
  }
}

async function setUpstream(): Promise<void> {
  // 步骤1：把当前本地分支绑定到所选 Remote 的目标分支。
  if (!props.branch) return
  const remote = activeRemoteName.value
  const targetBranch = remoteBranch.value.trim()
  if (!remote || !targetBranch) return
  await postRemoteAction('git-upstream-set', {
    remote,
    branch: props.branch,
    remote_branch: targetBranch,
  })
}

async function unsetUpstream(): Promise<void> {
  // 步骤1：取消当前本地分支的 Upstream。
  if (!props.branch) return
  await postRemoteAction('git-upstream-unset', { branch: props.branch })
}

watch(
  function watchRemoteSelection() {
    return [props.selectedRemoteName, props.remotes, props.upstream, props.branch]
  },
  function synchronizeRemoteSelection() {
    // 步骤1：保留仍存在的显式选择，否则回退到 Upstream、origin 或首个 Remote。
    let nextRemoteName = props.selectedRemoteName
    let selectedRemoteExists = false
    for (const remote of props.remotes) {
      if (remote.name === nextRemoteName) {
        selectedRemoteExists = true
        break
      }
    }
    if (!selectedRemoteExists) {
      const upstreamRemote = props.upstream?.split('/')[0] || ''
      nextRemoteName = ''
      for (const remote of props.remotes) {
        if (remote.name === upstreamRemote) {
          nextRemoteName = remote.name
          break
        }
      }
      if (!nextRemoteName) {
        for (const remote of props.remotes) {
          if (remote.name === 'origin') {
            nextRemoteName = remote.name
            break
          }
        }
      }
      if (!nextRemoteName) {
        nextRemoteName = props.remotes[0]?.name || ''
      }
    }
    activeRemoteName.value = nextRemoteName

    // 步骤2：Upstream 存在时提取远程分支，否则默认使用当前本地分支。
    const upstreamParts = props.upstream?.split('/') || []
    if (upstreamParts.length > 1) {
      remoteBranch.value = upstreamParts.slice(1).join('/')
    } else {
      remoteBranch.value = props.branch || ''
    }
  },
  { immediate: true }
)
</script>

<style scoped>
.git-remote-manager {
  border-bottom: 1px solid var(--border);
  background: var(--bg);
}

.git-remote-manager-header {
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

.git-remote-manager-header span {
  flex: 1;
}

.git-remote-icon-button {
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

.git-remote-icon-button:hover:not(:disabled) {
  color: var(--fg-bright);
  background: var(--bg-hover);
}

.git-remote-icon-button.danger:hover:not(:disabled),
.git-remote-action-button.danger:hover:not(:disabled) {
  color: var(--error, #e06c75);
}

.git-remote-icon-button:disabled,
.git-remote-action-button:disabled {
  opacity: 0.5;
  cursor: default;
}

.git-remote-current,
.git-upstream-section {
  padding: 8px;
}

.git-remote-current label {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: center;
  gap: 8px;
  color: var(--fg-muted);
  font-size: 9px;
}

.git-remote-current select,
.git-remote-add input,
.git-remote-edit-fields input,
.git-upstream-controls input {
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

.git-remote-add {
  display: grid;
  grid-template-columns: minmax(58px, 0.35fr) minmax(0, 1fr) 26px;
  gap: 5px;
  padding: 0 8px 8px;
}

.git-remote-message {
  margin: 0;
  padding: 5px 8px;
  border-top: 1px solid var(--border);
  font-size: 9px;
  white-space: pre-wrap;
}

.git-remote-message.error {
  color: var(--error, #e06c75);
}

.git-remote-message.success {
  color: var(--color-green, #78b159);
}

.git-remote-list {
  border-top: 1px solid var(--border);
}

.git-remote-row {
  display: flex;
  align-items: center;
  gap: 5px;
  min-height: 37px;
  padding: 5px 7px;
  border-bottom: 1px solid var(--border);
}

.git-remote-copy {
  display: flex;
  flex: 1;
  min-width: 0;
  flex-direction: column;
  gap: 2px;
}

.git-remote-copy strong {
  color: var(--fg-bright);
  font-size: 10px;
}

.git-remote-copy span {
  overflow: hidden;
  color: var(--fg-muted);
  font-family: var(--font-mono);
  font-size: 8px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.git-remote-row-actions {
  display: inline-flex;
  flex: 0 0 auto;
}

.git-remote-edit-fields {
  display: grid;
  flex: 1;
  min-width: 0;
  gap: 4px;
}

.git-remote-empty {
  margin: 0;
  padding: 9px 8px;
  color: var(--fg-muted);
  font-size: 9px;
}

.git-upstream-section h3 {
  margin: 0 0 6px;
  color: var(--fg-muted);
  font-size: 9px;
  font-weight: 600;
  text-transform: uppercase;
}

.git-upstream-current {
  margin: 0 0 6px;
  overflow: hidden;
  color: var(--fg-bright);
  font-family: var(--font-mono);
  font-size: 9px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.git-upstream-controls {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 5px;
}

.git-remote-action-button {
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

.git-remote-action-button:hover:not(:disabled) {
  background: var(--bg-hover);
}

.git-upstream-controls .danger {
  grid-column: 1 / -1;
}
</style>
