<!--
  Placeholder SVG preview. The SVG feature branch replaces this implementation
  with the live preview/source toggle; keep the props and emits stable.
-->
<template>
  <div class="svg-preview">
    <div v-if="truncated" class="svg-preview-notice" role="status">
      {{ t('svgPreview.truncated') }}
    </div>
    <img class="svg-preview-media" :src="rawUrl" :alt="filePath" />
  </div>
</template>

<script setup lang="ts">
import { useI18n } from '../../composables/useI18n'

withDefaults(
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
  }
)

defineEmits<{
  'update:editorText': [value: string]
  saveEditor: []
  'selection-change': [payload: { text: string; rect: DOMRect | null }]
}>()

const { t } = useI18n()
</script>

<style scoped>
.svg-preview {
  display: flex;
  flex: 1 1 0;
  min-width: 0;
  min-height: 0;
  flex-direction: column;
  overflow: hidden;
  background: var(--bg-surface, #141414);
}

.svg-preview-notice {
  flex-shrink: 0;
  padding: 5px 10px;
  border-bottom: 1px solid color-mix(in srgb, var(--color-orange, #d19a66) 35%, transparent);
  background: color-mix(in srgb, var(--color-orange, #d19a66) 8%, transparent);
  color: var(--color-orange, #d19a66);
  font-family: var(--font-sans, sans-serif);
  font-size: 12px;
}

.svg-preview-media {
  width: 100%;
  min-height: 0;
  flex: 1 1 0;
  object-fit: contain;
}
</style>
