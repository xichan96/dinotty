<template>
  <Teleport to="body">
    <div v-if="visible" class="tab-ctx-backdrop" @mousedown="$emit('close-menu')"></div>
    <div
      v-if="visible"
      class="tab-ctx-menu"
      role="menu"
      :style="{ left: `${left}px`, top: `${top}px` }"
      @mousedown.stop
      @contextmenu.prevent
    >
      <button type="button" class="tab-ctx-item" role="menuitem" @click="run('close')">
        <span>{{ t('editorTabs.close') }}</span>
      </button>
      <button type="button" class="tab-ctx-item" role="menuitem" @click="run('toggle-preview')">
        <span>{{ tab?.preview ? t('editorTabs.pin') : t('editorTabs.makePreview') }}</span>
      </button>
      <div class="tab-ctx-sep" />
      <button type="button" class="tab-ctx-item" role="menuitem" @click="run('close-others')">
        <span>{{ t('editorTabs.closeOthers') }}</span>
      </button>
      <button
        type="button"
        class="tab-ctx-item"
        role="menuitem"
        :disabled="!canCloseRight"
        @click="run('close-right')"
      >
        <span>{{ t('editorTabs.closeRight') }}</span>
      </button>
      <button type="button" class="tab-ctx-item" role="menuitem" @click="run('close-saved')">
        <span>{{ t('editorTabs.closeSaved') }}</span>
      </button>
      <div class="tab-ctx-sep" />
      <button type="button" class="tab-ctx-item" role="menuitem" @click="run('copy-path')">
        <span>{{ t('editorTabs.copyPath') }}</span>
      </button>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from '../../composables/useI18n'
import type { EditorTab } from '../../types/editorTabs'

export type TabMenuCommand =
  | 'close'
  | 'toggle-preview'
  | 'close-others'
  | 'close-right'
  | 'close-saved'
  | 'copy-path'

const props = defineProps<{
  visible: boolean
  x: number
  y: number
  tab: EditorTab | null
  canCloseRight: boolean
}>()

const emit = defineEmits<{
  command: [command: TabMenuCommand]
  'close-menu': []
}>()

const { t } = useI18n()

const MENU_W = 232
const MENU_H = 250
const left = computed(() =>
  Math.max(8, Math.min(props.x, window.innerWidth - MENU_W - 8))
)
const top = computed(() =>
  Math.max(8, Math.min(props.y, window.innerHeight - MENU_H - 8))
)

function run(command: TabMenuCommand) {
  emit('command', command)
  emit('close-menu')
}
</script>

<style scoped>
.tab-ctx-backdrop {
  position: fixed;
  inset: 0;
  z-index: 100000;
  background: transparent;
}

.tab-ctx-menu {
  position: fixed;
  z-index: 100001;
  min-width: 220px;
  padding: 4px 0;
  border-radius: 6px;
  background: var(--menu-bg, #252526);
  border: 1px solid #3c3c3c;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
  font-family:
    system-ui,
    -apple-system,
    BlinkMacSystemFont,
    'Segoe UI',
    Roboto,
    sans-serif;
}

.tab-ctx-item {
  display: flex;
  align-items: center;
  width: 100%;
  box-sizing: border-box;
  padding: 5px 14px;
  border: none;
  background: transparent;
  color: #cccccc;
  font-size: 13px;
  line-height: 1.35;
  text-align: left;
  cursor: pointer;
}

.tab-ctx-item:hover:not(:disabled),
.tab-ctx-item:focus-visible {
  background: #094771;
  color: #ffffff;
  outline: none;
}

.tab-ctx-item:disabled {
  opacity: 0.4;
  cursor: default;
}

.tab-ctx-sep {
  height: 1px;
  margin: 4px 0;
  background: #3c3c3c;
}
</style>
