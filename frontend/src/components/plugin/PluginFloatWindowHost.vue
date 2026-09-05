<template>
  <div v-if="renderable.length > 0" class="float-window-layer">
    <PluginFloatWindow
      v-for="p in renderable"
      :key="p.id"
      :plugin="p"
      :api="apis.get(p.id)!"
      :workspace-id="workspaceId"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, watch } from 'vue'
import { usePluginFloatWindowsStore } from '../../stores/pluginFloatWindows'
import { usePluginLoader } from '../../composables/usePluginLoader'
import type { PluginContext } from '../../composables/usePluginLoader'
import PluginFloatWindow from './PluginFloatWindow.vue'

const props = defineProps<{
  getPluginContext: (id: string) => PluginContext
  workspaceId: string | undefined
}>()

const store = usePluginFloatWindowsStore()
const { loadedPlugins } = usePluginLoader()

const renderable = computed(() =>
  store.openIds
    .map((id) => loadedPlugins.get(id))
    .filter((p): p is NonNullable<typeof p> => !!p && p.state === 'active')
)

const apis = computed(
  () => new Map(renderable.value.map((p) => [p.id, props.getPluginContext(p.id)]))
)

// A window outlives its plugin (uninstall / dev-link unload / load error):
// drop it from the store so the window unmounts.
watch(renderable, (list) => {
  const alive = new Set(list.map((p) => p.id))
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
   * layers (ServerList 930 / Palette 1000 / MC 2000) */
}
</style>
