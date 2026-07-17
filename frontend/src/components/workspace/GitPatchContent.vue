<template>
  <div v-if="loading" class="git-diff-state">{{ loadingText }}</div>
  <div v-else-if="error" class="git-diff-state error" role="alert">
    {{ error }}
  </div>
  <div v-else-if="!lines.length" class="git-diff-state">{{ emptyText }}</div>
  <div v-else class="git-diff-scroll" role="region" :aria-label="diffLabel">
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
</template>

<script setup lang="ts">
import { computed } from 'vue'

interface DiffLine {
  text: string
  type: 'meta' | 'hunk' | 'added' | 'removed' | 'context'
  oldLine: number | null
  newLine: number | null
}

const props = defineProps<{
  loading: boolean
  error: string
  patch: string
  loadingText: string
  emptyText: string
  diffLabel: string
}>()

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

@media (max-width: 640px) {
  .git-diff-line {
    grid-template-columns: 34px 34px minmax(260px, 1fr);
  }
}
</style>
