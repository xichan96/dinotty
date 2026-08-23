<template>
  <div class="tlp-root">
    <div class="tlp-header">
      <span class="tlp-title">{{ t('template.previewTitle') }}</span>
      <span v-if="leafCount > 0" class="tlp-meta"
        >{{ leafCount }}
        {{ leafCount === 1 ? t('template.paneSingular') : t('template.panePlural') }}</span
      >
    </div>
    <div class="tlp-schematic">
      <TemplateLayoutNode :node="layout" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from '../../composables/useI18n'
import { getAllLeaves } from '../../types/pane'
import type { PaneLayout } from '../../types/pane'
import TemplateLayoutNode from './TemplateLayoutNode.vue'

const { t } = useI18n()

const props = defineProps<{
  layout: PaneLayout
}>()

const leafCount = computed(() => getAllLeaves(props.layout).length)
</script>

<style scoped>
.tlp-root {
  display: flex;
  flex-direction: column;
  gap: 8px;
  height: 100%;
  min-height: 0;
  overflow: hidden;
}
.tlp-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;
}
.tlp-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--fg-bright);
}
.tlp-meta {
  font-size: 11px;
  color: var(--fg-muted);
}
.tlp-schematic {
  flex: 1;
  min-height: 340px;
  overflow: auto;
  display: flex;
  flex-direction: column;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 14px;
}
</style>
