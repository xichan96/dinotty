<template>
  <section class="git-diff-viewer">
    <header class="git-diff-header">
      <div class="git-diff-title-wrap">
        <span class="git-diff-title">{{ fileName }}</span>
        <span class="git-diff-path">{{ filePath }}</span>
      </div>
      <span class="git-diff-scope">
        {{ staged ? t('gitPanel.staged') : t('gitPanel.workingTree') }}
      </span>
      <button
        type="button"
        class="git-diff-icon-button"
        :title="t('gitPanel.refresh')"
        :aria-label="t('gitPanel.refresh')"
        @click="loadDiff"
      >
        <RefreshCw :size="14" :class="{ spinning: loading }" />
      </button>
      <button
        type="button"
        data-testid="git-diff-open-source"
        class="git-diff-icon-button"
        :title="t('gitPanel.openSource')"
        :aria-label="t('gitPanel.openSource')"
        @click="emit('open-source', filePath)"
      >
        <FileCode2 :size="14" />
      </button>
      <button
        type="button"
        class="git-diff-icon-button"
        :title="t('gitPanel.closeDiff')"
        :aria-label="t('gitPanel.closeDiff')"
        @click="emit('close')"
      >
        <X :size="15" />
      </button>
    </header>

    <div v-if="loading" class="git-diff-state">{{ t('gitPanel.loadingDiff') }}</div>
    <div v-else-if="errorMessage" class="git-diff-state error" role="alert">
      {{ errorMessage }}
    </div>
    <div v-else-if="!lines.length" class="git-diff-state">{{ t('gitPanel.noDiff') }}</div>
    <div v-else class="git-diff-scroll" role="region" :aria-label="t('gitPanel.diff')">
      <div
        v-for="(line, index) in lines"
        :key="`${index}:${line.text}`"
        class="git-diff-line"
        :class="`git-diff-line-${line.type}`"
      >
        <span class="git-diff-line-number">{{ line.oldLine || '' }}</span>
        <span class="git-diff-line-number">{{ line.newLine || '' }}</span>
        <code>{{ line.text }}</code>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { FileCode2, RefreshCw, X } from 'lucide-vue-next'
import { apiUrl, authFetch, getApiBase } from '../../composables/apiBase'
import { useI18n } from '../../composables/useI18n'
import { getGitFileName } from '../../utils/gitPanel'

interface DiffLine {
  text: string
  type: 'meta' | 'hunk' | 'added' | 'removed' | 'context'
  oldLine: number | null
  newLine: number | null
}

const props = defineProps<{
  paneId: string
  filePath: string
  staged: boolean
  untracked: boolean
}>()

const emit = defineEmits<{
  close: []
  'open-source': [path: string]
}>()

const { t } = useI18n()
const loading = ref(false)
const errorMessage = ref('')
const patch = ref('')

const fileName = computed(function computeFileName() {
  // 步骤1：只在主标题显示文件名，完整路径保留为辅助信息。
  return getGitFileName(props.filePath)
})

const lines = computed(function computeDiffLines() {
  // 步骤1：逐行解析 hunk 头，维护原文件和新文件的行号。
  const parsedLines: DiffLine[] = []
  let oldLineNumber = 0
  let newLineNumber = 0
  const patchLines = patch.value.split('\n')
  for (const patchLine of patchLines) {
    if (patchLine.startsWith('@@')) {
      const match = /@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(patchLine)
      if (match) {
        oldLineNumber = Number(match[1])
        newLineNumber = Number(match[2])
      }
      parsedLines.push({ text: patchLine, type: 'hunk', oldLine: null, newLine: null })
      continue
    }
    if (
      patchLine.startsWith('diff --git') ||
      patchLine.startsWith('index ') ||
      patchLine.startsWith('---') ||
      patchLine.startsWith('+++')
    ) {
      parsedLines.push({ text: patchLine, type: 'meta', oldLine: null, newLine: null })
      continue
    }

    // 步骤2：根据增删上下文更新对应行号并生成渲染数据。
    if (patchLine.startsWith('+')) {
      parsedLines.push({ text: patchLine, type: 'added', oldLine: null, newLine: newLineNumber })
      newLineNumber += 1
    } else if (patchLine.startsWith('-')) {
      parsedLines.push({ text: patchLine, type: 'removed', oldLine: oldLineNumber, newLine: null })
      oldLineNumber += 1
    } else {
      parsedLines.push({
        text: patchLine,
        type: 'context',
        oldLine: oldLineNumber || null,
        newLine: newLineNumber || null,
      })
      if (oldLineNumber) oldLineNumber += 1
      if (newLineNumber) newLineNumber += 1
    }
  }
  if (parsedLines.length === 1 && parsedLines[0].text === '') {
    return []
  }
  return parsedLines
})

