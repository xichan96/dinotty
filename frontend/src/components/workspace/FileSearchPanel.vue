<template>
  <div class="file-search">
    <div class="search-box">
      <input
        ref="inputEl"
        v-model="search.query.value"
        class="search-input"
        type="text"
        spellcheck="false"
        autocomplete="off"
        :placeholder="t('workspaceSearch.placeholder')"
        @input="onInput"
        @keydown.enter.prevent="runNow"
        @keydown.esc.prevent="$emit('close')"
      />
      <div class="search-toggles" role="group" :aria-label="t('workspaceSearch.options')">
        <button
          type="button"
          class="search-toggle"
          :class="{ on: search.caseSensitive.value }"
          :title="t('workspaceSearch.caseSensitive')"
          :aria-pressed="search.caseSensitive.value"
          @click="toggle('case')"
        >
          Aa
        </button>
        <button
          type="button"
          class="search-toggle"
          :class="{ on: search.word.value }"
          :title="t('workspaceSearch.wholeWord')"
          :aria-pressed="search.word.value"
          @click="toggle('word')"
        >
          ab
        </button>
        <button
          type="button"
          class="search-toggle"
          :class="{ on: search.regex.value }"
          :title="t('workspaceSearch.regex')"
          :aria-pressed="search.regex.value"
          @click="toggle('regex')"
        >
          .*
        </button>
      </div>
    </div>

    <div v-if="search.isActive.value && !search.loading.value" class="search-summary">
      <template v-if="search.error.value">{{ errorText }}</template>
      <template v-else-if="search.totalMatches.value">
        {{
          t('workspaceSearch.resultsSummary', {
            count: search.totalMatches.value,
            files: search.files.value.length,
          })
        }}
        <span v-if="search.truncated.value">{{ t('workspaceSearch.resultsCapped') }}</span>
      </template>
      <template v-else-if="!search.hasResults.value">{{ t('workspaceSearch.noResults') }}</template>
    </div>

    <div v-if="search.isActive.value" class="search-results">
      <div v-if="search.loading.value" class="search-state">{{ t('workspaceSearch.searching') }}</div>
      <div v-else-if="search.error.value" class="search-state error">{{ errorText }}</div>
      <div v-else-if="!search.hasResults.value" class="search-state">
        {{ t('workspaceSearch.noResults') }}
      </div>
      <template v-else>
        <div v-for="file in search.files.value" :key="file.path" class="search-file-group">
          <button
            type="button"
            class="search-file"
            :title="file.path"
            @click="open(file, file.matches[0])"
          >
            <FileGlyph :path="file.path" :size="15" />
            <span class="sf-name">{{ file.name }}</span>
            <span class="sf-path">{{ file.dir }}</span>
            <span class="sf-count">{{ file.count }}</span>
          </button>
          <button
            v-for="match in file.matches.slice(0, MAX_ROWS)"
            :key="`${match.line}:${match.column}`"
            type="button"
            class="search-match"
            @click="open(file, match)"
          >
            <span class="sm-ln">{{ match.line }}</span>
            <span class="sm-snippet">
              <template v-for="(segment, idx) in segments(match.line_text)" :key="idx">
                <mark v-if="segment.hit">{{ segment.text }}</mark>
                <template v-else>{{ segment.text }}</template>
              </template>
            </span>
          </button>
          <div v-if="file.matches.length > MAX_ROWS" class="search-more">
            {{ t('workspaceSearch.moreMatches', { count: file.matches.length - MAX_ROWS }) }}
          </div>
          <div v-else-if="file.count > file.matches.length" class="search-more">
            {{
              t('workspaceSearch.moreMatchesOnLines', {
                count: file.count - file.matches.length,
              })
            }}
          </div>
        </div>
      </template>
    </div>

    <div v-else class="search-hint">
      <div>{{ t('workspaceSearch.hint') }}</div>
      <div class="search-examples">
        <button
          v-for="example in EXAMPLES"
          :key="example"
          type="button"
          class="search-example"
          @click="useExample(example)"
        >
          {{ example }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from '../../composables/useI18n'
import {
  useWorkspaceSearch,
  type WorkspaceSearchFile,
  type WorkspaceSearchMatch,
} from '../../composables/useWorkspaceSearch'
import FileGlyph from './FileGlyph.vue'

const props = defineProps<{
  paneId: string
  isSsh: boolean
}>()

const emit = defineEmits<{
  'open-file': [rel: string, line: number]
  close: []
}>()

const { t } = useI18n()
const inputEl = ref<HTMLInputElement | null>(null)
const MAX_ROWS = 6
const EXAMPLES = ['function', 'import', 'TODO']

const search = useWorkspaceSearch({
  paneId: () => props.paneId,
  isSsh: () => props.isSsh,
})

const errorText = computed(() => {
  switch (search.error.value) {
    case 'rgMissing':
      return t('workspaceSearch.rgMissing')
    case 'invalidRegex':
      return t('workspaceSearch.invalidRegex')
    case 'sshUnsupported':
      return t('workspaceSearch.sshUnsupported')
    case 'timeout':
      return t('workspaceSearch.timeout')
    case 'network':
      return t('workspaceSearch.networkError')
    default:
      return t('workspaceSearch.unknownError')
  }
})

let highlightRegex: RegExp | null = null
let highlightKey = ''

function buildHighlightRegex(): RegExp | null {
  const text = search.query.value.trim()
  const key = `${text}|${search.caseSensitive.value}|${search.word.value}|${search.regex.value}`
  if (key === highlightKey) return highlightRegex
  highlightKey = key
  highlightRegex = null
  if (!text) return null
  let pattern = search.regex.value ? text : text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  if (search.word.value) pattern = `\\b(?:${pattern})\\b`
  try {
    highlightRegex = new RegExp(pattern, `g${search.caseSensitive.value ? '' : 'i'}`)
  } catch {
    highlightRegex = null
  }
  return highlightRegex
}

interface Segment {
  text: string
  hit: boolean
}

function segments(line: string): Segment[] {
  const regex = buildHighlightRegex()
  if (!regex) return [{ text: line, hit: false }]
  const out: Segment[] = []
  let last = 0
  regex.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = regex.exec(line))) {
    if (match.index > last) out.push({ text: line.slice(last, match.index), hit: false })
    out.push({ text: match[0], hit: true })
    last = match.index + match[0].length
    if (!match[0].length) regex.lastIndex++
  }
  if (last < line.length) out.push({ text: line.slice(last), hit: false })
  return out.length ? out : [{ text: line, hit: false }]
}

