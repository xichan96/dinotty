<template>
  <div v-if="visibleOverlays.length > 0" class="overlay-layer">
    <OverlayDragItem
      v-for="item in visibleOverlays"
      :key="item.id"
      :overlay="item"
      :api="apiFor(item)"
      @report-error="store.reportError"
    />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { usePluginOverlaysStore } from '../../stores/pluginOverlays'
import type { RegisteredOverlay } from '../../stores/pluginOverlays'
import type { PluginContext } from '../../composables/usePluginLoader'
import OverlayDragItem from './OverlayDragItem.vue'

const props = defineProps<{
  getPluginContext: (id: string) => PluginContext
}>()

const store = usePluginOverlaysStore()

const visibleOverlays = computed(() => store.overlays.filter(store.isVisible))

function apiFor(item: RegisteredOverlay): PluginContext {
  return props.getPluginContext(item.pluginId)
}
</script>

<style scoped>
.overlay-layer {
  position: fixed;
  inset: 0;
  z-index: 600;
  pointer-events: none;
  /* above keyboard band (500/520), below modal layers (ServerList 930 / Palette 1000 / MC 2000) */
}
</style>
