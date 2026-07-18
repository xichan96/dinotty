<template>
  <section class="git-command-section" :aria-label="t('gitPanel.commandLog')">
    <button
      type="button"
      data-testid="git-command-log-heading"
      class="git-command-heading"
      @click="toggleExpanded"
    >
      <ChevronDown :size="13" :class="{ collapsed: !expanded }" />
      <TerminalSquare :size="13" />
      <span>{{ t('gitPanel.commandLog') }}</span>
      <span v-if="runningCount" class="git-command-running-count">{{ runningCount }}</span>
    </button>

    <template v-if="expanded">
      <p v-if="errorMessage" class="git-command-message error" role="alert">
        {{ errorMessage }}
      </p>
      <div v-if="loading && !commands.length" class="git-command-state">
        {{ t('gitPanel.loadingCommands') }}
      </div>
      <div v-else-if="!commands.length" class="git-command-state">
        {{ t('gitPanel.noCommands') }}
      </div>
      <div v-else class="git-command-list">
        <article
          v-for="command in commands"
          :key="command.id"
          data-testid="git-command-log-row"
          class="git-command-row"
        >
          <div class="git-command-summary">
            <span class="git-command-status" :class="command.status">
              {{ statusLabel(command.status) }}
            </span>
            <code>{{ command.command }}</code>
            <button
              v-if="command.status === 'running'"
              type="button"
              data-testid="git-command-cancel"
              class="git-command-cancel"
              :title="t('gitPanel.cancelCommand')"
              :aria-label="t('gitPanel.cancelCommand')"
              :disabled="cancellingId === command.id"
              @click="cancelCommand(command.id)"
            >
              <LoaderCircle v-if="cancellingId === command.id" :size="13" class="spin" />
              <Square v-else :size="12" />
            </button>
          </div>
          <div class="git-command-meta">
            <time :datetime="new Date(command.started_at).toISOString()">
              {{ formatTimestamp(command.started_at) }}
            </time>
            <span v-if="command.finished_at !== null">
              {{ formatDuration(command.started_at, command.finished_at) }}
            </span>
          </div>
          <pre v-if="command.output">{{ command.output }}</pre>
        </article>
      </div>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import { ChevronDown, LoaderCircle, Square, TerminalSquare } from 'lucide-vue-next'
import { apiUrl, authFetch, getApiBase } from '../../composables/apiBase'
import { useI18n } from '../../composables/useI18n'
import { appendGitRepository } from '../../utils/gitPanel'

interface GitCommandEntry {
  id: string
  command: string
  status: string
  started_at: number
  finished_at: number | null
  output: string
}

const props = defineProps<{
  paneId: string
  repository?: string
}>()

const { t } = useI18n()
const expanded = ref(false)
const loading = ref(false)
const errorMessage = ref('')
const cancellingId = ref('')
const commands = ref<GitCommandEntry[]>([])
let refreshTimer: number | null = null

const runningCount = computed(function countRunningCommands() {
  let count = 0
  for (const command of commands.value) {
    if (command.status === 'running') count += 1
  }
  return count
})

function buildQuery(): string {
  // 步骤1：命令日志始终绑定当前 pane 和当前选择的仓库。
  const query = new URLSearchParams({ pane_id: props.paneId })
  appendGitRepository(query, props.repository)
  return query.toString()
}

function mapCommand(value: unknown): GitCommandEntry | null {
  // 步骤1：逐字段验证后端记录，忽略结构不完整的数据。
  if (!value || typeof value !== 'object') return null
  const rawCommand = value as Record<string, unknown>
  if (typeof rawCommand.id !== 'string' || typeof rawCommand.command !== 'string') return null
  if (typeof rawCommand.status !== 'string' || typeof rawCommand.started_at !== 'number')
    return null
  return {
    id: rawCommand.id,
    command: rawCommand.command,
    status: rawCommand.status,
    started_at: rawCommand.started_at,
    finished_at: typeof rawCommand.finished_at === 'number' ? rawCommand.finished_at : null,
    output: typeof rawCommand.output === 'string' ? rawCommand.output : '',
  }
}

async function loadCommands(): Promise<void> {
  // 步骤1：读取当前仓库日志，并保留后端返回顺序。
  loading.value = true
  errorMessage.value = ''
  try {
    await getApiBase()
    const response = await authFetch(apiUrl(`/api/workspace/git-command-log?${buildQuery()}`))
    const result = await response.json()
    if (!response.ok) {
      errorMessage.value = result.error || t('gitPanel.commandLogFailed')
      return
    }
    const nextCommands: GitCommandEntry[] = []
    if (Array.isArray(result.commands)) {
      for (const value of result.commands) {
        const command = mapCommand(value)
        if (command) nextCommands.push(command)
      }
    }
    commands.value = nextCommands
  } catch {
    errorMessage.value = t('gitPanel.commandLogFailed')
  } finally {
    loading.value = false
  }
}

function startRefreshTimer(): void {
  // 步骤1：展开期间定时刷新，使长命令状态和输出及时更新。
  stopRefreshTimer()
  refreshTimer = window.setInterval(function refreshCommandLog() {
    void loadCommands()
  }, 1_000)
}

