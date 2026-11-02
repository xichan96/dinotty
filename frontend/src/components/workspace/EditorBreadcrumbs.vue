<template>
  <div v-if="filePath" class="editor-breadcrumbs" :title="filePath">
    <template v-for="(part, idx) in parts" :key="idx">
      <span v-if="idx > 0" class="crumb-sep">›</span>
      <span class="crumb" :class="{ name: idx === parts.length - 1 }">{{ part }}</span>
    </template>
    <button
      v-if="diskChanged"
      type="button"
      class="crumb-disk"
      :title="t('filePreview.diskChangedHint')"
      @click="$emit('reload-disk')"
    >
      {{ t('filePreview.diskChanged') }}
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from '../../composables/useI18n'

const props = defineProps<{
  filePath: string | null
  diskChanged?: boolean
}>()

defineEmits<{
  'reload-disk': []
}>()

const { t } = useI18n()

const parts = computed(() => (props.filePath ? props.filePath.split('/').filter(Boolean) : []))
</script>

<style scoped>
.editor-breadcrumbs {
  display: flex;
  align-items: center;
  gap: 5px;
  flex-shrink: 0;
  height: 25px;
  padding: 0 12px;
  overflow: hidden;
  white-space: nowrap;
  background: var(--bg, #1e1e1e);
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  color: var(--fg-muted, #9d9d9d);
  font-size: 11.5px;
}

.crumb {
  overflow: hidden;
  text-overflow: ellipsis;
}

.crumb.name {
  color: var(--fg, #cfcfcf);
}

.crumb-sep {
  color: #5a5a5a;
  font-size: 13px;
  line-height: 1;
}

.crumb-disk {
  flex-shrink: 0;
  margin-left: 8px;
  padding: 0 5px;
  border: 1px solid rgba(209, 154, 102, 0.4);
  border-radius: 3px;
  background: rgba(209, 154, 102, 0.14);
  color: var(--color-orange, #d19a66);
  font: inherit;
  font-size: 10px;
  line-height: 16px;
  white-space: nowrap;
  cursor: pointer;
}

.crumb-disk:hover {
  border-color: rgba(209, 154, 102, 0.7);
}
</style>
