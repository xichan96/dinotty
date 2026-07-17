<template>
  <div v-if="visible" class="git-rebase-backdrop" @click.self="emit('close')">
    <section
      class="git-rebase-dialog"
      role="dialog"
      aria-modal="true"
      :aria-label="t('gitPanel.rewriteHistory')"
    >
      <header class="git-rebase-header">
        <div>
          <ListRestart :size="16" />
          <h2>{{ t('gitPanel.rewriteHistory') }}</h2>
        </div>
        <button
          type="button"
          :title="t('filePreview.cancel')"
          :aria-label="t('filePreview.cancel')"
          :disabled="busy"
          @click="emit('close')"
        >
          <X :size="15" />
        </button>
      </header>

      <div v-if="loading" class="git-rebase-state">{{ t('gitPanel.loadingHistory') }}</div>
      <div v-else-if="errorMessage" class="git-rebase-state error" role="alert">
        {{ errorMessage }}
      </div>
      <div v-else-if="!candidates.length" class="git-rebase-state">
        {{ t('gitPanel.noRebaseCandidates') }}
      </div>
      <div v-else class="git-rebase-content">
        <section class="git-rebase-candidates" :aria-label="t('gitPanel.rebaseRange')">
          <h3>{{ t('gitPanel.rebaseRange') }}</h3>
          <label v-for="(candidate, index) in candidates" :key="candidate.hash">
            <input
              data-testid="git-rebase-candidate"
              type="checkbox"
              :checked="index < selectedCount"
              :disabled="busy"
              @change="changeSelectionRange(index, $event)"
            />
            <code>{{ candidate.shortHash }}</code>
            <span>{{ candidate.subject }}</span>
          </label>
        </section>

        <section class="git-rebase-plan" :aria-label="t('gitPanel.rebasePlan')">
          <h3>{{ t('gitPanel.rebasePlan') }}</h3>
          <div
            v-for="(entry, index) in planEntries"
            :key="entry.commit"
            data-testid="git-rebase-plan-row"
            class="git-rebase-plan-row"
          >
            <div class="git-rebase-order-actions">
              <button
                type="button"
                data-testid="git-rebase-move-up"
                :title="t('gitPanel.moveCommitUp')"
                :aria-label="t('gitPanel.moveCommitUp')"
                :disabled="busy || index === 0"
                @click="moveEntry(index, -1)"
              >
                <ArrowUp :size="12" />
              </button>
              <button
                type="button"
                data-testid="git-rebase-move-down"
                :title="t('gitPanel.moveCommitDown')"
                :aria-label="t('gitPanel.moveCommitDown')"
                :disabled="busy || index === planEntries.length - 1"
                @click="moveEntry(index, 1)"
              >
                <ArrowDown :size="12" />
              </button>
            </div>
            <div class="git-rebase-commit">
              <code>{{ entry.shortHash }}</code>
              <span>{{ entry.subject }}</span>
            </div>
            <select
              v-model="entry.action"
              data-testid="git-rebase-action"
              :aria-label="t('gitPanel.rebaseAction')"
              :disabled="busy"
            >
              <option value="pick">Pick</option>
              <option value="squash">Squash</option>
              <option value="fixup">Fixup</option>
              <option value="reword">Reword</option>
            </select>
            <input
              v-if="entry.action === 'reword'"
              v-model="entry.message"
              data-testid="git-rebase-message"
              type="text"
              :placeholder="t('gitPanel.rewordMessage')"
              :disabled="busy"
            />
          </div>
        </section>
      </div>

      <footer class="git-rebase-footer">
        <button type="button" :disabled="busy" @click="emit('close')">
          {{ t('filePreview.cancel') }}
        </button>
        <button
          type="button"
          data-testid="git-rebase-run"
          class="danger"
          :disabled="!canRun"
          @click="runPlan"
        >
          <Loader2 v-if="busy" :size="13" class="spin" />
          <ListRestart v-else :size="13" />
          <span>{{ t('gitPanel.runRebasePlan') }}</span>
        </button>
      </footer>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ArrowDown, ArrowUp, ListRestart, Loader2, X } from 'lucide-vue-next'
import { apiUrl, authFetch, getApiBase } from '../../composables/apiBase'
import { useI18n } from '../../composables/useI18n'
import { mapGitCommitEntry, type GitCommitEntry } from '../../utils/gitHistory'
import { appendGitRepository } from '../../utils/gitPanel'

type RebaseAction = 'pick' | 'squash' | 'fixup' | 'reword'

interface RebasePlanEntry {
  commit: string
  shortHash: string
  subject: string
  action: RebaseAction
  message: string
}

const props = defineProps<{
  visible: boolean
  paneId: string
  repository?: string
}>()

const emit = defineEmits<{
  close: []
  completed: [message: string]
}>()

