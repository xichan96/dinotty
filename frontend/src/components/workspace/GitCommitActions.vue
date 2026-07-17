<template>
  <div class="git-commit-actions">
    <button
      type="button"
      data-testid="git-commit-actions-button"
      class="git-commit-actions-button"
      :title="t('gitPanel.commitActions')"
      :aria-label="t('gitPanel.commitActions')"
      :aria-expanded="menuOpen"
      @click="menuOpen = !menuOpen"
    >
      <MoreHorizontal :size="14" />
    </button>

    <button
      v-if="menuOpen"
      type="button"
      class="git-commit-actions-backdrop"
      :aria-label="t('gitPanel.closeCommitActions')"
      @click="closeMenu"
    ></button>
    <div v-if="menuOpen" class="git-commit-actions-menu">
      <template v-if="creationMode">
        <div class="git-commit-create-heading">
          {{
            creationMode === 'branch'
              ? t('gitPanel.createBranchFromCommit')
              : t('gitPanel.createTagFromCommit')
          }}
        </div>
        <input
          v-model="nameInput"
          data-testid="git-history-name-input"
          type="text"
          :placeholder="
            creationMode === 'branch' ? t('gitPanel.newBranchName') : t('gitPanel.tagName')
          "
          @keydown.enter.prevent="createReference"
          @keydown.esc.prevent="creationMode = null"
        />
        <div class="git-commit-create-actions">
          <button
            type="button"
            :title="t('filePreview.cancel')"
            :aria-label="t('filePreview.cancel')"
            @click="creationMode = null"
          >
            <X :size="13" />
          </button>
          <button
            type="button"
            data-testid="git-history-create-confirm"
            :title="t('gitPanel.confirmCreate')"
            :aria-label="t('gitPanel.confirmCreate')"
            :disabled="busy || !nameInput.trim()"
            @click="createReference"
          >
            <Check :size="13" />
          </button>
        </div>
      </template>
      <template v-else>
        <button type="button" data-testid="git-history-checkout" @click="requestAction('checkout')">
          <GitCommitHorizontal :size="13" />
          <span>{{ t('gitPanel.checkoutCommit') }}</span>
        </button>
        <button
          type="button"
          data-testid="git-history-create-branch"
          @click="openCreation('branch')"
        >
          <GitBranchPlus :size="13" />
          <span>{{ t('gitPanel.createBranchFromCommit') }}</span>
        </button>
        <button type="button" @click="openCreation('tag')">
          <Tag :size="13" />
          <span>{{ t('gitPanel.createTagFromCommit') }}</span>
        </button>
        <span class="git-commit-actions-separator"></span>
        <button
          type="button"
          data-testid="git-history-cherry-pick"
          @click="requestAction('cherry-pick')"
        >
          <Cherry :size="13" />
          <span>{{ t('gitPanel.cherryPick') }}</span>
        </button>
        <button type="button" data-testid="git-history-revert" @click="requestAction('revert')">
          <RotateCcw :size="13" />
          <span>{{ t('gitPanel.revertCommit') }}</span>
        </button>
        <span class="git-commit-actions-separator"></span>
        <div class="git-commit-reset-label">{{ t('gitPanel.reset') }}</div>
        <div class="git-commit-reset-options">
          <button type="button" @click="requestAction('reset-soft')">soft</button>
          <button type="button" @click="requestAction('reset-mixed')">mixed</button>
          <button type="button" class="danger" @click="requestAction('reset-hard')">hard</button>
        </div>
      </template>
    </div>

    <ConfirmModal
      :visible="!!pendingAction"
      :title="confirmationTitle"
      :message="confirmationMessage"
      :confirm-text="confirmationConfirmText"
      :cancel-text="t('filePreview.cancel')"
      @confirm="confirmAction"
      @cancel="pendingAction = null"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  Check,
  Cherry,
  GitBranchPlus,
  GitCommitHorizontal,
  MoreHorizontal,
  RotateCcw,
  Tag,
  X,
} from 'lucide-vue-next'
import { apiUrl, authFetch, getApiBase } from '../../composables/apiBase'
import { useI18n } from '../../composables/useI18n'
import type { GitCommitEntry } from '../../utils/gitHistory'
import { appendGitRepository } from '../../utils/gitPanel'
import ConfirmModal from '../ui/ConfirmModal.vue'

