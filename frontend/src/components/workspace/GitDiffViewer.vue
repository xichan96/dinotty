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
        data-testid="git-diff-ignore-whitespace"
        class="git-diff-icon-button"
        :class="{ active: ignoreWhitespace }"
        :title="t('gitPanel.ignoreWhitespace')"
        :aria-label="t('gitPanel.ignoreWhitespace')"
        @click="ignoreWhitespace = !ignoreWhitespace"
      >
        <Pilcrow :size="14" />
      </button>
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

    <p v-if="actionErrorMessage" class="git-diff-action-message" role="alert">
      {{ actionErrorMessage }}
    </p>

    <GitPatchContent
      :loading="loading"
      :error="errorMessage"
      :patch="patch"
      :loading-text="t('gitPanel.loadingDiff')"
      :empty-text="t('gitPanel.noDiff')"
      :diff-label="t('gitPanel.diff')"
      :search-placeholder="t('gitPanel.searchDiff')"
      :load-more-text="t('gitPanel.loadMoreDiffLines')"
      :wrap-text="t('gitPanel.wrapDiffLines')"
      :inline-view-text="t('gitPanel.inlineDiffView')"
      :split-view-text="t('gitPanel.splitDiffView')"
      :stage-hunk-text="t('gitPanel.stageHunk')"
      :unstage-hunk-text="t('gitPanel.unstageHunk')"
      :discard-hunk-text="t('gitPanel.discardHunk')"
      :can-stage-hunks="!staged"
      :can-unstage-hunks="staged"
      :can-discard-hunks="!staged && !untracked"
      :hunk-action-busy="hunkActionBusy"
      @hunk-action="runHunkAction"
    />
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { FileCode2, Pilcrow, RefreshCw, X } from 'lucide-vue-next'
import { apiUrl, authFetch, getApiBase } from '../../composables/apiBase'
import { useI18n } from '../../composables/useI18n'
import { appendGitRepository, getGitFileName } from '../../utils/gitPanel'
import GitPatchContent from './GitPatchContent.vue'

const props = defineProps<{
  paneId: string
  filePath: string
  staged: boolean
  untracked: boolean
  repository?: string
}>()

const emit = defineEmits<{
  close: []
  'open-source': [path: string]
  refresh: []
}>()

const { t } = useI18n()
const loading = ref(false)
const errorMessage = ref('')
const actionErrorMessage = ref('')
const patch = ref('')
const ignoreWhitespace = ref(false)
const hunkActionBusy = ref(false)

const fileName = computed(function computeFileName() {
  // 步骤1：只在主标题显示文件名，完整路径保留为辅助信息。
  return getGitFileName(props.filePath)
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
      ignore_whitespace: String(ignoreWhitespace.value),
    })
    appendGitRepository(query, props.repository)
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

async function runHunkAction(
  hunkIndex: number,
  action: 'stage' | 'unstage' | 'discard'
): Promise<void> {
  // 步骤1：把当前文件分组、hunk 序号和固定动作发送给仓库接口。
  if (hunkActionBusy.value) return
  hunkActionBusy.value = true
  actionErrorMessage.value = ''
  try {
    await getApiBase()
    const query = new URLSearchParams({ pane_id: props.paneId })
    appendGitRepository(query, props.repository)
    const requestBody: Record<string, unknown> = {
      path: props.filePath,
      staged: props.staged,
      untracked: props.untracked,
      hunk_index: hunkIndex,
      action,
    }
    if (ignoreWhitespace.value) {
      requestBody.ignore_whitespace = true
    }
    const response = await authFetch(apiUrl(`/api/workspace/git-hunk-action?${query}`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    })
    const result = await response.json().catch(function emptyHunkActionResult() {
      return {}
    })
    if (!response.ok) {
      actionErrorMessage.value = result.error || t('gitPanel.hunkActionFailed')
      return
    }

    // 步骤2：成功后同时刷新差异和侧栏状态，避免显示已经失效的 hunk。
    emit('refresh')
    await loadDiff()
  } catch {
    actionErrorMessage.value = t('gitPanel.hunkActionFailed')
  } finally {
    hunkActionBusy.value = false
  }
}

watch(
  function watchDiffTarget() {
    return [
      props.paneId,
      props.repository,
      props.filePath,
      props.staged,
      props.untracked,
      ignoreWhitespace.value,
    ]
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

.git-diff-action-message {
  margin: 0;
  padding: 6px 10px;
  border-bottom: 1px solid color-mix(in srgb, var(--color-red, #e06c75) 45%, var(--border));
  color: var(--color-red, #e06c75);
  background: color-mix(in srgb, var(--color-red, #e06c75) 10%, var(--bg));
  font-size: 11px;
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
.git-diff-icon-button:focus-visible,
.git-diff-icon-button.active {
  color: var(--fg-bright);
  background: var(--bg-hover);
  outline: 1px solid var(--accent);
  outline-offset: -1px;
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
}

@media (prefers-reduced-motion: reduce) {
  .spinning {
    animation: none;
  }
}
</style>
