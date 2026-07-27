<template>
  <div class="plugin-view">
    <template v-if="plugin">
      <component
        v-if="plugin.state === 'active' && plugin.exports?.component && !hasError"
        :is="plugin.exports.component"
        :api="api"
        :pane-id="paneId"
        :workspace-id="workspaceId"
        :is-visible="isVisible"
        :is-focused="isFocused"
      />
      <div v-else-if="hasError" class="plugin-error">
        <p>Plugin runtime error: {{ errorMsg }}</p>
      </div>
      <div v-else-if="plugin.state === 'error'" class="plugin-error">
        <p>Plugin load failed: {{ plugin.error }}</p>
      </div>
      <div v-else class="plugin-empty">
        <p>This plugin does not provide a UI component</p>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, onErrorCaptured } from 'vue'
import type { LoadedPlugin, PluginContext } from '../../composables/usePluginLoader'

defineProps<{
  plugin: LoadedPlugin
  api: PluginContext
  paneId: string
  workspaceId: string | undefined
  isVisible: boolean
  isFocused: boolean
}>()

const hasError = ref(false)
const errorMsg = ref('')

onErrorCaptured((err: any) => {
  hasError.value = true
  errorMsg.value = err?.message || 'Unknown error'
  return false // prevent propagation
})
</script>

<style scoped>
.plugin-view {
  width: 100%;
  height: 100%;
  overflow: auto;
  background: var(--bg-main);
  color: var(--text-color, #cccccc);
}
.plugin-error {
  padding: 2rem;
  color: var(--color-red, #f44747);
}
.plugin-empty {
  padding: 2rem;
  color: var(--text-muted, #858585);
}
</style>
