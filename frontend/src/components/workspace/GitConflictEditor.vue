<template>
  <section class="git-conflict-editor">
    <header class="git-conflict-header">
      <GitMerge :size="15" aria-hidden="true" />
      <div class="git-conflict-title-wrap">
        <span class="git-conflict-title">{{ fileName }}</span>
        <span class="git-conflict-path">{{ filePath }}</span>
      </div>
      <span data-testid="git-conflict-unresolved-count" class="git-conflict-count">
        {{ t('gitPanel.unresolvedConflicts').replace('{count}', String(unresolvedCount)) }}
      </span>
      <button
        type="button"
        class="git-conflict-icon-button"
        :title="t('gitPanel.openSource')"
        :aria-label="t('gitPanel.openSource')"
        @click="emit('open-source', filePath)"
      >
        <FileCode2 :size="14" />
      </button>
      <button
        type="button"
        class="git-conflict-icon-button"
        :title="t('gitPanel.refresh')"
        :aria-label="t('gitPanel.refresh')"
        @click="loadConflict"
      >
        <RefreshCw :size="14" :class="{ spinning: loading }" />
      </button>
      <button
        type="button"
        class="git-conflict-icon-button"
        :title="t('gitPanel.closeDiff')"
        :aria-label="t('gitPanel.closeDiff')"
        @click="emit('close')"
      >
        <X :size="15" />
      </button>
    </header>

    <div v-if="loading" class="git-conflict-state">{{ t('gitPanel.loadingConflict') }}</div>
    <div v-else-if="loadErrorMessage" class="git-conflict-state error" role="alert">
      {{ loadErrorMessage }}
    </div>
    <template v-else>
      <p v-if="actionErrorMessage" class="git-conflict-action-error" role="alert">
        {{ actionErrorMessage }}
      </p>
      <section class="git-conflict-sources" :aria-label="t('gitPanel.conflictSources')">
        <div class="git-conflict-source-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            :aria-selected="sourceMode === 'base'"
            :class="{ active: sourceMode === 'base' }"
            @click="sourceMode = 'base'"
          >
            {{ t('gitPanel.conflictBase') }}
          </button>
          <button
            type="button"
            role="tab"
            :aria-selected="sourceMode === 'current'"
            :class="{ active: sourceMode === 'current' }"
            @click="sourceMode = 'current'"
          >
            {{ t('gitPanel.conflictCurrent') }}
          </button>
          <button
            type="button"
            role="tab"
            :aria-selected="sourceMode === 'incoming'"
            :class="{ active: sourceMode === 'incoming' }"
            @click="sourceMode = 'incoming'"
          >
            {{ t('gitPanel.conflictIncoming') }}
          </button>
        </div>
        <pre><code>{{ activeSource }}</code></pre>
      </section>

      <section class="git-conflict-resolution" :aria-label="t('gitPanel.conflictResolution')">
        <template v-for="(segment, index) in segments" :key="index">
          <pre
            v-if="segment.type === 'text' && segment.content"
            class="git-conflict-context"
          ><code>{{ segment.content }}</code></pre>
          <article v-else-if="segment.type === 'conflict'" class="git-conflict-block">
            <header class="git-conflict-block-header">
              <span>{{
                t('gitPanel.conflictBlock').replace('{index}', String(conflictNumber(index)))
              }}</span>
              <span :class="{ resolved: segment.resolution !== 'unresolved' }">
                {{
                  segment.resolution === 'unresolved'
                    ? t('gitPanel.conflictUnresolved')
                    : t('gitPanel.conflictResolvedState')
                }}
              </span>
            </header>
            <div v-if="segment.base" class="git-conflict-base">
              <span>{{ t('gitPanel.conflictBase') }}</span>
              <pre><code>{{ segment.base }}</code></pre>
            </div>
            <div class="git-conflict-sides">
              <section>
                <h3>{{ segment.currentLabel || t('gitPanel.conflictCurrent') }}</h3>
                <pre><code>{{ segment.current }}</code></pre>
              </section>
              <section>
                <h3>{{ segment.incomingLabel || t('gitPanel.conflictIncoming') }}</h3>
                <pre><code>{{ segment.incoming }}</code></pre>
              </section>
            </div>
            <div class="git-conflict-actions">
              <button
                type="button"
                data-testid="git-conflict-accept-current"
                @click="resolveBlock(index, 'current')"
              >
                <ArrowLeft :size="13" />{{ t('gitPanel.acceptCurrentBlock') }}
              </button>
              <button type="button" @click="resolveBlock(index, 'incoming')">
                <ArrowRight :size="13" />{{ t('gitPanel.acceptIncomingBlock') }}
              </button>
              <button type="button" @click="resolveBlock(index, 'both')">
                <Columns2 :size="13" />{{ t('gitPanel.acceptBothBlock') }}
              </button>
              <button type="button" @click="resolveBlock(index, 'manual')">
                <Pencil :size="13" />{{ t('gitPanel.editConflictBlock') }}
              </button>
            </div>
            <textarea
              v-if="segment.resolution === 'manual'"
              v-model="segment.result"
              class="git-conflict-manual"
              :aria-label="t('gitPanel.editConflictBlock')"
              rows="6"
            ></textarea>
            <pre
              v-else-if="segment.resolution !== 'unresolved'"
              class="git-conflict-result"
            ><code>{{ segment.result }}</code></pre>
          </article>
        </template>
      </section>

      <footer class="git-conflict-footer">
        <span role="status">{{ statusMessage }}</span>
        <button
          type="button"
          data-testid="git-conflict-save"
          :disabled="!canSave"
          @click="saveConflict"
        >
          <Save :size="14" />{{ t('gitPanel.saveResolvedConflict') }}
        </button>
      </footer>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  ArrowLeft,
  ArrowRight,
  Columns2,
  FileCode2,
  GitMerge,
  Pencil,
  RefreshCw,
  Save,
  X,
} from 'lucide-vue-next'
import { apiUrl, authFetch, getApiBase } from '../../composables/apiBase'
import { useI18n } from '../../composables/useI18n'
import {
  buildResolvedConflictContent,
  parseConflictContent,
  type GitConflictSegment,
} from '../../utils/gitConflict'
import { appendGitRepository, getGitFileName } from '../../utils/gitPanel'

