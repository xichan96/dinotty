<template>
  <section class="git-blame-viewer">
    <header class="git-blame-header">
      <div class="git-blame-title">
        <GitCommitHorizontal :size="14" />
        <span>{{ t('gitPanel.blame') }}</span>
        <code>{{ filePath }}</code>
      </div>
      <button
        type="button"
        class="git-blame-icon-button"
        :title="t('gitPanel.refreshBlame')"
        :aria-label="t('gitPanel.refreshBlame')"
        @click="loadBlame"
      >
        <RefreshCw :size="14" :class="{ spinning: loading }" />
      </button>
      <button
        type="button"
        class="git-blame-icon-button"
        :title="t('gitPanel.closeBlame')"
        :aria-label="t('gitPanel.closeBlame')"
        @click="emit('close')"
      >
        <X :size="15" />
      </button>
    </header>

    <p v-if="errorMessage" class="git-blame-state error" role="alert">
      {{ errorMessage }}
    </p>
    <p v-else-if="loading && !lines.length" class="git-blame-state">
      {{ t('gitPanel.loadingBlame') }}
    </p>
    <p v-else-if="!lines.length" class="git-blame-state">
      {{ t('gitPanel.noBlame') }}
    </p>
    <div v-else class="git-blame-content">
      <div class="git-blame-column-header" aria-hidden="true">
        <span>{{ t('gitPanel.blameCommit') }}</span>
        <span>{{ t('gitPanel.blameAuthor') }}</span>
        <span>{{ t('gitPanel.blameDate') }}</span>
        <span>{{ t('gitPanel.blameLine') }}</span>
        <span>{{ t('gitPanel.blameCode') }}</span>
      </div>
      <div class="git-blame-lines">
        <div
          v-for="line in visibleLines"
          :key="line.lineNumber"
          data-testid="git-blame-row"
          class="git-blame-row"
        >
          <button
            v-if="isCommitted(line.hash)"
            type="button"
            data-testid="git-blame-commit"
            class="git-blame-commit"
            :title="line.summary"
            @click="openCommit(line)"
          >
            {{ line.shortHash }}
          </button>
          <span v-else class="git-blame-uncommitted">{{ t('gitPanel.blameUncommitted') }}</span>
          <span class="git-blame-author" :title="line.authorEmail">{{ line.authorName }}</span>
          <time :datetime="formatIsoDate(line.authoredAt)">{{ formatDate(line.authoredAt) }}</time>
          <span class="git-blame-line-number">{{ line.lineNumber }}</span>
          <code class="git-blame-code">{{ line.content || ' ' }}</code>
        </div>
      </div>
      <button
        v-if="visibleLineCount < lines.length"
        type="button"
        class="git-blame-load-more"
        @click="loadMoreLines"
      >
        {{
          t('gitPanel.loadMoreBlame').replace('{count}', String(lines.length - visibleLineCount))
        }}
      </button>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { GitCommitHorizontal, RefreshCw, X } from 'lucide-vue-next'
import { apiUrl, authFetch, getApiBase } from '../../composables/apiBase'
import { useI18n } from '../../composables/useI18n'
import { appendGitRepository } from '../../utils/gitPanel'
import type { GitHistorySelection } from '../../utils/gitHistory'

interface GitBlameLineEntry {
  lineNumber: number
  content: string
  hash: string
  shortHash: string
  authorName: string
  authorEmail: string
  authoredAt: number
  summary: string
}

const props = defineProps<{
  paneId: string
  filePath: string
  repository?: string
}>()

const emit = defineEmits<{
  close: []
  'view-history': [selection: GitHistorySelection]
}>()

const { t } = useI18n()
const loading = ref(false)
const errorMessage = ref('')
const lines = ref<GitBlameLineEntry[]>([])
const visibleLineCount = ref(500)

const visibleLines = computed(function computeVisibleBlameLines() {
  return lines.value.slice(0, visibleLineCount.value)
})

function mapBlameLine(value: unknown): GitBlameLineEntry | null {
  // 步骤1：逐字段验证 Blame 行，拒绝缺少行号或提交哈希的数据。
  if (!value || typeof value !== 'object') return null
  const rawLine = value as Record<string, unknown>
  if (typeof rawLine.line_number !== 'number' || typeof rawLine.hash !== 'string') return null
  return {
    lineNumber: rawLine.line_number,
    content: String(rawLine.content || ''),
    hash: rawLine.hash,
    shortHash: String(rawLine.short_hash || ''),
    authorName: String(rawLine.author_name || ''),
    authorEmail: String(rawLine.author_email || ''),
    authoredAt: Number(rawLine.authored_at || 0),
    summary: String(rawLine.summary || ''),
  }
}

async function loadBlame(): Promise<void> {
  // 步骤1：读取当前仓库文件的逐行追责数据。
  loading.value = true
  errorMessage.value = ''
  visibleLineCount.value = 500
  try {
    await getApiBase()
    const query = new URLSearchParams({ pane_id: props.paneId })
    appendGitRepository(query, props.repository)
    query.set('path', props.filePath)
    const response = await authFetch(apiUrl(`/api/workspace/git-blame?${query}`))
    const result = await response.json().catch(function emptyBlameResult() {
      return {}
    })
    if (!response.ok) {
      lines.value = []
      errorMessage.value = result.error || t('gitPanel.blameFailed')
      return
    }

    // 步骤2：保留合法行并按后端提供的源码顺序显示。
    const nextLines: GitBlameLineEntry[] = []
    if (Array.isArray(result.lines)) {
      for (const value of result.lines) {
        const line = mapBlameLine(value)
        if (line) nextLines.push(line)
      }
    }
    lines.value = nextLines
  } catch {
    lines.value = []
    errorMessage.value = t('gitPanel.blameFailed')
  } finally {
    loading.value = false
  }
}