type CommitAction =
  | 'checkout'
  | 'cherry-pick'
  | 'revert'
  | 'reset-soft'
  | 'reset-mixed'
  | 'reset-hard'

const props = defineProps<{
  paneId: string
  repository?: string
  commit: GitCommitEntry
}>()

const emit = defineEmits<{
  refresh: []
  result: [message: string, error: boolean]
}>()

const { t } = useI18n()
const menuOpen = ref(false)
const creationMode = ref<'branch' | 'tag' | null>(null)
const nameInput = ref('')
const pendingAction = ref<CommitAction | null>(null)
const busy = ref(false)

const confirmationTitle = computed(function computeConfirmationTitle() {
  // 步骤1：确认标题使用用户选择的具体 Git 操作名称。
  if (pendingAction.value === 'checkout') return t('gitPanel.checkoutCommit')
  if (pendingAction.value === 'cherry-pick') return t('gitPanel.cherryPick')
  if (pendingAction.value === 'revert') return t('gitPanel.revertCommit')
  return t('gitPanel.reset')
})

const confirmationMessage = computed(function computeConfirmationMessage() {
  // 步骤1：把提交短 hash 和 reset 模式写入确认消息，避免误操作目标不清楚。
  const shortHash = props.commit.shortHash
  if (pendingAction.value === 'checkout') {
    return t('gitPanel.checkoutCommitMessage').replace('{commit}', shortHash)
  }
  if (pendingAction.value === 'cherry-pick') {
    return t('gitPanel.cherryPickMessage').replace('{commit}', shortHash)
  }
  if (pendingAction.value === 'revert') {
    return t('gitPanel.revertCommitMessage').replace('{commit}', shortHash)
  }
  const mode = pendingAction.value?.replace('reset-', '') || 'mixed'
  return t('gitPanel.resetCommitMessage').replace('{commit}', shortHash).replace('{mode}', mode)
})

const confirmationConfirmText = computed(function computeConfirmationConfirmText() {
  // 步骤1：确认按钮复用动作名称，让危险操作保持明确。
  return confirmationTitle.value
})

function closeMenu(): void {
  // 步骤1：关闭菜单时同步清理尚未提交的名称输入。
  menuOpen.value = false
  creationMode.value = null
  nameInput.value = ''
}

function openCreation(mode: 'branch' | 'tag'): void {
  // 步骤1：在同一菜单内切换到分支或标签名称表单。
  creationMode.value = mode
  nameInput.value = ''
}

function requestAction(action: CommitAction): void {
  // 步骤1：关闭弹出菜单并打开对应确认对话框。
  pendingAction.value = action
  menuOpen.value = false
}

