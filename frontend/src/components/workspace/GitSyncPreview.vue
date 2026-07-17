<template>
  <section v-if="visible" class="git-sync-preview" :aria-label="t('gitPanel.syncPreview')">
    <header class="git-sync-preview-header">
      <GitCompareArrows :size="14" aria-hidden="true" />
      <span>{{ t('gitPanel.syncPreview') }}</span>
      <button
        type="button"
        class="git-sync-preview-close"
        :title="t('gitPanel.closeSyncPreview')"
        :aria-label="t('gitPanel.closeSyncPreview')"
        @click="emit('close')"
      >
        <X :size="14" />
      </button>
    </header>

    <p v-if="loading" class="git-sync-preview-state">{{ t('gitPanel.loading') }}</p>
    <p v-else-if="errorMessage" class="git-sync-preview-state error" role="alert">
      {{ errorMessage }}
    </p>
    <template v-else>
      <section class="git-sync-preview-group">
        <h3><ArrowDown :size="12" />{{ t('gitPanel.incomingCommits') }}</h3>
        <p v-if="!incoming.length" class="git-sync-preview-empty">
          {{ t('gitPanel.noIncomingCommits') }}
        </p>
        <button
          v-for="commit in incoming"
          :key="`incoming-${commit.hash}`"
          type="button"
          data-testid="git-sync-incoming-row"
          class="git-sync-preview-row"
          @click="viewCommit(commit)"
        >
          <span class="git-sync-preview-subject">{{ commit.subject }}</span>
          <span class="git-sync-preview-meta"
            >{{ commit.shortHash }} · {{ commit.authorName }}</span
          >
        </button>
      </section>

      <section class="git-sync-preview-group">
        <h3><ArrowUp :size="12" />{{ t('gitPanel.outgoingCommits') }}</h3>
        <p v-if="!outgoing.length" class="git-sync-preview-empty">
          {{ t('gitPanel.noOutgoingCommits') }}
        </p>
        <button
          v-for="commit in outgoing"
          :key="`outgoing-${commit.hash}`"
          type="button"
          data-testid="git-sync-outgoing-row"
          class="git-sync-preview-row"
          @click="viewCommit(commit)"
        >
          <span class="git-sync-preview-subject">{{ commit.subject }}</span>
          <span class="git-sync-preview-meta"
            >{{ commit.shortHash }} · {{ commit.authorName }}</span
          >
        </button>
      </section>
    </template>
  </section>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { ArrowDown, ArrowUp, GitCompareArrows, X } from 'lucide-vue-next'
import { apiUrl, authFetch, getApiBase } from '../../composables/apiBase'
import { useI18n } from '../../composables/useI18n'
import { appendGitRepository, isLatestGitRequest } from '../../utils/gitPanel'
import {
  mapGitCommitEntry,
  type GitCommitEntry,
  type GitHistorySelection,
} from '../../utils/gitHistory'

const props = defineProps<{
  visible: boolean
  paneId: string
  repository?: string
}>()

const emit = defineEmits<{
  close: []
  'view-history': [selection: GitHistorySelection]
}>()

const { t } = useI18n()
const loading = ref(false)
const errorMessage = ref('')
const incoming = ref<GitCommitEntry[]>([])
const outgoing = ref<GitCommitEntry[]>([])
let syncPreviewRequestId = 0

function mapCommitList(value: unknown): GitCommitEntry[] {
  // 步骤1：逐项转换接口提交，忽略不是对象的异常记录。
  const commits: GitCommitEntry[] = []
  if (!Array.isArray(value)) return commits
  for (const rawCommit of value) {
    if (rawCommit && typeof rawCommit === 'object') {
      commits.push(mapGitCommitEntry(rawCommit as Record<string, unknown>))
    }
  }
  return commits
}

