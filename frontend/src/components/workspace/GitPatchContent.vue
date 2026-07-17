<template>
  <div v-if="loading" class="git-diff-state">{{ loadingText }}</div>
  <div v-else-if="error" class="git-diff-state error" role="alert">
    {{ error }}
  </div>
  <div v-else-if="!lines.length" class="git-diff-state">{{ emptyText }}</div>
  <template v-else>
    <div class="git-diff-toolbar">
      <label class="git-diff-search">
        <Search :size="13" aria-hidden="true" />
        <input
          v-model="searchText"
          data-testid="git-diff-search"
          type="search"
          :placeholder="searchPlaceholder"
        />
      </label>
      <span data-testid="git-diff-stats" class="git-diff-stats">
        <span class="added">+{{ addedCount }}</span>
        <span class="removed">-{{ removedCount }}</span>
      </span>
      <span class="git-diff-view-modes">
        <button
          type="button"
          data-testid="git-diff-inline-view"
          class="git-diff-toolbar-button"
          :class="{ active: viewMode === 'inline' }"
          :title="inlineViewText"
          :aria-label="inlineViewText"
          :aria-pressed="viewMode === 'inline'"
          @click="viewMode = 'inline'"
        >
          <Rows3 :size="14" />
        </button>
        <button
          type="button"
          data-testid="git-diff-split-view"
          class="git-diff-toolbar-button"
          :class="{ active: viewMode === 'split' }"
          :title="splitViewText"
          :aria-label="splitViewText"
          :aria-pressed="viewMode === 'split'"
          @click="viewMode = 'split'"
        >
          <Columns2 :size="14" />
        </button>
      </span>
      <button
        type="button"
        class="git-diff-toolbar-button"
        :class="{ active: wrapLines }"
        :title="wrapText"
        :aria-label="wrapText"
        @click="wrapLines = !wrapLines"
      >
        <WrapText :size="14" />
      </button>
    </div>
    <div
      v-if="viewMode === 'inline'"
      class="git-diff-scroll"
      :class="{ 'wrap-lines': wrapLines }"
      role="region"
      :aria-label="diffLabel"
    >
      <div
        v-for="(line, index) in renderedLines"
        :key="`${index}:${line.text}`"
        class="git-diff-line"
        :class="`git-diff-line-${line.type}`"
      >
        <span class="git-diff-line-number">{{ line.oldLine || '' }}</span>
        <span class="git-diff-line-number">{{ line.newLine || '' }}</span>
        <span class="git-diff-code-wrap">
          <code>{{ line.text }}</code>
          <span v-if="line.type === 'hunk'" class="git-diff-hunk-actions">
            <button
              v-if="canStageHunks"
              type="button"
              data-testid="git-diff-stage-hunk"
              :title="stageHunkText"
              :aria-label="stageHunkText"
              :disabled="hunkActionBusy"
              @click="emitHunkAction(line.hunkIndex, 'stage')"
            >
              <ListPlus :size="13" />
            </button>
            <button
              v-if="canUnstageHunks"
              type="button"
              data-testid="git-diff-unstage-hunk"
              :title="unstageHunkText"
              :aria-label="unstageHunkText"
              :disabled="hunkActionBusy"
              @click="emitHunkAction(line.hunkIndex, 'unstage')"
            >
              <ListMinus :size="13" />
            </button>
            <button
              v-if="canDiscardHunks"
              type="button"
              data-testid="git-diff-discard-hunk"
              class="danger"
              :title="discardHunkText"
              :aria-label="discardHunkText"
              :disabled="hunkActionBusy"
              @click="emitHunkAction(line.hunkIndex, 'discard')"
            >
              <Undo2 :size="13" />
            </button>
          </span>
        </span>
      </div>
      <button
        v-if="hasMoreLines"
        type="button"
        data-testid="git-diff-load-more"
        class="git-diff-load-more"
        @click="renderLimit += renderBatchSize"
      >
        {{ loadMoreText }} ({{ filteredLines.length - renderedLines.length }})
      </button>
    </div>
    <div
      v-else
      class="git-diff-scroll git-diff-split-scroll"
      :class="{ 'wrap-lines': wrapLines }"
      role="region"
      :aria-label="diffLabel"
    >
      <div
        v-for="(row, index) in splitRows"
        :key="`${index}:${row.headerText || row.oldLine?.text || row.newLine?.text || ''}`"
        class="git-diff-split-row"
        :class="`git-diff-split-row-${row.kind}`"
      >
        <template v-if="row.kind === 'meta' || row.kind === 'hunk'">
          <span class="git-diff-split-header">
            <code>{{ row.headerText }}</code>
            <span v-if="row.kind === 'hunk'" class="git-diff-hunk-actions">
              <button
                v-if="canStageHunks"
                type="button"
                data-testid="git-diff-stage-hunk"
                :title="stageHunkText"
                :aria-label="stageHunkText"
                :disabled="hunkActionBusy"
                @click="emitHunkAction(row.hunkIndex, 'stage')"
              >
                <ListPlus :size="13" />
              </button>
              <button
                v-if="canUnstageHunks"
                type="button"
                data-testid="git-diff-unstage-hunk"
                :title="unstageHunkText"
                :aria-label="unstageHunkText"
                :disabled="hunkActionBusy"
                @click="emitHunkAction(row.hunkIndex, 'unstage')"
              >
                <ListMinus :size="13" />
              </button>
              <button
                v-if="canDiscardHunks"
                type="button"
                data-testid="git-diff-discard-hunk"
                class="danger"
                :title="discardHunkText"
                :aria-label="discardHunkText"
                :disabled="hunkActionBusy"
                @click="emitHunkAction(row.hunkIndex, 'discard')"
              >
                <Undo2 :size="13" />
              </button>
            </span>
          </span>
        </template>
        <template v-else>
          <span
            class="git-diff-split-side git-diff-split-old"
            :class="`git-diff-split-side-${row.oldLine?.type || 'empty'}`"
          >
            <span class="git-diff-line-number">{{ row.oldLine?.oldLine || '' }}</span>
            <code>{{ row.oldLine?.text || '' }}</code>
          </span>
          <span
            class="git-diff-split-side git-diff-split-new"
            :class="`git-diff-split-side-${row.newLine?.type || 'empty'}`"
          >
            <span class="git-diff-line-number">{{ row.newLine?.newLine || '' }}</span>
            <code>{{ row.newLine?.text || '' }}</code>
          </span>
        </template>
      </div>
    </div>
  </template>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Columns2, ListMinus, ListPlus, Rows3, Search, Undo2, WrapText } from 'lucide-vue-next'