function onInput() {
  search.scheduleSearch()
}

function runNow() {
  search.cancelPending()
  void search.search()
}

function toggle(option: 'case' | 'word' | 'regex') {
  if (option === 'case') search.caseSensitive.value = !search.caseSensitive.value
  if (option === 'word') search.word.value = !search.word.value
  if (option === 'regex') search.regex.value = !search.regex.value
  highlightKey = ''
  search.scheduleSearch(0)
}

function useExample(example: string) {
  search.query.value = example
  runNow()
  inputEl.value?.focus()
}

function open(_file: WorkspaceSearchFile, match: WorkspaceSearchMatch | undefined) {
  if (!match) return
  emit('open-file', match.file_path, match.line)
}

function focusInput() {
  inputEl.value?.focus()
  inputEl.value?.select()
}

onMounted(focusInput)
onBeforeUnmount(() => search.cancelPending())

defineExpose({ focusInput, clear: search.clear, hasQuery: search.isActive })
</script>

<style scoped>
.file-search {
  display: flex;
  flex-direction: column;
  min-height: 0;
  /* The explorer header sits above the panel inside the same scroll box. */
  height: calc(100% - var(--tree-head-h, 30px));
}

.search-box {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  flex-shrink: 0;
  /* The explorer header is sticky above this panel; keep the input and its
     option toggles below it while the results scroll underneath. */
  position: sticky;
  top: var(--tree-head-h, 30px);
  z-index: 3;
  background: var(--bg, #1a1a1a);
}

.search-input {
  flex: 1;
  min-width: 0;
  height: 24px;
  padding: 2px 7px;
  border: 1px solid var(--border, #3c3c3c);
  border-radius: 3px;
  background: var(--bg-input, #1e1e1e);
  color: var(--fg, #ccc);
  font: inherit;
  font-size: 12px;
  outline: none;
}

.search-input:focus {
  border-color: var(--accent, #4d80ff);
}

.search-toggles {
  display: flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
}

.search-toggle {
  width: 22px;
  height: 22px;
  padding: 0;
  border: 1px solid transparent;
  border-radius: 3px;
  background: transparent;
  color: var(--fg-muted, #9a9a9a);
  font: inherit;
  font-size: 10.5px;
  line-height: 1;
  cursor: pointer;
}

.search-toggle:hover {
  background: var(--tab-hover-bg, #333);
  color: var(--fg, #ddd);
}

.search-toggle.on {
  border-color: var(--accent, #4d80ff);
  background: rgba(77, 128, 255, 0.16);
  color: var(--fg, #e6e6e6);
}

.search-summary {
  flex-shrink: 0;
  padding: 0 10px 6px;
  color: var(--fg-muted, #8a8a8a);
  font-size: 11px;
}

.search-results {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding-bottom: 12px;
}

.search-state {
  padding: 12px 10px;
  color: var(--fg-muted, #8a8a8a);
  font-size: 12px;
}

.search-state.error {
  color: #f48771;
}

.search-file-group {
  margin-bottom: 2px;
}

.search-file {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  height: 24px;
  padding: 0 8px;
  border: 0;
  background: transparent;
  color: var(--fg, #cfcfcf);
  font: inherit;
  font-size: 12px;
  text-align: left;
  cursor: pointer;
}

.search-file:hover {
  background: var(--tab-hover-bg, #2a2d2e);
}

.sf-name {
  flex-shrink: 0;
}

.sf-path {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--fg-muted, #7f7f7f);
  font-size: 10.5px;
}

.sf-count {
  margin-left: auto;
  flex-shrink: 0;
  min-width: 18px;
  padding: 0 5px;
  border-radius: 9px;
  background: rgba(255, 255, 255, 0.08);
  color: #b8b8b8;
  font-size: 10.5px;
  line-height: 16px;
  text-align: center;
}

.search-match {
  display: flex;
  align-items: baseline;
  gap: 8px;
  width: 100%;
  height: 22px;
  padding: 0 8px 0 22px;
  border: 0;
  background: transparent;
  color: var(--fg, #cfcfcf);
  font: inherit;
  font-family: var(--font-mono, ui-monospace, Menlo, monospace);
  font-size: 11.5px;
  text-align: left;
  white-space: pre;
  overflow: hidden;
  cursor: pointer;
}

.search-match:hover {
  background: var(--tab-hover-bg, #2a2d2e);
}

.sm-ln {
  flex-shrink: 0;
  min-width: 28px;
  text-align: right;
  color: #6e7681;
}

.sm-snippet {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.sm-snippet mark {
  padding: 0;
  background: rgba(255, 213, 79, 0.28);
  color: inherit;
}

.search-more {
  padding: 1px 8px 3px 60px;
  color: var(--fg-muted, #7f7f7f);
  font-size: 10.5px;
}

.search-hint {
  padding: 10px;
  color: var(--fg-muted, #8a8a8a);
  font-size: 11.5px;
  line-height: 1.7;
}

.search-examples {
  display: flex;
  gap: 6px;
  margin-top: 8px;
}

.search-example {
  padding: 1px 7px;
  border: 1px solid var(--border, #3c3c3c);
  border-radius: 4px;
  background: var(--tab-bg, #252526);
  color: var(--fg-muted, #a9a9a9);
  font: inherit;
  font-family: var(--font-mono, monospace);
  font-size: 10.5px;
  cursor: pointer;
}

.search-example:hover {
  color: var(--fg, #ddd);
  border-color: var(--accent, #4d80ff);
}
</style>
