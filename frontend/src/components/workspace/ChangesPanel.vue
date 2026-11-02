<template>
  <div
    ref="rootRef"
    class="changes-panel"
    tabindex="0"
    role="region"
    :aria-label="t('workspaceChanges.title')"
    @keydown="onKeydown"
  >
    <div v-if="rootHint && data" class="changes-root-hint">{{ rootHint }}</div>

    <div v-if="data" class="changes-summary">
      <span class="changes-summary-text">{{ summaryText }}</span>
      <span v-if="stagedCount" class="changes-staged-count">{{
        t('workspaceChanges.staged', { count: stagedCount })
      }}</span>
    </div>

    <div v-if="error && data" class="changes-error-bar" role="alert">
      <span class="changes-error-text">{{ t('workspaceChanges.loadFailed') }}</span>
      <button type="button" class="changes-link-btn" @click="$emit('retry')">
        {{ t('workspaceChanges.retry') }}
      </button>
    </div>

    <template v-if="!data">
      <div v-if="state === 'unsupported'" class="changes-state">
        <span>{{ t('workspaceChanges.unavailable') }}</span>
        <button type="button" class="changes-link-btn" @click="$emit('back')">
          {{ t('workspaceChanges.backToFiles') }}
        </button>
      </div>
      <div v-else-if="state === 'notRepo'" class="changes-state">
        {{ t('workspaceChanges.notRepo') }}
      </div>
      <div v-else-if="state === 'error'" class="changes-state changes-state-error">
        <span>{{ t('workspaceChanges.loadFailed') }}</span>
        <button type="button" class="changes-link-btn" @click="$emit('retry')">
          {{ t('workspaceChanges.retry') }}
        </button>
      </div>
      <div v-else class="changes-state changes-state-loading">
        {{ t('filePreview.loading') }}
      </div>
    </template>

    <div v-else-if="!groups.length" class="changes-state">
      {{ t('workspaceChanges.empty') }}
    </div>

    <div v-else class="changes-groups" role="list">
      <template v-for="group in groups" :key="group.dir || '.'">
        <button
          v-if="group.dir"
          type="button"
          class="changes-group-head"
          :aria-label="
            collapsed.has(group.dir)
              ? t('workspaceChanges.expandFolder')
              : t('workspaceChanges.collapseFolder')
          "
          @click="toggleGroup(group.dir)"
        >
          <component :is="collapsed.has(group.dir) ? ChevronRight : ChevronDown" :size="12" />
          <span class="changes-group-name" :title="group.dir">{{ group.dir }}</span>
          <span class="changes-group-count">{{ group.files.length }}</span>
        </button>
        <template v-if="!group.dir || !collapsed.has(group.dir)">
          <button
            v-for="file in group.files"
            :key="file.path"
            type="button"
            role="listitem"
            class="changes-row"
            :class="{ selected: file.path === selectedPath }"
            :data-change-path="file.path"
            :title="rowTitle(file)"
            @click="$emit('open', file)"
          >
            <FileGlyph :path="file.path" :size="15" />
            <span class="changes-name">{{ fileName(file.path) }}</span>
            <span
              class="changes-status"
              :class="`status-${file.conflicted ? 'conflicted' : file.status}`"
              >{{ statusLetter(file) }}</span
            >
            <span class="changes-counts">
              <span class="changes-additions">{{ formatChangeCount(file.additions, '+') }}</span>
              <span class="changes-deletions">{{ formatChangeCount(file.deletions, '-') }}</span>
            </span>
            <span
              v-if="isStaged(file)"
              class="changes-staged-dot"
              :title="t('workspaceChanges.stagedMark')"
              :aria-label="t('workspaceChanges.stagedMark')"
            ></span>
          </button>
        </template>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { ChevronDown, ChevronRight } from 'lucide-vue-next'
import FileGlyph from './FileGlyph.vue'
import { useI18n } from '../../composables/useI18n'
import {
  changeStatusLetter,
  formatChangeCount,
  isStagedChange,
  type ChangesGroup,
} from '../../utils/changeGroups'
import type { WorkspaceError } from '../../composables/useFileWorkspaceBoot'
import type { WorkspaceChangesState } from '../../composables/useWorkspaceChanges'
import type { WorkspaceChangeFile, WorkspaceChangesResponse } from '../../types/workspaceChanges'

const props = defineProps<{
  state: WorkspaceChangesState
  data: WorkspaceChangesResponse | null
  groups: ChangesGroup[]
  selectedPath: string | null
  error: WorkspaceError | null
  rootHint: string | null
  stagedCount: number
}>()

const emit = defineEmits<{
  open: [file: WorkspaceChangeFile]
  retry: []
  back: []
  move: [delta: number]
  'open-selected': []
}>()

const { t } = useI18n()
const rootRef = ref<HTMLElement | null>(null)
const collapsed = ref<Set<string>>(new Set())

const summaryText = computed(() => {
  const summary = props.data?.summary
  if (!summary) return ''
  const key = summary.counts_complete
    ? 'workspaceChanges.summary'
    : 'workspaceChanges.summaryPartial'
  return t(key, {
    files: summary.files,
    additions: summary.additions,
    deletions: summary.deletions,
  })
})

function fileName(path: string): string {
  return path.split('/').pop() || path
}

function rowTitle(file: WorkspaceChangeFile): string {
  return file.orig_path ? `${file.orig_path} → ${file.path}` : file.path
}

function statusLetter(file: WorkspaceChangeFile): string {
  return changeStatusLetter(file)
}

function isStaged(file: WorkspaceChangeFile): boolean {
  return isStagedChange(file)
}

function toggleGroup(dir: string): void {
  const next = new Set(collapsed.value)
  if (next.has(dir)) next.delete(dir)
  else next.add(dir)
  collapsed.value = next
}

/** Keyboard operation is optional sugar: arrows move the shared selection and
 *  Enter opens it, matching the explorer's row semantics. */
function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'ArrowDown') {
    event.preventDefault()
    emit('move', 1)
  } else if (event.key === 'ArrowUp') {
    event.preventDefault()
    emit('move', -1)
  } else if (event.key === 'Enter') {
    event.preventDefault()
    emit('open-selected')
  }
}

/** Keep the highlighted row visible, and reveal it if its group is collapsed. */
watch(
  () => props.selectedPath,
  async (path) => {
    if (!path) return
    const group = props.groups.find((item) => item.files.some((file) => file.path === path))
    if (group?.dir && collapsed.value.has(group.dir)) {
      const next = new Set(collapsed.value)
      next.delete(group.dir)
      collapsed.value = next
    }
    await nextTick()
    const rows = rootRef.value?.querySelectorAll<HTMLElement>('[data-change-path]') ?? []
    for (const row of rows) {
      if (row.dataset.changePath === path) {
        row.scrollIntoView({ block: 'nearest' })
        break
      }
    }
  }
)
</script>

<style scoped src="../../styles/changes-panel.css"></style>