async function loadSyncPreview(): Promise<void> {
  // 步骤1：只在面板可见时读取当前仓库的上下游提交差异。
  if (!props.visible) return
  const requestId = ++syncPreviewRequestId
  const requestedRepository = props.repository || ''
  loading.value = true
  errorMessage.value = ''
  try {
    await getApiBase()
    const query = new URLSearchParams({ pane_id: props.paneId })
    appendGitRepository(query, requestedRepository)
    const response = await authFetch(apiUrl(`/api/workspace/git-sync-preview?${query}`))
    const result = await response.json().catch(function emptySyncPreviewResult() {
      return {}
    })
    if (
      !isLatestGitRequest(
        requestId,
        syncPreviewRequestId,
        requestedRepository,
        props.repository || ''
      )
    ) {
      return
    }
    if (!response.ok) {
      errorMessage.value = result.error || t('gitPanel.syncPreviewFailed')
      return
    }

    // 步骤2：分别保存传入和传出提交，保持接口顺序。
    incoming.value = mapCommitList(result.incoming)
    outgoing.value = mapCommitList(result.outgoing)
  } catch {
    if (
      isLatestGitRequest(
        requestId,
        syncPreviewRequestId,
        requestedRepository,
        props.repository || ''
      )
    ) {
      errorMessage.value = t('gitPanel.syncPreviewFailed')
    }
  } finally {
    if (
      isLatestGitRequest(
        requestId,
        syncPreviewRequestId,
        requestedRepository,
        props.repository || ''
      )
    ) {
      loading.value = false
    }
  }
}

function viewCommit(commit: GitCommitEntry): void {
  // 步骤1：把同步提交转换为现有提交详情查看器使用的选择结构。
  emit('view-history', {
    kind: 'commit',
    hash: commit.hash,
    shortHash: commit.shortHash,
    subject: commit.subject,
    authorName: commit.authorName,
    authoredAt: commit.authoredAt,
    path: null,
  })
}

watch(
  function watchSyncPreviewTarget() {
    return [props.visible, props.paneId, props.repository]
  },
  function refreshSyncPreview() {
    // 步骤1：打开面板或切换仓库时刷新同步提交。
    void loadSyncPreview()
  },
  { immediate: true }
)
</script>

<style scoped>
.git-sync-preview {
  max-height: 360px;
  overflow: auto;
  border-bottom: 1px solid var(--border);
  background: var(--bg);
}

.git-sync-preview-header,
.git-sync-preview-group h3 {
  display: flex;
  align-items: center;
}

.git-sync-preview-header {
  position: sticky;
  top: 0;
  z-index: 1;
  gap: 6px;
  min-height: 32px;
  padding: 0 7px;
  border-bottom: 1px solid var(--border);
  color: var(--fg-bright);
  background: var(--tab-bg);
  font-size: 10px;
  font-weight: 600;
}

.git-sync-preview-header span {
  flex: 1;
}

.git-sync-preview-close {
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

.git-sync-preview-close:hover,
.git-sync-preview-row:hover {
  color: var(--fg-bright);
  background: var(--bg-hover);
}

.git-sync-preview-group + .git-sync-preview-group {
  border-top: 1px solid var(--border);
}

.git-sync-preview-group h3 {
  gap: 4px;
  margin: 0;
  padding: 7px 9px;
  color: var(--fg-muted);
  font-size: 9px;
  font-weight: 600;
  text-transform: uppercase;
}

.git-sync-preview-row {
  width: 100%;
  display: grid;
  gap: 2px;
  border: 0;
  border-top: 1px solid color-mix(in srgb, var(--border) 70%, transparent);
  padding: 6px 9px;
  text-align: left;
  color: var(--fg);
  background: transparent;
  cursor: pointer;
}

.git-sync-preview-subject {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 10px;
}

.git-sync-preview-meta,
.git-sync-preview-empty,
.git-sync-preview-state {
  color: var(--fg-muted);
  font-family: var(--font-mono);
  font-size: 9px;
}

.git-sync-preview-meta {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.git-sync-preview-empty,
.git-sync-preview-state {
  margin: 0;
  padding: 9px;
}

.git-sync-preview-state.error {
  color: var(--error, #e06c75);
}
</style>