function stopRefreshTimer(): void {
  // 步骤1：折叠或卸载时停止轮询，避免后台请求持续运行。
  if (refreshTimer === null) return
  window.clearInterval(refreshTimer)
  refreshTimer = null
}

function toggleExpanded(): void {
  // 步骤1：展开时立即加载，折叠时停止刷新。
  expanded.value = !expanded.value
  if (expanded.value) {
    void loadCommands()
    startRefreshTimer()
  } else {
    stopRefreshTimer()
  }
}

async function cancelCommand(id: string): Promise<void> {
  // 步骤1：只提交后端生成的命令 ID，不在客户端拼接进程信息。
  cancellingId.value = id
  errorMessage.value = ''
  try {
    await getApiBase()
    const response = await authFetch(apiUrl(`/api/workspace/git-command-cancel?${buildQuery()}`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    const result = await response.json()
    if (!response.ok) {
      errorMessage.value = result.error || t('gitPanel.cancelCommandFailed')
      return
    }
    await loadCommands()
  } catch {
    errorMessage.value = t('gitPanel.cancelCommandFailed')
  } finally {
    cancellingId.value = ''
  }
}

function statusLabel(status: string): string {
  // 步骤1：把固定后端状态转换为本地化文本。
  if (status === 'running') return t('gitPanel.commandRunning')
  if (status === 'success') return t('gitPanel.commandSuccess')
  if (status === 'cancelled') return t('gitPanel.commandCancelled')
  return t('gitPanel.commandFailed')
}

function formatTimestamp(timestamp: number): string {
  // 步骤1：使用设备本地时间展示命令开始时间。
  return new Date(timestamp).toLocaleString()
}

function formatDuration(startedAt: number, finishedAt: number): string {
  // 步骤1：短命令显示毫秒，较长命令显示秒。
  const duration = Math.max(0, finishedAt - startedAt)
  if (duration < 1_000) return `${duration} ms`
  return `${(duration / 1_000).toFixed(1)} s`
}

onBeforeUnmount(stopRefreshTimer)
</script>

<style scoped>
.git-command-section {
  border-bottom: 1px solid var(--border);
}

.git-command-heading {
  width: 100%;
  min-height: 31px;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 8px;
  border: 0;
  color: var(--fg-muted);
  background: transparent;
  cursor: pointer;
  font-size: 10px;
  text-align: left;
  text-transform: uppercase;
}

.git-command-heading:hover,
.git-command-heading:focus-visible {
  color: var(--fg-bright);
  background: var(--bg-hover);
  outline: none;
}

.git-command-heading svg:first-child {
  transition: transform 0.15s ease;
}

.git-command-heading svg.collapsed {
  transform: rotate(-90deg);
}

.git-command-running-count {
  min-width: 18px;
  height: 18px;
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--color-blue, #69a7d8);
  border-radius: 3px;
  color: var(--color-blue, #69a7d8);
  font-family: var(--font-mono);
  font-size: 9px;
}

.git-command-state,
.git-command-message {
  margin: 0;
  padding: 7px 9px;
  color: var(--fg-muted);
  font-size: 9px;
}

.git-command-message.error {
  color: var(--color-red, #e06c75);
}

.git-command-list {
  max-height: 280px;
  overflow: auto;
  border-top: 1px solid var(--border);
}

.git-command-row {
  padding: 7px 8px;
  border-bottom: 1px solid var(--border);
}

.git-command-row:last-child {
  border-bottom: 0;
}

.git-command-summary {
  min-width: 0;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) 24px;
  align-items: center;
  gap: 6px;
}

.git-command-summary code {
  min-width: 0;
  overflow: hidden;
  color: var(--fg-bright);
  font-size: 9px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.git-command-status {
  min-width: 48px;
  font-size: 9px;
}

.git-command-status.running {
  color: var(--color-blue, #69a7d8);
}

.git-command-status.success {
  color: var(--color-green, #62b478);
}

.git-command-status.failed,
.git-command-status.cancelled {
  color: var(--color-red, #e06c75);
}

.git-command-cancel {
  width: 24px;
  height: 24px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 3px;
  color: var(--color-red, #e06c75);
  background: transparent;
  cursor: pointer;
}

.git-command-cancel:hover:not(:disabled),
.git-command-cancel:focus-visible {
  background: var(--bg-hover);
  outline: none;
}

.git-command-meta {
  display: flex;
  gap: 8px;
  margin-top: 3px;
  color: var(--fg-muted);
  font-size: 8px;
}

.git-command-row pre {
  max-height: 100px;
  margin: 6px 0 0;
  padding: 6px;
  overflow: auto;
  border: 1px solid var(--border);
  border-radius: 3px;
  color: var(--fg-muted);
  background: var(--bg);
  font-family: var(--font-mono);
  font-size: 8px;
  line-height: 1.45;
  white-space: pre-wrap;
  word-break: break-word;
}

.spin {
  animation: git-command-spin 0.8s linear infinite;
}

@keyframes git-command-spin {
  to {
    transform: rotate(360deg);
  }
}

@media (prefers-reduced-motion: reduce) {
  .git-command-heading svg:first-child {
    transition: none;
  }

  .spin {
    animation: none;
  }
}
</style>
