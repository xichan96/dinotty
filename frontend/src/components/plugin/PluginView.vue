<template>
  <div class="plugin-view" :class="plugin ? `plugin-host-${plugin.id}` : ''">
    <template v-if="plugin">
      <component
        :is="plugin.exports.component"
        v-if="plugin.state === 'active' && plugin.exports?.component && !hasError"
        :api="api"
        :pane-id="paneId"
        :workspace-id="workspaceId"
        :is-visible="isVisible"
        :is-focused="isFocused"
      />
      <component :is="hostView" v-else-if="plugin.state === 'active' && hostView && !hasError" />
      <div v-else-if="hasError" class="plugin-error">
        <p>Plugin runtime error: {{ errorMsg }}</p>
      </div>
      <div v-else-if="plugin.state === 'error'" class="plugin-error">
        <p>Plugin load failed: {{ plugin.error }}</p>
      </div>
      <div v-else class="plugin-empty">
        <p>This plugin does not provide a UI component</p>
      </div>
      <!-- Overlay management: every overlay this plugin registered, including
           defaultHidden ones (re-enable via the checkbox → forcedVisible).
           Hidden inside floating windows (showOverlays=false). -->
      <div v-if="showOverlays && pluginOverlays.length" class="plugin-overlays">
        <h3>{{ t('settings.plugins.overlays') }}</h3>
        <div v-for="o in pluginOverlays" :key="o.id" class="overlay-row">
          <label class="overlay-toggle" :title="o.id">
            <input
              type="checkbox"
              :checked="overlayStore.isVisible(o)"
              @change="onToggleVisible(o, ($event.target as HTMLInputElement).checked)"
            />
            <span>{{ overlayName(o.id) }}</span>
          </label>
          <button
            class="overlay-reposition"
            :class="{ active: overlayStore.repositionId === o.id }"
            :disabled="!overlayStore.isVisible(o)"
            @click="toggleReposition(o.id)"
          >
            {{
              overlayStore.repositionId === o.id ? t('overlay.done') : t('overlay.adjustPosition')
            }}
          </button>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onErrorCaptured } from 'vue'
import { HOST_PLUGIN_VIEWS } from '../../utils/hostPluginViews'
import { useI18n } from '../../composables/useI18n'
import { saveSettings } from '../../composables/useSettings'
import { usePluginOverlaysStore, type RegisteredOverlay } from '../../stores/pluginOverlays'
import type { LoadedPlugin, PluginContext } from '../../composables/usePluginLoader'

const props = withDefaults(
  defineProps<{
    plugin: LoadedPlugin
    api: PluginContext
    paneId: string
    workspaceId: string | undefined
    isVisible: boolean
    isFocused: boolean
    /** Render the overlay-management section (hidden inside floating windows). */
    showOverlays?: boolean
  }>(),
  { showOverlays: true }
)

const overlayStore = usePluginOverlaysStore()
const { t } = useI18n()

const hostView = computed(() => HOST_PLUGIN_VIEWS[props.plugin.id])
const pluginOverlays = computed(() =>
  overlayStore.overlays.filter((o) => o.pluginId === props.plugin.id)
)
const hasError = ref(false)
const errorMsg = ref('')

function onToggleVisible(o: RegisteredOverlay, visible: boolean) {
  overlayStore.setUserVisible(o.id, visible)
  void saveSettings()
}

function toggleReposition(id: string) {
  overlayStore.setReposition(overlayStore.repositionId === id ? null : id)
}

/** 'overlay-demo:fab' -> 'Fab' */
function overlayName(id: string): string {
  const short = id.split(':').pop() ?? id
  return short.charAt(0).toUpperCase() + short.slice(1)
}

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
.plugin-overlays {
  padding: 1rem 1.25rem;
  border-top: 1px solid var(--border);
}
.plugin-overlays h3 {
  margin: 0 0 0.5rem;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--fg-muted);
}
.overlay-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.25rem 0;
}
.overlay-toggle {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  cursor: pointer;
  color: var(--text-color, #cccccc);
}
.overlay-toggle input {
  accent-color: var(--accent);
}
.overlay-reposition {
  padding: 0.2rem 0.6rem;
  font-size: 12px;
  color: var(--text-color, #cccccc);
  background: var(--bg-hover);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  cursor: pointer;
}
.overlay-reposition:hover:not(:disabled) {
  background: var(--bg-elevated);
}
.overlay-reposition.active {
  color: var(--bg-main);
  background: var(--accent);
  border-color: var(--accent);
}
.overlay-reposition:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