async function loadDiff(): Promise<void> {
  // 步骤1：根据文件所在分组请求工作区或暂存区差异。
  loading.value = true
  errorMessage.value = ''
  patch.value = ''
  try {
    await getApiBase()
    const query = new URLSearchParams({
      pane_id: props.paneId,
      path: props.filePath,
      staged: String(props.staged),
      untracked: String(props.untracked),
    })
    const response = await authFetch(apiUrl(`/api/workspace/git-unified-diff?${query}`))
    const result = await response.json().catch(function emptyDiffResult() {
      return {}
    })
    if (!response.ok) {
      errorMessage.value = result.error || t('gitPanel.diffFailed')
      return
    }

    // 步骤2：保存后端返回的 unified diff，由计算属性转换为行模型。
    patch.value = result.patch || ''
  } catch {
    errorMessage.value = t('gitPanel.diffFailed')
  } finally {
    loading.value = false
  }
}

watch(
  function watchDiffTarget() {
    return [props.paneId, props.filePath, props.staged, props.untracked]
  },
  function reloadDiffForTarget() {
    void loadDiff()
  },
  { immediate: true }
)
</script>

<style scoped>
.git-diff-viewer {
  height: 100%;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  color: var(--fg);
  background: var(--bg);
}

.git-diff-header {
  min-height: 38px;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 7px 0 12px;
  border-bottom: 1px solid var(--border);
  background: var(--tab-bg);
}

.git-diff-title-wrap {
  min-width: 0;
  flex: 1;
  display: flex;
  align-items: baseline;
  gap: 8px;
}

.git-diff-title,
.git-diff-path {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.git-diff-title {
  flex: 0 1 auto;
  color: var(--fg-bright);
  font-size: 13px;
  font-weight: 600;
}

.git-diff-path {
  flex: 1 1 auto;
  color: var(--fg-muted);
  font-size: 10px;
}

.git-diff-scope {
  flex: 0 0 auto;
  color: var(--fg-muted);
  font-size: 10px;
  text-transform: uppercase;
}

.git-diff-icon-button {
  width: 27px;
  height: 27px;
  flex: 0 0 27px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 3px;
  color: var(--fg-muted);
  background: transparent;
  cursor: pointer;
}

.git-diff-icon-button:hover,
.git-diff-icon-button:focus-visible {
  color: var(--fg-bright);
  background: var(--bg-hover);
  outline: 1px solid var(--accent);
  outline-offset: -1px;
}

.git-diff-state {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  color: var(--fg-muted);
  text-align: center;
  font-size: 12px;
}

.git-diff-state.error {
  color: var(--color-red, #e06c75);
}

.git-diff-scroll {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 8px 0 24px;
  font-family: var(--font-mono);
  font-size: 12px;
  line-height: 20px;
}

.git-diff-line {
  min-width: max-content;
  display: grid;
  grid-template-columns: 48px 48px minmax(320px, 1fr);
  min-height: 20px;
  white-space: pre;
}

.git-diff-line-number {
  padding: 0 8px;
  color: var(--fg-muted);
  background: color-mix(in srgb, var(--tab-bg) 76%, transparent);
  text-align: right;
  user-select: none;
}

.git-diff-line code {
  padding: 0 12px;
  font: inherit;
}

.git-diff-line-added {
  background: color-mix(in srgb, #2ea043 18%, transparent);
}

.git-diff-line-removed {
  background: color-mix(in srgb, #d94f4f 18%, transparent);
}

.git-diff-line-hunk {
  color: #82aaff;
  background: color-mix(in srgb, #1976d2 17%, transparent);
}

.git-diff-line-meta {
  color: var(--fg-muted);
}

.spinning {
  animation: git-diff-spin 0.8s linear infinite;
}

@keyframes git-diff-spin {
  to {
    transform: rotate(360deg);
  }
}

@media (max-width: 640px) {
  .git-diff-path,
  .git-diff-scope {
    display: none;
  }

  .git-diff-line {
    grid-template-columns: 34px 34px minmax(260px, 1fr);
  }
}

@media (prefers-reduced-motion: reduce) {
  .spinning {
    animation: none;
  }
}
</style>
