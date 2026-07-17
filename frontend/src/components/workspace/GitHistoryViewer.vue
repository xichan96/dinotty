<template>
  <section class="git-history-viewer">
    <header class="git-history-viewer-header">
      <div class="git-history-viewer-copy">
        <span data-testid="git-history-viewer-title" class="git-history-viewer-title">
          {{ title }}
        </span>
        <span class="git-history-viewer-meta">{{ metadata }}</span>
      </div>
      <div
        v-if="selection.kind === 'compare' && comparisonCounts"
        data-testid="git-compare-counts"
        class="git-history-counts"
      >
        <span :title="t('gitPanel.baseOnlyCommits')">
          <ArrowLeft :size="11" />{{ comparisonCounts.baseOnly }}
        </span>
        <span :title="t('gitPanel.targetOnlyCommits')">
          <ArrowRight :size="11" />{{ comparisonCounts.targetOnly }}
        </span>
      </div>
      <button
        type="button"
        class="git-history-viewer-icon-button"
        :title="t('gitPanel.refreshHistoryDetail')"
        :aria-label="t('gitPanel.refreshHistoryDetail')"
        @click="loadSelection"
      >
        <RefreshCw :size="14" :class="{ spinning: loading }" />
      </button>
      <button
        type="button"
        class="git-history-viewer-icon-button"
        :title="t('gitPanel.closeHistoryDetail')"
        :aria-label="t('gitPanel.closeHistoryDetail')"
        @click="emit('close')"
      >
        <X :size="15" />
      </button>
    </header>
    <GitPatchContent
      :loading="loading"
      :error="errorMessage"
      :patch="patch"
      :loading-text="t('gitPanel.loadingHistoryDetail')"
      :empty-text="t('gitPanel.noHistoryDiff')"
      :diff-label="t('gitPanel.historyDiff')"
      :search-placeholder="t('gitPanel.searchDiff')"
      :load-more-text="t('gitPanel.loadMoreDiffLines')"
      :wrap-text="t('gitPanel.wrapDiffLines')"
      :inline-view-text="t('gitPanel.inlineDiffView')"
      :split-view-text="t('gitPanel.splitDiffView')"
    />
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ArrowLeft, ArrowRight, RefreshCw, X } from 'lucide-vue-next'
import { apiUrl, authFetch, getApiBase } from '../../composables/apiBase'
import { useI18n } from '../../composables/useI18n'
import type { GitHistorySelection } from '../../utils/gitHistory'
import { appendGitRepository } from '../../utils/gitPanel'
import GitPatchContent from './GitPatchContent.vue'

const props = defineProps<{
  paneId: string
  selection: GitHistorySelection
  repository?: string
}>()

const emit = defineEmits<{
  close: []
}>()

const { t } = useI18n()
const loading = ref(false)
const errorMessage = ref('')
const patch = ref('')
const comparisonCounts = ref<{ baseOnly: number; targetOnly: number } | null>(null)

const title = computed(function computeTitle() {
  // 步骤1：提交显示说明，分支比较显示明确的三点比较表达式。
  if (props.selection.kind === 'commit') return props.selection.subject
  return `${props.selection.base}...${props.selection.target}`
})

const metadata = computed(function computeMetadata() {
  // 步骤1：提交展示哈希、作者和日期，比较展示方向说明。
  if (props.selection.kind === 'compare') {
    return t('gitPanel.compareDirection')
      .replace('{base}', props.selection.base)
      .replace('{target}', props.selection.target)
  }
  const parts: string[] = [props.selection.shortHash, props.selection.authorName]
  const date = new Date(props.selection.authoredAt)
  if (!Number.isNaN(date.getTime())) {
    parts.push(date.toLocaleString())
  }
  if (props.selection.path) {
    parts.push(props.selection.path)
  }
  return parts.join(' · ')
})

async function loadSelection(): Promise<void> {
  // 步骤1：根据选择类型组装提交详情或分支比较请求。
  loading.value = true
  errorMessage.value = ''
  patch.value = ''
  comparisonCounts.value = null
  try {
    await getApiBase()
    const query = new URLSearchParams({ pane_id: props.paneId })
    appendGitRepository(query, props.repository)
    let endpoint = 'git-commit-diff'
    if (props.selection.kind === 'commit') {
      query.set('commit', props.selection.hash)
      if (props.selection.path) query.set('path', props.selection.path)
    } else {
      endpoint = 'git-compare'
      query.set('base', props.selection.base)
      query.set('target', props.selection.target)
    }

    // 步骤2：保存 Patch；分支比较额外保存两侧独有提交数。
    const response = await authFetch(apiUrl(`/api/workspace/${endpoint}?${query}`))
    const result = await response.json().catch(function emptyHistoryDetailResult() {
      return {}
    })
    if (!response.ok) {
      errorMessage.value = result.error || t('gitPanel.historyDetailFailed')
      return
    }
    patch.value = String(result.patch || '')
    if (props.selection.kind === 'compare') {
      comparisonCounts.value = {
        baseOnly: Number(result.base_only || 0),
        targetOnly: Number(result.target_only || 0),
      }
    }
  } catch {
    errorMessage.value = t('gitPanel.historyDetailFailed')
  } finally {
    loading.value = false
  }
}

watch(
  function watchHistorySelection() {
    return [props.paneId, props.repository, JSON.stringify(props.selection)]
  },
  function reloadHistorySelection() {
    void loadSelection()
  },
  { immediate: true }
)
</script>

<style scoped>
.git-history-viewer {
  height: 100%;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  color: var(--fg);
  background: var(--bg);
}

.git-history-viewer-header {
  min-height: 42px;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 7px 0 12px;
  border-bottom: 1px solid var(--border);
  background: var(--tab-bg);
}

.git-history-viewer-copy {
  min-width: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.git-history-viewer-title,
.git-history-viewer-meta {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.git-history-viewer-title {
  color: var(--fg-bright);
  font-size: 12px;
  font-weight: 600;
}

.git-history-viewer-meta {
  color: var(--fg-muted);
  font-size: 9px;
}

.git-history-counts,
.git-history-counts span {
  display: inline-flex;
  align-items: center;
}

.git-history-counts {
  flex: 0 0 auto;
  gap: 7px;
  color: var(--fg-muted);
  font-family: var(--font-mono);
  font-size: 10px;
}

.git-history-counts span {
  gap: 2px;
}

.git-history-viewer-icon-button {
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

.git-history-viewer-icon-button:hover,
.git-history-viewer-icon-button:focus-visible {
  color: var(--fg-bright);
  background: var(--bg-hover);
  outline: 1px solid var(--accent);
  outline-offset: -1px;
}

.spinning {
  animation: git-history-spin 0.8s linear infinite;
}

@keyframes git-history-spin {
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