async function postAction(endpoint: string, body: Record<string, unknown>): Promise<boolean> {
  // 步骤1：向当前仓库发送固定动作，并把真实错误交给历史面板显示。
  busy.value = true
  try {
    await getApiBase()
    const query = new URLSearchParams({ pane_id: props.paneId })
    appendGitRepository(query, props.repository)
    const response = await authFetch(apiUrl(`/api/workspace/${endpoint}?${query}`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const result = await response.json().catch(function emptyCommitActionResult() {
      return {}
    })
    if (!response.ok) {
      emit('result', result.error || t('gitPanel.commitActionFailed'), true)
      return false
    }
    let resultMessage = result.output || t('gitPanel.commitActionSucceeded')
    if (result.result_code === 'nothing_to_revert') {
      resultMessage = t('gitPanel.nothingToRevert')
    } else if (result.result_code === 'nothing_to_cherry_pick') {
      resultMessage = t('gitPanel.nothingToCherryPick')
    }
    emit('result', resultMessage, false)
    emit('refresh')
    return true
  } catch {
    emit('result', t('gitPanel.commitActionFailed'), true)
    return false
  } finally {
    busy.value = false
  }
}

async function createReference(): Promise<void> {
  // 步骤1：根据表单类型从当前提交创建并切换分支，或创建轻量标签。
  const name = nameInput.value.trim()
  const mode = creationMode.value
  if (!name || !mode || busy.value) return
  let succeeded: boolean
  if (mode === 'branch') {
    succeeded = await postAction('git-branch-create', {
      name,
      start_point: props.commit.hash,
    })
  } else {
    succeeded = await postAction('git-tag-create', {
      name,
      target: props.commit.hash,
      annotated: false,
      message: '',
    })
  }
  if (succeeded) closeMenu()
}

async function confirmAction(): Promise<void> {
  // 步骤1：读取并立即清空待确认动作，避免重复确认触发两次请求。
  const action = pendingAction.value
  pendingAction.value = null
  if (!action || busy.value) return
  if (action === 'checkout') {
    await postAction('git-branch-switch', {
      name: props.commit.hash,
      remote: false,
      detached: true,
    })
    return
  }
  if (action === 'cherry-pick' || action === 'revert') {
    const endpoint = action === 'cherry-pick' ? 'git-cherry-pick' : 'git-revert-commit'
    await postAction(endpoint, { commit: props.commit.hash })
    return
  }

  // 步骤2：Reset 动作从类型中提取白名单模式，hard 模式携带明确确认字段。
  const mode = action.replace('reset-', '')
  await postAction('git-reset', {
    target: props.commit.hash,
    mode,
    confirm_hard: mode === 'hard',
  })
}
</script>

<style scoped>
.git-commit-actions {
  position: relative;
  flex: 0 0 auto;
  padding: 6px 5px 0 0;
}

.git-commit-actions-button {
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

.git-commit-actions-button:hover,
.git-commit-actions-button:focus-visible,
.git-commit-actions-button[aria-expanded='true'] {
  color: var(--fg-bright);
  background: var(--bg-hover);
  outline: 1px solid var(--accent);
  outline-offset: -1px;
}

.git-commit-actions-backdrop {
  position: fixed;
  inset: 0;
  z-index: 120;
  border: 0;
  background: transparent;
}

.git-commit-actions-menu {
  position: absolute;
  z-index: 121;
  top: 31px;
  right: 5px;
  width: 210px;
  padding: 5px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--bg-surface);
  box-shadow: 0 8px 22px rgba(0, 0, 0, 0.32);
}

.git-commit-actions-menu > button {
  width: 100%;
  min-height: 28px;
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 0 7px;
  border: 0;
  border-radius: 3px;
  color: var(--fg);
  background: transparent;
  text-align: left;
  cursor: pointer;
  font-size: 10px;
}

.git-commit-actions-menu > button:hover,
.git-commit-actions-menu > button:focus-visible {
  background: var(--bg-hover);
  outline: none;
}

.git-commit-actions-separator {
  display: block;
  height: 1px;
  margin: 4px 2px;
  background: var(--border);
}

.git-commit-reset-label,
.git-commit-create-heading {
  padding: 4px 6px;
  color: var(--fg-muted);
  font-size: 9px;
  text-transform: uppercase;
}

.git-commit-reset-options {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 3px;
}

.git-commit-reset-options button,
.git-commit-create-actions button {
  min-height: 25px;
  border: 1px solid var(--border);
  border-radius: 3px;
  color: var(--fg);
  background: var(--tab-bg);
  cursor: pointer;
  font-size: 9px;
}

.git-commit-reset-options button:hover,
.git-commit-reset-options button:focus-visible,
.git-commit-create-actions button:hover,
.git-commit-create-actions button:focus-visible {
  border-color: var(--accent);
  background: var(--bg-hover);
  outline: none;
}

.git-commit-reset-options button.danger {
  color: var(--color-red, #e06c75);
}

.git-commit-actions-menu input {
  width: 100%;
  height: 28px;
  padding: 0 7px;
  border: 1px solid var(--border);
  border-radius: 3px;
  color: var(--fg);
  background: var(--bg);
  outline: none;
  font-size: 10px;
}

.git-commit-actions-menu input:focus {
  border-color: var(--accent);
}

.git-commit-create-actions {
  display: flex;
  justify-content: flex-end;
  gap: 4px;
  margin-top: 5px;
}

.git-commit-create-actions button {
  width: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.git-commit-create-actions button:disabled {
  cursor: default;
  opacity: 0.45;
}
</style>