const props = defineProps<{
  paneId: string
  filePath: string
  repository?: string
}>()

const emit = defineEmits<{
  close: []
  refresh: []
  'open-source': [path: string]
}>()

const { t } = useI18n()
const loading = ref(false)
const saving = ref(false)
const loadErrorMessage = ref('')
const actionErrorMessage = ref('')
const statusMessage = ref('')
const saved = ref(false)
const baseContent = ref('')
const currentContent = ref('')
const incomingContent = ref('')
const sourceMode = ref<'base' | 'current' | 'incoming'>('base')
const segments = ref<GitConflictSegment[]>([])

const fileName = computed(function computeConflictFileName() {
  // 步骤1：标题只显示文件名，完整仓库路径放在辅助位置。
  return getGitFileName(props.filePath)
})

const activeSource = computed(function computeActiveSource() {
  // 步骤1：按三方来源标签返回完整只读内容。
  if (sourceMode.value === 'current') return currentContent.value
  if (sourceMode.value === 'incoming') return incomingContent.value
  return baseContent.value
})

const unresolvedCount = computed(function computeUnresolvedCount() {
  // 步骤1：逐块统计仍未选择解决结果的冲突。
  let count = 0
  for (const segment of segments.value) {
    if (segment.type === 'conflict' && segment.resolution === 'unresolved') count += 1
  }
  return count
})

const canSave = computed(function computeCanSave() {
  // 步骤1：加载、保存或存在未解决块时禁止写入仓库。
  return (
    !loading.value &&
    !saving.value &&
    !saved.value &&
    buildResolvedConflictContent(segments.value) !== null
  )
})

async function loadConflict(): Promise<void> {
  // 步骤1：读取当前仓库文件的三方 index 内容与带标记工作结果。
  loading.value = true
  loadErrorMessage.value = ''
  actionErrorMessage.value = ''
  statusMessage.value = ''
  saved.value = false
  try {
    await getApiBase()
    const query = new URLSearchParams({ pane_id: props.paneId, path: props.filePath })
    appendGitRepository(query, props.repository)
    const response = await authFetch(apiUrl(`/api/workspace/git-conflict-content?${query}`))
    const result = await response.json().catch(function emptyConflictResult() {
      return {}
    })
    if (!response.ok) {
      loadErrorMessage.value = result.error || t('gitPanel.conflictLoadFailed')
      return
    }

    // 步骤2：缺失的 stage 使用空文本，并把工作结果解析为可操作冲突块。
    baseContent.value = typeof result.base === 'string' ? result.base : ''
    currentContent.value = typeof result.current === 'string' ? result.current : ''
    incomingContent.value = typeof result.incoming === 'string' ? result.incoming : ''
    sourceMode.value = baseContent.value ? 'base' : 'current'
    segments.value = parseConflictContent(String(result.result || ''))
  } catch {
    loadErrorMessage.value = t('gitPanel.conflictLoadFailed')
  } finally {
    loading.value = false
  }
}

