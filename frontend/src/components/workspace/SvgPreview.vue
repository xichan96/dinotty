<template>
  <div class="svg-preview">
    <div class="svg-toolbar">
      <span v-if="editorDirty" class="svg-dirty">{{ t('filePreview.modified') }}</span>
      <button
        type="button"
        class="svg-tab"
        :class="{ active: activeTab === 'preview' }"
        data-testid="svg-preview-tab"
        :aria-pressed="activeTab === 'preview'"
        @click="activeTab = 'preview'"
      >
        {{ t('filePreview.preview') }}
      </button>
      <button
        type="button"
        class="svg-tab"
        :class="{ active: activeTab === 'source' }"
        data-testid="svg-source-tab"
        :aria-pressed="activeTab === 'source'"
        @click="activeTab = 'source'"
      >
        {{ t('filePreview.source') }}
      </button>
      <span class="svg-spacer"></span>
      <button
        v-if="showSave"
        type="button"
        class="svg-save"
        data-testid="svg-save"
        :disabled="!canSaveEditor || truncated"
        @click="emit('saveEditor')"
      >
        {{ t('filePreview.save') }}
      </button>
    </div>

    <div v-if="truncated" class="svg-notice" role="status" data-testid="svg-truncated">
      {{ t('svgPreview.truncated') }}
    </div>

    <!-- `v-show` keeps the mounted ImagePreview (and its zoom/pan state) alive
         while the source tab is open. The preview is still an <img>: SVG
         scripts never execute. -->
    <ImagePreview
      v-show="activeTab === 'preview'"
      :src="previewSrc"
      :file-key="rawUrl"
      :alt="fileName"
    />
    <MonacoEditor
      v-if="activeTab === 'source'"
      :model-value="sourceText"
      language="xml"
      :readonly="truncated"
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
import { useSvgObjectUrl } from '../../composables/useSvgObjectUrl'
import ImagePreview from './ImagePreview.vue'

const MonacoEditor = defineAsyncComponent(() => import('./MonacoEditor.vue'))

const props = withDefaults(
  defineProps<{
    content: string
    editorText: string
    filePath: string
    rawUrl: string
    truncated?: boolean
    editorDirty?: boolean
    showSave?: boolean
    canSaveEditor?: boolean
    paneId?: string
    leafId?: string
  }>(),
  {
    truncated: false,
    editorDirty: false,
    showSave: false,
    canSaveEditor: false,
    paneId: '',
    leafId: undefined,
  }
)

const emit = defineEmits<{
  'update:editorText': [value: string]
  saveEditor: []
  'selection-change': [payload: { text: string; rect: DOMRect | null }]
}>()

const { t } = useI18n()

const activeTab = ref<'preview' | 'source'>('preview')

const sourceText = computed(() => props.editorText || props.content)
const fileName = computed(() => props.filePath.split(/[\\/]/).pop() || props.filePath)

// A truncated buffer is cut mid-file, so it is not valid SVG; keep showing the
// raw file until the editor (read-only in that state) can be saved whole.
const previewSource = computed(() => (props.truncated ? '' : sourceText.value))
const objectUrl = useSvgObjectUrl(previewSource)
const previewSrc = computed(() => {
  if (props.truncated) return props.rawUrl
  return objectUrl.value || props.rawUrl
})

// Each file opens on the drawing, matching the notebook/CSV tab behaviour.
watch(
  () => props.filePath,
  () => {
    activeTab.value = 'preview'
  }
)
</script>

<style scoped>
.svg-preview {
  display: flex;
  flex: 1 1 0;
  min-width: 0;
  min-height: 0;
  flex-direction: column;
  overflow: hidden;
  color: var(--fg);
  background: var(--bg-surface, #141414);
}

.svg-toolbar {
  display: flex;
  flex-shrink: 0;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--border);
  background: var(--tab-bg);
}

.svg-dirty {
  color: var(--color-orange, #d19a66);
  font-size: 12px;
}

.svg-tab {
  border: none;
  border-radius: 3px;
  background: var(--bg, #1a1a1a);
  color: var(--fg-muted, #888);
  cursor: pointer;
  font-size: 12px;
  padding: 3px 8px;
}

.svg-tab:hover {
  color: var(--fg);
}

.svg-tab.active {
  background: var(--bg-hover, #333);
  color: var(--fg-bright, #eee);
}

.svg-tab:focus-visible,
.svg-save:focus-visible {
  outline: 1px solid var(--border-focus, #8a8a8a);
  outline-offset: -1px;
}

.svg-spacer {
  flex: 1 1 auto;
}

.svg-save {
  border: none;
  border-radius: 3px;
  background: var(--accent, #0e639c);
  color: #fff;
  cursor: pointer;
  font-size: 12px;
  padding: 4px 12px;
}

.svg-save:disabled {
  cursor: default;
  opacity: 0.4;
}

.svg-notice {
  flex-shrink: 0;
  padding: 5px 10px;
  border-bottom: 1px solid color-mix(in srgb, var(--color-orange, #d19a66) 35%, transparent);
  background: color-mix(in srgb, var(--color-orange, #d19a66) 8%, transparent);
  color: var(--color-orange, #d19a66);
  font-size: 12px;
}
</style>
