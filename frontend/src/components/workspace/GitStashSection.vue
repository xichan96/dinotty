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
        <button
          type="button"
          data-testid="git-stash-save"
          class="git-stash-icon-button"
          :title="t('gitPanel.stashSave')"
          :aria-label="t('gitPanel.stashSave')"
          :disabled="busy"
          @click="saveStash"
        >
          <ArchiveRestore :size="13" />
        </button>
        <label class="git-stash-untracked">
          <input v-model="includeUntracked" data-testid="git-stash-untracked" type="checkbox" />
          <span>{{ t('gitPanel.stashIncludeUntracked') }}</span>
        </label>
      </form>

      <p v-if="errorMessage" class="git-stash-message error" role="alert">
        {{ errorMessage }}
      </p>
      <div v-if="loading" class="git-stash-state">{{ t('gitPanel.loadingStashes') }}</div>
      <div v-else-if="!stashes.length" class="git-stash-state">{{ t('gitPanel.noStashes') }}</div>
      <div v-else class="git-stash-list">
        <div
          v-for="stash in stashes"
          :key="stash.reference"
          data-testid="git-stash-row"
          class="git-stash-row"
        >
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
import { onMounted, ref } from 'vue'
import {
  Archive,
  ArchiveRestore,
  ChevronDown,
  Download,
  PackageOpen,
  Trash2,
} from 'lucide-vue-next'
import { apiUrl, authFetch, getApiBase } from '../../composables/apiBase'
import { useI18n } from '../../composables/useI18n'
import ConfirmModal from '../ui/ConfirmModal.vue'

interface GitStashEntry {
  reference: string
  hash: string
  createdAt: string
  message: string
}

const props = defineProps<{
  paneId: string
}>()

const emit = defineEmits<{
  refresh: []
}>()

const { t } = useI18n()
const expanded = ref(true)
const loading = ref(false)
const busy = ref(false)
const message = ref('')
const includeUntracked = ref(false)
const errorMessage = ref('')
const stashes = ref<GitStashEntry[]>([])
const stashPendingDrop = ref<string | null>(null)

async function loadStashes(): Promise<void> {
  // 步骤1：读取当前仓库的 stash 列表并转换接口字段。
  loading.value = true
  errorMessage.value = ''
  try {
    await getApiBase()
    const query = new URLSearchParams({ pane_id: props.paneId })
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
  // 步骤1：向当前仓库发送单一 stash 操作并显示真实错误。
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
    const result = await response.json().catch(function emptyStashActionResult() {
      return {}
    })
    if (!response.ok) {
      errorMessage.value = result.error || t('gitPanel.stashOperationFailed')
      return false
    }

    // 步骤2：成功后刷新 stash 列表和工作区 Git 状态。
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
  // 步骤1：保存当前更改，并按复选框决定是否包含未跟踪文件。
  const saved = await postStashAction('git-stash-save', {
    message: message.value.trim(),
    include_untracked: includeUntracked.value,
  })
  if (saved) {
    message.value = ''
  }
}

async function runStashAction(endpoint: string, reference: string): Promise<void> {
  // 步骤1：对用户点击的明确 stash 引用执行应用或弹出操作。
  await postStashAction(endpoint, { reference })
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

onMounted(function loadInitialStashes() {
  // 步骤1：组件显示后立即读取 stash 列表。
  void loadStashes()
})
</script>

<style scoped>
.git-stash-section {
  border-bottom: 1px solid var(--border);
}

.git-stash-heading {
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

.git-stash-heading span:nth-of-type(1) {
  flex: 1;
}

.git-stash-count {
  color: var(--fg-muted);
  font-family: var(--font-mono);
}

.git-stash-save {
  display: grid;
  grid-template-columns: 1fr 26px;
  gap: 5px;
  padding: 7px;
  border-top: 1px solid var(--border);
}

.git-stash-save > input[type='text'] {
  min-width: 0;
  height: 27px;
  box-sizing: border-box;
  border: 1px solid var(--border);
  border-radius: 3px;
  padding: 0 7px;
  color: var(--fg);
  background: var(--bg);
  font-size: 10px;
}

.git-stash-save > input[type='text']:focus {
  border-color: var(--accent);
  outline: none;
}

.git-stash-untracked {
  grid-column: 1 / -1;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: var(--fg-muted);
  font-size: 9px;
}

.git-stash-untracked input {
  margin: 0;
}

.git-stash-state,
.git-stash-message {
  margin: 0;
  padding: 8px;
  color: var(--fg-muted);
  font-size: 10px;
  text-align: center;
}

.git-stash-message.error {
  color: var(--color-red, #e06c75);
}

.git-stash-row {
  min-height: 42px;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 4px 4px 9px;
  border-top: 1px solid color-mix(in srgb, var(--border) 65%, transparent);
}

.git-stash-row:hover {
  background: var(--bg-hover);
}

.git-stash-copy {
  min-width: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.git-stash-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--fg-bright);
  font-size: 10px;
}

.git-stash-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--fg-muted);
  font-size: 8px;
}

.git-stash-meta code {
  color: var(--color-blue, #69a7d8);
  font-family: var(--font-mono);
}

.git-stash-actions {
  display: inline-flex;
  flex: 0 0 auto;
}

.git-stash-icon-button {
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

.git-stash-icon-button:hover:not(:disabled),
.git-stash-icon-button:focus-visible {
  color: var(--fg-bright);
  background: var(--bg-hover);
  outline: 1px solid var(--accent);
  outline-offset: -1px;
}

.git-stash-icon-button.danger:hover:not(:disabled) {
  color: var(--color-red, #e06c75);
}

.git-stash-icon-button:disabled {
  opacity: 0.4;
  cursor: default;
}

@media (prefers-reduced-motion: reduce) {
  .git-stash-heading svg:first-child {
    transition: none;
  }
}
</style>