function isCommitted(hash: string): boolean {
  // 步骤1：全零哈希代表工作区尚未提交的行，不能打开提交详情。
  return hash !== '0000000000000000000000000000000000000000'
}

function openCommit(line: GitBlameLineEntry): void {
  // 步骤1：转换为现有历史查看器使用的提交选择结构。
  emit('view-history', {
    kind: 'commit',
    hash: line.hash,
    shortHash: line.shortHash,
    subject: line.summary,
    authorName: line.authorName,
    authoredAt: formatIsoDate(line.authoredAt),
    path: props.filePath,
  })
}

function formatIsoDate(timestamp: number): string {
  // 步骤1：后端返回 Unix 秒，历史查看器使用 ISO 时间。
  return new Date(timestamp * 1_000).toISOString()
}

function formatDate(timestamp: number): string {
  // 步骤1：无提交时间时显示占位，其余使用设备本地日期。
  if (!timestamp) return '-'
  return new Date(timestamp * 1_000).toLocaleDateString()
}

function loadMoreLines(): void {
  // 步骤1：每次增加 500 行，避免大文件一次创建过多 DOM 节点。
  visibleLineCount.value += 500
}

watch(
  function watchBlameTarget() {
    return [props.paneId, props.repository, props.filePath]
  },
  function reloadBlameTarget() {
    void loadBlame()
  },
  { immediate: true }
)
</script>

<style scoped>
.git-blame-viewer {
  height: 100%;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  color: var(--fg);
  background: var(--bg);
}

.git-blame-header {
  min-height: 42px;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 7px 0 12px;
  border-bottom: 1px solid var(--border);
  background: var(--tab-bg);
}

.git-blame-title {
  min-width: 0;
  flex: 1;
  display: flex;
  align-items: center;
  gap: 7px;
}

.git-blame-title code {
  min-width: 0;
  overflow: hidden;
  color: var(--fg-muted);
  font-size: 10px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.git-blame-icon-button {
  width: 28px;
  height: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 3px;
  color: var(--fg-muted);
  background: transparent;
  cursor: pointer;
}

.git-blame-icon-button:hover,
.git-blame-icon-button:focus-visible {
  color: var(--fg-bright);
  background: var(--bg-hover);
  outline: none;
}

.git-blame-state {
  margin: 0;
  padding: 16px;
  color: var(--fg-muted);
  font-size: 11px;
}

.git-blame-state.error {
  color: var(--color-red, #e06c75);
}

.git-blame-content,
.git-blame-lines {
  min-width: 0;
}

.git-blame-content {
  flex: 1;
  min-height: 0;
  overflow: auto;
}

.git-blame-column-header,
.git-blame-row {
  min-width: 720px;
  display: grid;
  grid-template-columns: 78px 120px 92px 52px minmax(360px, 1fr);
  align-items: center;
}

.git-blame-column-header {
  position: sticky;
  top: 0;
  z-index: 1;
  min-height: 28px;
  border-bottom: 1px solid var(--border);
  color: var(--fg-muted);
  background: var(--tab-bg);
  font-size: 9px;
}

.git-blame-column-header span,
.git-blame-row > * {
  min-width: 0;
  padding: 0 7px;
}

.git-blame-row {
  min-height: 25px;
  border-bottom: 1px solid color-mix(in srgb, var(--border) 55%, transparent);
  font-size: 10px;
}

.git-blame-row:hover {
  background: var(--bg-hover);
}

.git-blame-commit {
  border: 0;
  color: var(--color-blue, #69a7d8);
  background: transparent;
  cursor: pointer;
  font-family: var(--font-mono);
  font-size: 9px;
  text-align: left;
}

.git-blame-commit:hover,
.git-blame-commit:focus-visible {
  text-decoration: underline;
  outline: none;
}

.git-blame-uncommitted,
.git-blame-author,
.git-blame-row time {
  overflow: hidden;
  color: var(--fg-muted);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.git-blame-line-number {
  color: var(--fg-muted);
  font-family: var(--font-mono);
  text-align: right;
}

.git-blame-code {
  overflow: hidden;
  color: var(--fg-bright);
  font-family: var(--font-mono);
  text-overflow: ellipsis;
  white-space: pre;
}

.git-blame-load-more {
  width: 100%;
  min-height: 31px;
  border: 0;
  border-top: 1px solid var(--border);
  color: var(--fg-muted);
  background: transparent;
  cursor: pointer;
  font-size: 10px;
}

.git-blame-load-more:hover,
.git-blame-load-more:focus-visible {
  color: var(--fg-bright);
  background: var(--bg-hover);
  outline: none;
}

.spinning {
  animation: git-blame-spin 0.8s linear infinite;
}

@keyframes git-blame-spin {
  to {
    transform: rotate(360deg);
  }
}

@media (prefers-reduced-motion: reduce) {
  .spinning {
    animation: none;
  }
}
</style>