const { t } = useI18n()
const candidates = ref<GitCommitEntry[]>([])
const selectedCount = ref(0)
const planEntries = ref<RebasePlanEntry[]>([])
const upstream = ref('')
const loading = ref(false)
const busy = ref(false)
const errorMessage = ref('')

const canRun = computed(function computeCanRun() {
  // 步骤1：计划必须非空，且第一条不能依赖不存在的前一条提交。
  if (busy.value || !planEntries.value.length || !upstream.value) return false
  const firstAction = planEntries.value[0].action
  if (firstAction === 'squash' || firstAction === 'fixup') return false

  // 步骤2：每条 Reword 都必须提供非空新说明。
  for (const entry of planEntries.value) {
    if (entry.action === 'reword' && !entry.message.trim()) return false
  }
  return true
})

async function loadCandidates(): Promise<void> {
  // 步骤1：读取当前分支最近的连续线性提交。
  loading.value = true
  errorMessage.value = ''
  try {
    await getApiBase()
    const query = new URLSearchParams({ pane_id: props.paneId })
    appendGitRepository(query, props.repository)
    const response = await authFetch(apiUrl(`/api/workspace/git-rebase-candidates?${query}`))
    const result = await response.json().catch(function emptyRebaseCandidatesResult() {
      return {}
    })
    if (!response.ok) {
      errorMessage.value = result.error || t('gitPanel.historyFailed')
      return
    }

    // 步骤2：显式转换候选字段，并默认选择最近三条提交。
    const nextCandidates: GitCommitEntry[] = []
    if (Array.isArray(result.commits)) {
      for (const rawCommit of result.commits) {
        if (!rawCommit || typeof rawCommit !== 'object') continue
        nextCandidates.push(mapGitCommitEntry(rawCommit as Record<string, unknown>))
      }
    }
    candidates.value = nextCandidates
    selectedCount.value = Math.min(3, nextCandidates.length)
    rebuildPlan()
  } catch {
    errorMessage.value = t('gitPanel.historyFailed')
  } finally {
    loading.value = false
  }
}

function changeSelectionRange(index: number, event: Event): void {
  // 步骤1：勾选时把范围扩展到当前提交，取消时从当前提交处缩短范围。
  const input = event.target as HTMLInputElement
  if (input.checked) {
    selectedCount.value = index + 1
  } else {
    selectedCount.value = index
  }
  rebuildPlan()
}

function rebuildPlan(): void {
  // 步骤1：候选按新到旧显示，执行计划反转为旧到新。
  const nextEntries: RebasePlanEntry[] = []
  for (let index = selectedCount.value - 1; index >= 0; index -= 1) {
    const candidate = candidates.value[index]
    nextEntries.push({
      commit: candidate.hash,
      shortHash: candidate.shortHash,
      subject: candidate.subject,
      action: 'pick',
      message: '',
    })
  }
  planEntries.value = nextEntries

  // 步骤2：最旧选中提交的父提交作为 Rebase 上游边界。
  upstream.value = ''
  const oldestCandidate = candidates.value[selectedCount.value - 1]
  if (oldestCandidate && oldestCandidate.parents.length === 1) {
    upstream.value = oldestCandidate.parents[0]
  }
}

function moveEntry(index: number, direction: number): void {
  // 步骤1：交换相邻计划项，让界面顺序与 Git 实际执行顺序完全一致。
  const targetIndex = index + direction
  if (targetIndex < 0 || targetIndex >= planEntries.value.length) return
  const currentEntry = planEntries.value[index]
  planEntries.value[index] = planEntries.value[targetIndex]
  planEntries.value[targetIndex] = currentEntry
}

async function runPlan(): Promise<void> {
  // 步骤1：把界面字段转换为后端白名单计划结构。
  if (!canRun.value) return
  const entries: Array<{ commit: string; action: RebaseAction; message: string }> = []
  for (const planEntry of planEntries.value) {
    entries.push({
      commit: planEntry.commit,
      action: planEntry.action,
      message: planEntry.message.trim(),
    })
  }

  // 步骤2：显式携带历史重写确认，成功后通知历史面板刷新。
  busy.value = true
  errorMessage.value = ''
  try {
    await getApiBase()
    const query = new URLSearchParams({ pane_id: props.paneId })
    appendGitRepository(query, props.repository)
    const response = await authFetch(apiUrl(`/api/workspace/git-rebase-plan?${query}`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        upstream: upstream.value,
        entries,
        confirm_rewrite: true,
      }),
    })
    const result = await response.json().catch(function emptyRebasePlanResult() {
      return {}
    })
    if (!response.ok) {
      errorMessage.value = result.error || t('gitPanel.commitActionFailed')
      return
    }
    emit('completed', result.output || t('gitPanel.commitActionSucceeded'))
    emit('close')
  } catch {
    errorMessage.value = t('gitPanel.commitActionFailed')
  } finally {
    busy.value = false
  }
}

watch(
  function watchPlannerContext() {
    return [props.visible, props.paneId, props.repository]
  },
  function reloadPlannerContext() {
    if (props.visible) void loadCandidates()
  },
  { immediate: true }
)
</script>