function resolveBlock(index: number, resolution: 'current' | 'incoming' | 'both' | 'manual'): void {
  // 步骤1：按用户选择生成该冲突块的最终内容，手工模式从当前内容开始。
  const segment = segments.value[index]
  if (!segment || segment.type !== 'conflict') return
  segment.resolution = resolution
  if (resolution === 'current') segment.result = segment.current
  if (resolution === 'incoming') segment.result = segment.incoming
  if (resolution === 'manual') segment.result = segment.result || segment.current
  if (resolution === 'both') {
    segment.result = segment.current
    if (
      segment.result &&
      segment.incoming &&
      !segment.result.endsWith('\n') &&
      !segment.incoming.startsWith('\n')
    ) {
      segment.result += '\n'
    }
    segment.result += segment.incoming
  }
}

function conflictNumber(segmentIndex: number): number {
  // 步骤1：只计算当前位置之前的冲突块，普通文本段不占编号。
  let number = 0
  for (let index = 0; index <= segmentIndex; index += 1) {
    if (segments.value[index]?.type === 'conflict') number += 1
  }
  return number
}

async function saveConflict(): Promise<void> {
  // 步骤1：再次构建完整内容，未解决时不发送写请求。
  const content = buildResolvedConflictContent(segments.value)
  if (content === null || saving.value) return
  saving.value = true
  actionErrorMessage.value = ''
  try {
    await getApiBase()
    const query = new URLSearchParams({ pane_id: props.paneId })
    appendGitRepository(query, props.repository)
    const response = await authFetch(apiUrl(`/api/workspace/git-conflict-save?${query}`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: props.filePath, content }),
    })
    const result = await response.json().catch(function emptyConflictSaveResult() {
      return {}
    })
    if (!response.ok) {
      actionErrorMessage.value = result.error || t('gitPanel.conflictSaveFailed')
      return
    }
    statusMessage.value = t('gitPanel.conflictSaved')
    saved.value = true
    emit('refresh')
  } catch {
    actionErrorMessage.value = t('gitPanel.conflictSaveFailed')
  } finally {
    saving.value = false
  }
}

watch(
  function watchConflictTarget() {
    return [props.paneId, props.repository, props.filePath]
  },
  function reloadConflictTarget() {
    void loadConflict()
  },
  { immediate: true }
)
</script>

<style scoped>
.git-conflict-editor {
  height: 100%;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  color: var(--fg);
  background: var(--bg);
}

.git-conflict-header {
  min-height: 40px;
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 0 7px 0 11px;
  border-bottom: 1px solid var(--border);
  background: var(--tab-bg);
}

.git-conflict-title-wrap {
  min-width: 0;
  flex: 1;
  display: flex;
  align-items: baseline;
  gap: 7px;
}

