<template>
  <div class="structured-preview">
    <div class="structured-toolbar">
      <span v-if="editorDirty" class="structured-dirty">{{ t('filePreview.modified') }}</span>
      <button
        type="button"
        class="structured-tab"
        :class="{ active: activeTab === 'tree' }"
        data-testid="structured-tree-tab"
        :aria-pressed="activeTab === 'tree'"
        @click="activeTab = 'tree'"
      >
        {{ t('structuredPreview.tree') }}
      </button>
      <button
        type="button"
        class="structured-tab"
        :class="{ active: activeTab === 'source' }"
        data-testid="structured-source-tab"
        :aria-pressed="activeTab === 'source'"
        @click="activeTab = 'source'"
      >
        {{ t('structuredPreview.source') }}
      </button>
      <span class="structured-spacer"></span>
      <button
        v-if="outlineAvailable"
        type="button"
        class="structured-outline"
        :class="{ active: outlineOpen }"
        :aria-pressed="outlineOpen ? 'true' : 'false'"
        :aria-controls="outlinePanelId"
        :title="t('outline.toggle')"
        :aria-label="t('outline.toggle')"
        @click="emit('toggle-outline')"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.75"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M8 6h13M8 12h13M8 18h13" />
          <path d="M3 6h.01M3 12h.01M3 18h.01" />
        </svg>
      </button>
      <button
        v-if="showSave"
        type="button"
        class="structured-save"
        :disabled="!canSaveEditor"
        @click="emit('saveEditor')"
      >
        {{ t('filePreview.save') }}
      </button>
    </div>

    <div v-if="truncated" class="structured-banner" role="status">
      {{ t('structuredPreview.truncated') }}
    </div>

    <template v-if="activeTab === 'tree'">
      <div v-if="parsed.errorLine" class="structured-state error" role="alert">
        <div class="structured-state-title">{{ t('structuredPreview.parseError') }}</div>
        <div class="structured-state-desc">{{ t('structuredPreview.parseErrorDesc') }}</div>
        <div class="structured-error-detail">
          {{ t('structuredPreview.errorLine', { line: parsed.errorLine }) }}
          <template v-if="parsed.errorMessage"> — {{ parsed.errorMessage }}</template>
        </div>
        <button
          type="button"
          class="structured-state-action"
          data-testid="structured-retry"
          @click="retry"
        >
          {{ t('structuredPreview.retry') }}
        </button>
      </div>
      <div v-else-if="parsed.items.length === 0" class="structured-state">
        <div class="structured-state-title">{{ t('structuredPreview.emptyTitle') }}</div>
        <div class="structured-state-desc">{{ t('structuredPreview.emptyDesc') }}</div>
      </div>
      <template v-else>
        <div v-if="largeTree" class="structured-notice" role="status">
          {{ t('structuredPreview.largeTree') }}
        </div>
        <StructuredTree :key="filePath" :items="parsed.items" />
      </template>
    </template>

    <MonacoEditor
      v-else
      :model-value="sourceText"
      :language="format"
      :readonly="readOnly || truncated"
      :file-path="filePath"
      :pane-id="paneId"
      :leaf-id="leafId"
      @update:model-value="emit('update:editorText', $event)"
      @save="emit('saveEditor')"
      @selection-change="(payload) => emit('selection-change', payload)"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, defineAsyncComponent, ref, watch } from 'vue'
import { useI18n } from '../../composables/useI18n'
import { flattenOutline } from '../../utils/outlineTree'
import {
  parseStructuredOutline,
  STRUCTURED_MAX_NODES,
  type StructuredFormat,
  type StructuredOutlineResult,
} from '../../utils/structuredOutline'
import StructuredTree from './StructuredTree.vue'

const MonacoEditor = defineAsyncComponent(() => import('./MonacoEditor.vue'))

const props = withDefaults(
  defineProps<{
    content: string
    filePath: string
    format: StructuredFormat
    /** Reserved for a future full-content fetch when truncated. */
    rawUrl?: string
    truncated?: boolean
    editorText?: string
    editorDirty?: boolean
    showSave?: boolean
    canSaveEditor?: boolean
    paneId?: string
    leafId?: string
    outlineOpen?: boolean
    outlineAvailable?: boolean
    outlinePanelId?: string
    readOnly?: boolean
  }>(),
  {
    rawUrl: '',
    truncated: false,
    editorText: '',
    editorDirty: false,
    showSave: false,
    canSaveEditor: false,
    paneId: '',
    leafId: undefined,
    outlineOpen: false,
    outlineAvailable: false,
    outlinePanelId: '',
    readOnly: false,
  }
)