<style scoped>
.git-rebase-backdrop {
  position: fixed;
  inset: 0;
  z-index: 2200;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  background: rgba(0, 0, 0, 0.58);
}

.git-rebase-dialog {
  width: min(760px, 96vw);
  max-height: min(760px, 92vh);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--fg);
  background: var(--bg-surface);
  box-shadow: 0 18px 50px rgba(0, 0, 0, 0.45);
}

.git-rebase-header,
.git-rebase-footer {
  min-height: 46px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
}

.git-rebase-header > div {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 7px;
}

.git-rebase-header h2,
.git-rebase-content h3 {
  margin: 0;
  letter-spacing: 0;
}

.git-rebase-header h2 {
  font-size: 13px;
}

.git-rebase-header button,
.git-rebase-order-actions button {
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

.git-rebase-header button:hover,
.git-rebase-order-actions button:hover:not(:disabled) {
  color: var(--fg);
  background: var(--bg-hover);
}

.git-rebase-content {
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(210px, 0.8fr) minmax(340px, 1.4fr);
  flex: 1;
  overflow: hidden;
}

.git-rebase-candidates,
.git-rebase-plan {
  min-height: 0;
  overflow: auto;
  padding: 10px;
}

.git-rebase-candidates {
  border-right: 1px solid var(--border);
}

.git-rebase-content h3 {
  margin-bottom: 7px;
  color: var(--fg-muted);
  font-size: 10px;
  text-transform: uppercase;
}

.git-rebase-candidates label {
  min-height: 30px;
  display: grid;
  grid-template-columns: 16px 58px minmax(0, 1fr);
  align-items: center;
  gap: 5px;
  padding: 3px 4px;
  border-bottom: 1px solid color-mix(in srgb, var(--border) 60%, transparent);
  cursor: pointer;
  font-size: 10px;
}

.git-rebase-candidates input {
  width: 13px;
  height: 13px;
  margin: 0;
  accent-color: var(--accent);
}

.git-rebase-candidates code,
.git-rebase-commit code {
  color: var(--color-blue, #69a7d8);
  font-family: var(--font-mono);
  font-size: 9px;
}

.git-rebase-candidates span,
.git-rebase-commit span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.git-rebase-plan-row {
  min-height: 43px;
  display: grid;
  grid-template-columns: 28px minmax(120px, 1fr) 86px;
  align-items: center;
  gap: 6px;
  padding: 5px 0;
  border-bottom: 1px solid color-mix(in srgb, var(--border) 70%, transparent);
}

.git-rebase-plan-row > input {
  grid-column: 2 / 4;
}

.git-rebase-order-actions {
  display: flex;
  flex-direction: column;
}

.git-rebase-order-actions button {
  width: 24px;
  height: 18px;
}

.git-rebase-order-actions button:disabled {
  cursor: default;
  opacity: 0.25;
}

.git-rebase-commit {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
  font-size: 10px;
}

.git-rebase-plan select,
.git-rebase-plan input {
  width: 100%;
  min-height: 28px;
  padding: 0 6px;
  border: 1px solid var(--border);
  border-radius: 3px;
  color: var(--fg);
  background: var(--bg);
  outline: none;
  font-size: 10px;
}

.git-rebase-plan select:focus,
.git-rebase-plan input:focus {
  border-color: var(--accent);
}

.git-rebase-state {
  min-height: 180px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  color: var(--fg-muted);
  text-align: center;
  font-size: 11px;
}

.git-rebase-state.error {
  color: var(--color-red, #e06c75);
}

.git-rebase-footer {
  justify-content: flex-end;
  border-top: 1px solid var(--border);
  border-bottom: 0;
}

.git-rebase-footer button {
  min-height: 29px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 0 10px;
  border: 1px solid var(--border);
  border-radius: 3px;
  color: var(--fg);
  background: var(--tab-bg);
  cursor: pointer;
  font-size: 10px;
}

.git-rebase-footer button.danger {
  border-color: color-mix(in srgb, var(--color-red, #e06c75) 65%, var(--border));
  color: var(--color-red, #e06c75);
}

.git-rebase-footer button:disabled {
  cursor: default;
  opacity: 0.45;
}

.spin {
  animation: git-rebase-spin 0.8s linear infinite;
}

@keyframes git-rebase-spin {
  to {
    transform: rotate(360deg);
  }
}

@media (max-width: 640px) {
  .git-rebase-backdrop {
    align-items: stretch;
    padding: 8px;
  }

  .git-rebase-dialog {
    width: 100%;
    max-height: none;
  }

  .git-rebase-content {
    grid-template-columns: 1fr;
    overflow: auto;
  }

  .git-rebase-candidates {
    max-height: 32vh;
    border-right: 0;
    border-bottom: 1px solid var(--border);
  }

  .git-rebase-plan {
    overflow: visible;
  }
}
</style>
