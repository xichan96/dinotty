<template>
  <div v-if="renderable.length > 0" class="float-window-layer">
    <PluginFloatWindow
      v-for="e in renderable"
      :key="e.id"
      :plugin="e.plugin"
      :api="e.api"
      :content="e.content"
      :workspace-id="workspaceId"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, watch } from 'vue'
import { usePluginFloatWindowsStore } from '../../stores/pluginFloatWindows'
import { usePluginLoader } from '../../composables/usePluginLoader'
import type { PluginContext } from '../../composables/usePluginLoader'
import type { LoadedPlugin } from '../../composables/usePluginLoader'
import type { FloatWindowContent } from '../../types/floatWindow'
import PluginFloatWindow from './PluginFloatWindow.vue'

interface RenderEntry {
  id: string
  plugin?: LoadedPlugin
  api?: PluginContext
  content?: FloatWindowContent
}

const props = defineProps<{
  getPluginContext: (id: string) => PluginContext
  /** Resolves a built-in preview window (files/web) for a non-plugin open id. */
  getPreviewContent?: (id: string) => FloatWindowContent | undefined
  workspaceId: string | undefined
}>()

const store = usePluginFloatWindowsStore()
const { loadedPlugins } = usePluginLoader()

const renderable = computed<RenderEntry[]>(() =>
  store.openIds
    .map((id): RenderEntry | null => {
      const plugin = loadedPlugins.get(id)
      if (plugin && plugin.state === 'active') {
        return { id, plugin, api: props.getPluginContext(id) }
      }
      const content = props.getPreviewContent?.(id)
      return content ? { id, content } : null
    })
    .filter((e): e is RenderEntry => e !== null)
)

// A window outlives its content (plugin uninstalled / dev-link unload / load
// error / bound terminal gone): drop it from the store so it unmounts.
watch(renderable, (list) => {
  const alive = new Set(list.map((e) => e.id))
  for (const id of store.openIds) {
    if (!alive.has(id)) store.close(id)
  }
})
</script>

<style scoped>
.float-window-layer {
  position: fixed;
  inset: 0;
  z-index: 640;
  pointer-events: none;
  /* above overlay layer (600) and keyboard band (500/520), below modal
   * layers (Bookmarks 940 / SSH 950 / Palette 1000 / MC 2000) */
}
</style>