.git-conflict-title,
.git-conflict-path {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.git-conflict-title {
  color: var(--fg-bright);
  font-size: 12px;
  font-weight: 600;
}

.git-conflict-path,
.git-conflict-count {
  color: var(--fg-muted);
  font-size: 9px;
}

.git-conflict-count {
  flex: 0 0 auto;
}

.git-conflict-icon-button {
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

.git-conflict-icon-button:hover,
.git-conflict-icon-button:focus-visible {
  color: var(--fg-bright);
  background: var(--bg-hover);
  outline: 1px solid var(--accent);
  outline-offset: -1px;
}

.git-conflict-state {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  color: var(--fg-muted);
  font-size: 11px;
}

.git-conflict-state.error {
  color: var(--color-red, #e06c75);
}

.git-conflict-action-error {
  margin: 0;
  padding: 6px 9px;
  border-bottom: 1px solid color-mix(in srgb, var(--color-red, #e06c75) 45%, var(--border));
  color: var(--color-red, #e06c75);
  background: color-mix(in srgb, var(--color-red, #e06c75) 9%, var(--bg));
  font-size: 10px;
}

.git-conflict-sources {
  flex: 0 0 30%;
  min-height: 120px;
  display: flex;
  flex-direction: column;
  border-bottom: 1px solid var(--border);
}

.git-conflict-source-tabs {
  min-height: 31px;
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  padding: 3px 6px;
  border-bottom: 1px solid var(--border);
  background: var(--tab-bg);
}

.git-conflict-source-tabs button {
  border: 0;
  border-bottom: 2px solid transparent;
  color: var(--fg-muted);
  background: transparent;
  cursor: pointer;
  font-size: 10px;
}

.git-conflict-source-tabs button:hover,
.git-conflict-source-tabs button:focus-visible,
.git-conflict-source-tabs button.active {
  color: var(--fg-bright);
  background: var(--bg-hover);
  outline: none;
}

.git-conflict-source-tabs button.active {
  border-bottom-color: var(--accent);
}

.git-conflict-sources pre,
.git-conflict-resolution pre {
  margin: 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font: 11px/18px var(--font-mono);
}

.git-conflict-sources > pre {
  min-height: 0;
  flex: 1;
  overflow: auto;
  padding: 9px 12px;
}

.git-conflict-resolution {
  min-height: 0;
  flex: 1;
  overflow: auto;
  padding: 8px;
}

.git-conflict-context {
  padding: 4px 8px;
  color: var(--fg-muted);
}

.git-conflict-block {
  margin: 6px 0;
  border: 1px solid color-mix(in srgb, var(--color-red, #e06c75) 55%, var(--border));
  border-radius: 4px;
  overflow: hidden;
  background: var(--bg-surface);
}

.git-conflict-block-header {
  min-height: 29px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 8px;
  color: var(--fg-muted);
  background: var(--tab-bg);
  font-size: 9px;
}

.git-conflict-block-header .resolved {
  color: var(--color-green, #62b478);
}

.git-conflict-base {
  padding: 5px 8px;
  border-top: 1px solid var(--border);
  border-bottom: 1px solid var(--border);
  color: var(--fg-muted);
  font-size: 9px;
}

.git-conflict-base pre {
  margin-top: 3px;
}

.git-conflict-sides {
  display: grid;
  grid-template-columns: 1fr 1fr;
}

.git-conflict-sides section {
  min-width: 0;
}

.git-conflict-sides section + section {
  border-left: 1px solid var(--border);
}

.git-conflict-sides h3 {
  margin: 0;
  padding: 5px 8px;
  color: var(--fg-muted);
  background: var(--tab-bg);
  font-size: 9px;
  font-weight: 500;
}

.git-conflict-sides pre,
.git-conflict-result {
  min-height: 54px;
  padding: 7px 8px;
}

.git-conflict-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  padding: 5px 7px;
  border-top: 1px solid var(--border);
  border-bottom: 1px solid var(--border);
  background: var(--tab-bg);
}

.git-conflict-actions button,
.git-conflict-footer button {
  min-height: 27px;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 0 7px;
  border: 1px solid var(--border);
  border-radius: 3px;
  color: var(--fg);
  background: var(--bg);
  cursor: pointer;
  font-size: 9px;
}

.git-conflict-actions button:hover,
.git-conflict-actions button:focus-visible,
.git-conflict-footer button:hover:not(:disabled),
.git-conflict-footer button:focus-visible:not(:disabled) {
  border-color: var(--accent);
  background: var(--bg-hover);
  outline: none;
}

.git-conflict-result {
  color: var(--color-green, #62b478);
  background: color-mix(in srgb, var(--color-green, #62b478) 8%, var(--bg));
}

.git-conflict-manual {
  width: 100%;
  min-height: 110px;
  resize: vertical;
  padding: 7px 8px;
  border: 0;
  color: var(--fg);
  background: var(--bg);
  outline: none;
  font: 11px/18px var(--font-mono);
}

.git-conflict-manual:focus {
  box-shadow: inset 0 0 0 1px var(--accent);
}

.git-conflict-footer {
  min-height: 42px;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
  padding: 6px 9px;
  border-top: 1px solid var(--border);
  color: var(--fg-muted);
  background: var(--tab-bg);
  font-size: 9px;
}

.git-conflict-footer span {
  min-width: 0;
  flex: 1;
}

.git-conflict-footer button:disabled {
  cursor: default;
  opacity: 0.45;
}

.spinning {
  animation: git-conflict-spin 0.8s linear infinite;
}

@keyframes git-conflict-spin {
  to {
    transform: rotate(360deg);
  }
}

@media (max-width: 700px) {
  .git-conflict-path,
  .git-conflict-count {
    display: none;
  }

  .git-conflict-sides {
    grid-template-columns: 1fr;
  }

  .git-conflict-sides section + section {
    border-top: 1px solid var(--border);
    border-left: 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  .spinning {
    animation: none;
  }
}
</style>