const emit = defineEmits<{
  'update:editorText': [value: string]
  saveEditor: []
  'selection-change': [payload: { text: string; rect: DOMRect | null }]
  'toggle-outline': []
}>()

const { t } = useI18n()

const activeTab = ref<'tree' | 'source'>('tree')
const parsed = ref<StructuredOutlineResult>({ items: [] })

const sourceText = computed(() => props.editorText || props.content)
const nodeCount = computed(() => flattenOutline(parsed.value.items).length)
const largeTree = computed(() => nodeCount.value >= STRUCTURED_MAX_NODES)

function parseNow(): void {
  parsed.value = parseStructuredOutline(props.content, props.format)
}

watch(() => [props.content, props.format] as const, parseNow, { immediate: true })

// Each file opens on the tree; Source is opt-in, matching CSV/notebook tabs.
watch(
  () => props.filePath,
  () => {
    activeTab.value = 'tree'
  }
)

function retry(): void {
  parseNow()
}
</script>

<style scoped>
.structured-preview {
  display: flex;
  flex: 1 1 0;
  min-width: 0;
  min-height: 0;
  flex-direction: column;
  overflow: hidden;
  color: var(--fg);
  background: var(--bg-surface, #141414);
}

.structured-toolbar {
  display: flex;
  flex-shrink: 0;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--border);
  background: var(--tab-bg);
}

.structured-dirty {
  color: var(--color-orange, #d19a66);
  font-size: 12px;
}

.structured-tab {
  border: none;
  border-radius: 3px;
  background: var(--bg, #1a1a1a);
  color: var(--fg-muted, #888);
  cursor: pointer;
  font-size: 12px;
  padding: 3px 8px;
}

.structured-tab:hover {
  color: var(--fg);
}

.structured-tab.active {
  background: var(--bg-hover, #333);
  color: var(--fg-bright, #eee);
}

.structured-tab:focus-visible,
.structured-outline:focus-visible,
.structured-save:focus-visible,
.structured-state-action:focus-visible {
  outline: 1px solid var(--border-focus, #8a8a8a);
  outline-offset: -1px;
}

.structured-spacer {
  flex: 1 1 auto;
}

.structured-outline {
  display: grid;
  flex: 0 0 auto;
  width: 24px;
  height: 24px;
  place-items: center;
  border: none;
  border-radius: 3px;
  background: transparent;
  color: var(--fg-muted, #888);
  cursor: pointer;
}

.structured-outline:hover,
.structured-outline.active {
  background: var(--bg-hover, #333);
  color: var(--fg-bright, #eee);
}

.structured-outline svg {
  width: 14px;
  height: 14px;
}

.structured-save {
  border: none;
  border-radius: 3px;
  background: var(--accent, #0e639c);
  color: #fff;
  cursor: pointer;
  font-size: 12px;
  padding: 4px 12px;
}

.structured-save:disabled {
  cursor: default;
  opacity: 0.4;
}

.structured-banner {
  flex-shrink: 0;
  padding: 5px 10px;
  border-bottom: 1px solid color-mix(in srgb, var(--color-orange, #d19a66) 35%, transparent);
  background: color-mix(in srgb, var(--color-orange, #d19a66) 8%, transparent);
  color: var(--color-orange, #d19a66);
  font-size: 12px;
}

.structured-notice {
  flex-shrink: 0;
  padding: 4px 10px;
  border-bottom: 1px solid var(--border);
  background: var(--bg, #1a1a1a);
  color: var(--fg-muted, #888);
  font-size: 11px;
}

.structured-state {
  display: flex;
  flex: 1 1 0;
  min-height: 120px;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 16px;
  color: var(--fg-muted, #888);
  text-align: center;
}

.structured-state.error {
  color: var(--color-red, #f44747);
}

.structured-state-title {
  font-size: clamp(13px, 2.8vmin, 16px);
}

.structured-state-desc {
  color: var(--fg-muted, #888);
  font-size: 12px;
}

.structured-error-detail {
  max-width: 100%;
  color: var(--fg-muted, #888);
  font-family: var(--font-mono);
  font-size: 11px;
  overflow-wrap: anywhere;
}

.structured-state-action {
  border: 1px solid var(--border);
  border-radius: 3px;
  background: var(--bg-hover, #333);
  color: var(--fg, #ddd);
  cursor: pointer;
  font-size: 12px;
  padding: 3px 12px;
}
</style>
