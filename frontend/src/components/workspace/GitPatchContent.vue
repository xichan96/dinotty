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
        <code>{{ line.text }}</code>
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
  </template>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Search, WrapText } from 'lucide-vue-next'

interface DiffLine {
  text: string
  type: 'meta' | 'hunk' | 'added' | 'removed' | 'context'
  oldLine: number | null
  newLine: number | null
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
  }>(),
  {
    searchPlaceholder: 'Search diff',
    loadMoreText: 'Load more lines',
    wrapText: 'Toggle line wrapping',
  }
)

const renderBatchSize = 2000
const searchText = ref('')
const wrapLines = ref(false)
const renderLimit = ref(renderBatchSize)

const lines = computed(function computeDiffLines() {
  // 步骤1：逐行解析 hunk 头，维护原文件和新文件的行号。
  const parsedLines: DiffLine[] = []
  let oldLineNumber = 0
  let newLineNumber = 0
  const patchLines = props.patch.split('\n')
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
      patchLine.startsWith('+++') ||
      patchLine.startsWith('commit ') ||
      patchLine.startsWith('Author:') ||
      patchLine.startsWith('AuthorDate:') ||
      patchLine.startsWith('Commit:') ||
      patchLine.startsWith('CommitDate:')
    ) {
      parsedLines.push({ text: patchLine, type: 'meta', oldLine: null, newLine: null })
      continue
    }

    // 步骤2：根据增删与上下文更新对应行号。
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

.git-diff-line code {
  padding: 0 12px;
  font: inherit;
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

@media (max-width: 640px) {
  .git-diff-line {
    grid-template-columns: 34px 34px minmax(260px, 1fr);
  }
}
</style>
