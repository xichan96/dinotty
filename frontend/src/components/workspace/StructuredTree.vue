<template>
  <div class="structured-tree">
    <div class="structured-tree-toolbar">
      <button
        type="button"
        class="structured-tree-action"
        data-testid="structured-expand-all"
        @click="expandAll"
      >
        {{ t('structuredPreview.expandAll') }}
      </button>
      <button
        type="button"
        class="structured-tree-action"
        data-testid="structured-collapse-all"
        @click="collapseAll"
      >
        {{ t('structuredPreview.collapseAll') }}
      </button>
      <span class="structured-tree-spacer"></span>
      <span class="structured-tree-total">{{ total }} {{ t('structuredPreview.nodes') }}</span>
    </div>

    <div class="structured-tree-scroll">
      <div role="tree" class="structured-tree-rows" :aria-label="t('structuredPreview.tree')">
        <div
          v-for="row in rows"
          :key="row.item.id"
          class="structured-tree-row"
          role="treeitem"
          :aria-level="row.depth + 1"
          :aria-expanded="hasChildren(row.item) ? isExpanded(row.item.id) : undefined"
          :data-path="row.item.id"
          tabindex="0"
          @click="onRowClick(row.item)"
          @keydown.enter.prevent="onRowClick(row.item)"
          @keydown.space.prevent="onRowClick(row.item)"
          @keydown.right.prevent="onKeyRight(row.item)"
          @keydown.left.prevent="onKeyLeft(row.item)"
        >
          <span
            v-if="row.depth > 0"
            class="structured-tree-indent"
            :style="{ width: `${row.depth * 14}px` }"
            aria-hidden="true"
          ></span>
          <button
            v-if="hasChildren(row.item)"
            type="button"
            class="structured-tree-chevron"
            :class="{ open: isExpanded(row.item.id) }"
            :aria-label="isExpanded(row.item.id) ? t('outline.collapse') : t('outline.expand')"
            @click.stop="toggle(row.item.id)"
            @keydown.enter.stop.prevent="toggle(row.item.id)"
            @keydown.space.stop.prevent="toggle(row.item.id)"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="m9 18 6-6-6-6" />
            </svg>
          </button>
          <span v-else class="structured-tree-chevron spacer" aria-hidden="true"></span>

          <span class="structured-tree-kind" aria-hidden="true">{{ kindGlyph(row.item) }}</span>
          <span class="structured-tree-label">{{ row.item.label }}</span>
          <span v-if="row.item.value" class="structured-tree-value">{{ row.item.value }}</span>
          <span class="structured-tree-line" :title="String(row.item.line)">{{
            row.item.line
          }}</span>
          <button
            type="button"
            class="structured-tree-copy"
            :class="{ copied: copiedId === row.item.id }"
            :title="t('structuredPreview.copyPath')"
            :aria-label="`${t('structuredPreview.copyPath')}: ${row.item.id}`"
            @click.stop="copyPath(row.item)"
          >
            <span aria-hidden="true">{{ copiedId === row.item.id ? '✓' : '⧉' }}</span>
            <span class="structured-tree-copy-text">{{
              copiedId === row.item.id
                ? t('structuredPreview.copied')
                : t('structuredPreview.copyPath')
            }}</span>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from '../../composables/useI18n'
import { copyToClipboard } from '../../utils/clipboard'
import {
  defaultExpandedIds,
  expandableIds,
  flattenOutline,
  outlineRows,
} from '../../utils/outlineTree'
import type { OutlineItem } from '../../types/outline'

const props = defineProps<{
  items: OutlineItem[]
}>()

const { t } = useI18n()

const expanded = ref<Set<string>>(new Set())
const copiedId = ref<string | null>(null)
let copyTimer: ReturnType<typeof setTimeout> | null = null

const rows = computed(() => outlineRows(props.items, expanded.value, '').rows)
const total = computed(() => flattenOutline(props.items).length)

watch(
  () => props.items,
  (items) => {
    // Arrays stay collapsed by default so they read as a compact `[n]` row,
    // matching the outline panel's expansion rules.
    expanded.value = defaultExpandedIds(items)
  },
  { immediate: true }
)

function hasChildren(item: OutlineItem): boolean {
  return (item.children?.length ?? 0) > 0
}

function isExpanded(id: string): boolean {
  return expanded.value.has(id)
}