interface DiffLine {
  text: string
  type: 'meta' | 'hunk' | 'added' | 'removed' | 'context'
  oldLine: number | null
  newLine: number | null
  hunkIndex: number | null
}

interface SplitDiffRow {
  kind: 'meta' | 'hunk' | 'content'
  headerText: string
  hunkIndex: number | null
  oldLine: DiffLine | null
  newLine: DiffLine | null
}

const props = withDefaults(
  defineProps<{
    loading: boolean
    error: string
    patch: string
    loadingText: string
    emptyText: string
    diffLabel: string
    searchPlaceholder?: string
    loadMoreText?: string
    wrapText?: string
    inlineViewText?: string
    splitViewText?: string
    stageHunkText?: string
    unstageHunkText?: string
    discardHunkText?: string
    canStageHunks?: boolean
    canUnstageHunks?: boolean
    canDiscardHunks?: boolean
    hunkActionBusy?: boolean
  }>(),
  {
    searchPlaceholder: 'Search diff',
    loadMoreText: 'Load more lines',
    wrapText: 'Toggle line wrapping',
    inlineViewText: 'Inline view',
    splitViewText: 'Side by side view',
    stageHunkText: 'Stage hunk',
    unstageHunkText: 'Unstage hunk',
    discardHunkText: 'Discard hunk',
    canStageHunks: false,
    canUnstageHunks: false,
    canDiscardHunks: false,
    hunkActionBusy: false,
  }
)

