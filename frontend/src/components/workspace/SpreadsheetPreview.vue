<!--
  Placeholder spreadsheet preview. The spreadsheet feature branch replaces this
  implementation with sheet tabs and a table view; keep the props stable.
-->
<template>
  <div class="spreadsheet-preview">
    {{ t('filePreview.loading') }}
  </div>
</template>

<script setup lang="ts">
import { useI18n } from '../../composables/useI18n'

defineProps<{
  rawUrl: string
  filePath: string
  paneId?: string
}>()

const { t } = useI18n()
</script>

<style scoped>
.spreadsheet-preview {
  display: flex;
  flex: 1 1 0;
  min-height: 120px;
  align-items: center;
  justify-content: center;
  padding: 16px;
  color: var(--fg-muted, #888888);
  background: var(--bg-surface, #141414);
  font-family: var(--font-sans, sans-serif);
  font-size: 13px;
  text-align: center;
}
</style>