function toggle(id: string): void {
  const next = new Set(expanded.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  expanded.value = next
}

function expandAll(): void {
  expanded.value = new Set(expandableIds(props.items))
}

function collapseAll(): void {
  expanded.value = new Set()
}

function onRowClick(item: OutlineItem): void {
  if (hasChildren(item)) toggle(item.id)
}

function onKeyRight(item: OutlineItem): void {
  if (hasChildren(item) && !isExpanded(item.id)) toggle(item.id)
}

function onKeyLeft(item: OutlineItem): void {
  if (hasChildren(item) && isExpanded(item.id)) toggle(item.id)
}

function kindGlyph(item: OutlineItem): string {
  if (item.kind === 'object') return '{}'
  if (item.kind === 'array') return '[]'
  return '·'
}

async function copyPath(item: OutlineItem): Promise<void> {
  try {
    await copyToClipboard(item.id)
  } catch {
    return
  }
  copiedId.value = item.id
  if (copyTimer !== null) clearTimeout(copyTimer)
  copyTimer = setTimeout(() => {
    copiedId.value = null
    copyTimer = null
  }, 1200)
}

onBeforeUnmount(() => {
  if (copyTimer !== null) clearTimeout(copyTimer)
})
</script>

<style scoped>
.structured-tree {
  display: flex;
  flex: 1 1 0;
  min-height: 0;
  flex-direction: column;
  background: var(--bg-surface, #141414);
}

.structured-tree-toolbar {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border-bottom: 1px solid var(--border);
  background: var(--bg, #1a1a1a);
}

.structured-tree-action {
  border: 1px solid transparent;
  border-radius: 3px;
  background: none;
  color: var(--fg-muted, #888);
  cursor: pointer;
  font-size: 11px;
  padding: 2px 6px;
}

.structured-tree-action:hover {
  border-color: var(--border);
  color: var(--fg-bright, #eee);
}

.structured-tree-action:focus-visible {
  outline: 1px solid var(--border-focus, #8a8a8a);
  outline-offset: -1px;
}

.structured-tree-spacer {
  flex: 1 1 auto;
}

.structured-tree-total {
  color: var(--fg-muted, #888);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}

.structured-tree-scroll {
  flex: 1 1 0;
  min-height: 0;
  overflow: auto;
  padding: 4px 0 12px;
}

.structured-tree-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 1px 10px 1px 6px;
  color: var(--fg, #ddd);
  font-family: var(--font-mono);
  font-size: clamp(11px, 2.3vmin, 14px);
  line-height: 1.7;
  white-space: nowrap;
  cursor: default;
}

.structured-tree-row:hover {
  background: var(--bg-hover, #262626);
}

.structured-tree-row:focus-visible {
  outline: 1px solid var(--border-focus, #8a8a8a);
  outline-offset: -1px;
}

.structured-tree-indent {
  flex: 0 0 auto;
}

.structured-tree-chevron {
  display: grid;
  flex: 0 0 auto;
  width: 16px;
  height: 16px;
  place-items: center;
  border: none;
  border-radius: 2px;
  background: none;
  color: var(--fg-muted, #888);
  cursor: pointer;
  padding: 0;
}

.structured-tree-chevron svg {
  width: 12px;
  height: 12px;
  transition: transform 0.12s ease;
}

.structured-tree-chevron.open svg {
  transform: rotate(90deg);
}

.structured-tree-chevron:hover {
  color: var(--fg-bright, #eee);
}

.structured-tree-kind {
  flex: 0 0 auto;
  width: 16px;
  color: var(--fg-muted, #888);
  font-size: 10px;
  text-align: center;
}

.structured-tree-label {
  min-width: 0;
  overflow: hidden;
  color: var(--fg-bright, #eee);
  text-overflow: ellipsis;
}

.structured-tree-value {
  min-width: 0;
  overflow: hidden;
  color: var(--color-green, #98c379);
  text-overflow: ellipsis;
}

.structured-tree-line {
  flex: 0 0 auto;
  color: var(--fg-muted, #777);
  font-size: 10px;
  font-variant-numeric: tabular-nums;
}

.structured-tree-copy {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 4px;
  border: 1px solid transparent;
  border-radius: 3px;
  background: none;
  color: var(--fg-muted, #888);
  cursor: pointer;
  font-family: inherit;
  font-size: 10px;
  line-height: 1.5;
  margin-left: auto;
  opacity: 0;
  padding: 0 4px;
}

.structured-tree-row:hover .structured-tree-copy,
.structured-tree-row:focus-within .structured-tree-copy,
.structured-tree-copy:focus-visible,
.structured-tree-copy.copied {
  opacity: 1;
}

.structured-tree-copy:hover {
  border-color: var(--border);
  color: var(--fg-bright, #eee);
}

.structured-tree-copy.copied {
  color: var(--color-green, #98c379);
}

.structured-tree-copy:focus-visible {
  outline: 1px solid var(--border-focus, #8a8a8a);
  outline-offset: -1px;
}
</style>