const emit = defineEmits<{
  'hunk-action': [hunkIndex: number, action: 'stage' | 'unstage' | 'discard']
}>()

const renderBatchSize = 2000
const searchText = ref('')
const wrapLines = ref(false)
const viewMode = ref<'inline' | 'split'>('inline')
const renderLimit = ref(renderBatchSize)

const lines = computed(function computeDiffLines() {
  // 步骤1：逐行解析 hunk 头，维护原文件和新文件的行号。
  const parsedLines: DiffLine[] = []
  let oldLineNumber = 0
  let newLineNumber = 0
  let currentHunkIndex = -1
  const patchLines = props.patch.split('\n')
  for (const patchLine of patchLines) {
    if (patchLine.startsWith('@@')) {
      currentHunkIndex += 1
      const match = /@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(patchLine)
      if (match) {
        oldLineNumber = Number(match[1])
        newLineNumber = Number(match[2])
      }
      parsedLines.push({
        text: patchLine,
        type: 'hunk',
        oldLine: null,
        newLine: null,
        hunkIndex: currentHunkIndex,
      })
      continue
    }
    if (
      patchLine.startsWith('diff --git') ||
      patchLine.startsWith('index ') ||
      patchLine.startsWith('---') ||
      patchLine.startsWith('+++') ||
      patchLine.startsWith('commit ') ||
      patchLine.startsWith('Author:') ||
      patchLine.startsWith('AuthorDate:') ||
      patchLine.startsWith('Commit:') ||
      patchLine.startsWith('CommitDate:')
    ) {
      parsedLines.push({
        text: patchLine,
        type: 'meta',
        oldLine: null,
        newLine: null,
        hunkIndex: null,
      })
      continue
    }

    // 步骤2：根据增删与上下文更新对应行号。
    if (patchLine.startsWith('+')) {
      parsedLines.push({
        text: patchLine,
        type: 'added',
        oldLine: null,
        newLine: newLineNumber,
        hunkIndex: currentHunkIndex,
      })
      newLineNumber += 1
    } else if (patchLine.startsWith('-')) {
      parsedLines.push({
        text: patchLine,
        type: 'removed',
        oldLine: oldLineNumber,
        newLine: null,
        hunkIndex: currentHunkIndex,
      })
      oldLineNumber += 1
    } else {
      parsedLines.push({
        text: patchLine,
        type: 'context',
        oldLine: oldLineNumber || null,
        newLine: newLineNumber || null,
        hunkIndex: currentHunkIndex >= 0 ? currentHunkIndex : null,
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

const addedCount = computed(function computeAddedCount() {
  // 步骤1：统计完整 Patch 中的新增行，不受搜索条件影响。
  let count = 0
  for (const line of lines.value) {
    if (line.type === 'added') count += 1
  }
  return count
})

const removedCount = computed(function computeRemovedCount() {
  // 步骤1：统计完整 Patch 中的删除行，不受搜索条件影响。
  let count = 0
  for (const line of lines.value) {
    if (line.type === 'removed') count += 1
  }
  return count
})

const filteredLines = computed(function computeFilteredLines() {
  // 步骤1：空搜索显示完整 Patch，其他情况逐行执行不区分大小写匹配。
  const search = searchText.value.trim().toLocaleLowerCase()
  if (!search) return lines.value
  const result: DiffLine[] = []
  for (const line of lines.value) {
    if (line.text.toLocaleLowerCase().includes(search)) {
      result.push(line)
    }
  }
  return result
})

const renderedLines = computed(function computeRenderedLines() {
  // 步骤1：每次只把固定批次行数交给浏览器渲染，避免大 Patch 阻塞界面。
  return filteredLines.value.slice(0, renderLimit.value)
})

const hasMoreLines = computed(function computeHasMoreLines() {
  // 步骤1：仍有未渲染行时显示加载更多按钮。
  return renderedLines.value.length < filteredLines.value.length
})

const splitRows = computed(function computeSplitRows() {
  // 步骤1：把删除和紧随其后的新增行组成左右对齐的修改块。
  const rows: SplitDiffRow[] = []
  let lineIndex = 0
  while (lineIndex < renderedLines.value.length) {
    const line = renderedLines.value[lineIndex]
    if (line.type === 'meta' || line.type === 'hunk') {
      rows.push({
        kind: line.type,
        headerText: line.text,
        hunkIndex: line.hunkIndex,
        oldLine: null,
        newLine: null,
      })
      lineIndex += 1
      continue
    }

    if (line.type === 'removed') {
      const removedLines: DiffLine[] = []
      const addedLines: DiffLine[] = []
      while (
        lineIndex < renderedLines.value.length &&
        renderedLines.value[lineIndex].type === 'removed'
      ) {
        removedLines.push(renderedLines.value[lineIndex])
        lineIndex += 1
      }
      while (
        lineIndex < renderedLines.value.length &&
        renderedLines.value[lineIndex].type === 'added'
      ) {
        addedLines.push(renderedLines.value[lineIndex])
        lineIndex += 1
      }
      const rowCount = Math.max(removedLines.length, addedLines.length)
      for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
        rows.push({
          kind: 'content',
          headerText: '',
          hunkIndex: line.hunkIndex,
          oldLine: removedLines[rowIndex] || null,
          newLine: addedLines[rowIndex] || null,
        })
      }
      continue
    }

    // 步骤2：纯新增行只放在右侧，上下文行同时显示在两侧。
    if (line.type === 'added') {
      rows.push({
        kind: 'content',
        headerText: '',
        hunkIndex: line.hunkIndex,
        oldLine: null,
        newLine: line,
      })
    } else {
      rows.push({
        kind: 'content',
        headerText: '',
        hunkIndex: line.hunkIndex,
        oldLine: line,
        newLine: line,
      })
    }
    lineIndex += 1
  }
  return rows
})

function emitHunkAction(hunkIndex: number | null, action: 'stage' | 'unstage' | 'discard'): void {
  // 步骤1：只有解析成功的真实 hunk 才能触发仓库修改。
  if (hunkIndex === null || props.hunkActionBusy) return
  emit('hunk-action', hunkIndex, action)
}

watch(
  function watchPatchFilter() {
    return [props.patch, searchText.value]
  },
  function resetRenderLimit() {
    // 步骤1：Patch 或搜索变化后从首批行重新开始渲染。
    renderLimit.value = renderBatchSize
  }
)
</script>

<style scoped>
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

.git-diff-toolbar {
  min-height: 34px;
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 4px 7px;
  border-bottom: 1px solid var(--border);
  background: var(--tab-bg);
}

.git-diff-search {
  min-width: 0;
  flex: 1;
  height: 25px;
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 0 7px;
  border: 1px solid var(--border);
  border-radius: 3px;
  color: var(--fg-muted);
  background: var(--bg);
}

.git-diff-search:focus-within {
  border-color: var(--accent);
}

.git-diff-search input {
  min-width: 0;
  flex: 1;
  border: 0;
  color: var(--fg);
  background: transparent;
  font-size: 10px;
  outline: none;
}

.git-diff-stats {
  display: inline-flex;
  gap: 6px;
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 600;
}

.git-diff-stats .added {
  color: var(--color-green, #62b478);
}

.git-diff-stats .removed {
  color: var(--color-red, #e06c75);
}

.git-diff-view-modes {
  display: inline-flex;
  border: 1px solid var(--border);
  border-radius: 3px;
  overflow: hidden;
}

.git-diff-view-modes .git-diff-toolbar-button {
  border-radius: 0;
}

.git-diff-view-modes .git-diff-toolbar-button + .git-diff-toolbar-button {
  border-left: 1px solid var(--border);
}

.git-diff-toolbar-button {
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

.git-diff-toolbar-button:hover,
.git-diff-toolbar-button:focus-visible,
.git-diff-toolbar-button.active {
  color: var(--fg-bright);
  background: var(--bg-hover);
  outline: 1px solid var(--accent);
  outline-offset: -1px;
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

.git-diff-code-wrap {
  min-width: 0;
  display: flex;
  align-items: center;
}

.git-diff-code-wrap code {
  min-width: 0;
  flex: 1;
  padding: 0 12px;
  font: inherit;
}

.git-diff-hunk-actions {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 0 6px;
}

.git-diff-hunk-actions button {
  width: 24px;
  height: 22px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 3px;
  color: var(--fg-muted);
  background: color-mix(in srgb, var(--bg) 78%, transparent);
  cursor: pointer;
}

.git-diff-hunk-actions button:hover,
.git-diff-hunk-actions button:focus-visible {
  color: var(--fg-bright);
  background: var(--bg-hover);
  outline: 1px solid var(--accent);
  outline-offset: -1px;
}

.git-diff-hunk-actions button.danger:hover,
.git-diff-hunk-actions button.danger:focus-visible {
  color: var(--color-red, #e06c75);
  outline-color: var(--color-red, #e06c75);
}

.git-diff-hunk-actions button:disabled {
  cursor: wait;
  opacity: 0.45;
}

.git-diff-scroll.wrap-lines .git-diff-line {
  min-width: 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.git-diff-load-more {
  width: calc(100% - 16px);
  min-height: 29px;
  margin: 8px;
  border: 1px solid var(--border);
  border-radius: 3px;
  color: var(--fg);
  background: var(--tab-bg);
  cursor: pointer;
  font-size: 10px;
}

.git-diff-load-more:hover,
.git-diff-load-more:focus-visible {
  border-color: var(--accent);
  background: var(--bg-hover);
  outline: none;
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

.git-diff-split-scroll {
  min-width: 0;
}

.git-diff-split-row {
  min-width: 720px;
  display: grid;
  grid-template-columns: minmax(360px, 1fr) minmax(360px, 1fr);
  border-bottom: 1px solid color-mix(in srgb, var(--border) 35%, transparent);
}

.git-diff-split-header {
  grid-column: 1 / -1;
  min-height: 20px;
  display: flex;
  align-items: center;
  color: var(--fg-muted);
}

.git-diff-split-header code {
  min-width: 0;
  flex: 1;
  padding: 0 12px;
  font: inherit;
}

.git-diff-split-row-hunk .git-diff-split-header {
  color: #82aaff;
  background: color-mix(in srgb, #1976d2 17%, transparent);
}

.git-diff-split-side {
  min-width: 0;
  display: grid;
  grid-template-columns: 48px minmax(280px, 1fr);
  min-height: 20px;
}

.git-diff-split-side + .git-diff-split-side {
  border-left: 1px solid var(--border);
}

.git-diff-split-side code {
  min-width: 0;
  padding: 0 12px;
  font: inherit;
}

.git-diff-split-side-removed {
  background: color-mix(in srgb, #d94f4f 18%, transparent);
}

.git-diff-split-side-added {
  background: color-mix(in srgb, #2ea043 18%, transparent);
}

.git-diff-split-side-empty {
  background: color-mix(in srgb, var(--tab-bg) 70%, transparent);
}

.git-diff-split-scroll.wrap-lines .git-diff-split-side code {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

@media (max-width: 640px) {
  .git-diff-line {
    grid-template-columns: 34px 34px minmax(260px, 1fr);
  }

  .git-diff-split-row {
    min-width: 600px;
    grid-template-columns: minmax(300px, 1fr) minmax(300px, 1fr);
  }

  .git-diff-split-side {
    grid-template-columns: 34px minmax(250px, 1fr);
  }
}
</style>
