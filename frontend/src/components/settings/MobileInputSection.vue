<template>
  <div class="settings-group mobile-input-settings">
    <h3 class="settings-group-title">{{ t('settings.keyboard.mobileInputMode.label') }}</h3>
    <SegmentedControl
      class="mobile-input-mode-control"
      data-setting="mobile-input-mode"
      :model-value="settings.mobile_input_mode ?? ''"
      :options="mobileInputModeOptions"
      :aria-label="t('settings.keyboard.mobileInputMode.label')"
      @update:model-value="onMobileInputModeChange"
    />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useSettings, type MobileInputMode } from '../../composables/useSettings'
import { useI18n } from '../../composables/useI18n'
import { usePluginLoader } from '../../composables/usePluginLoader'
import {
  BUILTIN_KEYBOARD_ID,
  SYSTEM_KEYBOARD_ID,
  useKeyboardProviders,
} from '../../composables/useKeyboardProviders'
import { applyAfterTerminalComposition } from '../../utils/terminalInput'
import SegmentedControl from '../ui/SegmentedControl.vue'

const { settings, saveSettings } = useSettings()
const { t } = useI18n()

const mobileInputModeOptions = computed(() => {
  const options = [
    { value: 'builtin', label: t('settings.keyboard.mobileInputMode.builtin') },
    { value: 'system', label: t('settings.keyboard.mobileInputMode.system') },
  ]
  // Third-party keyboard plugins surface as extra choices once their provider
  // is registered (Phase 3). builtin-keyboard/system are the two host-frozen
  // entries and are already listed above.
  const names = new Map(usePluginLoader().pluginList.value.map((p) => [p.id, p.name]))
  for (const provider of useKeyboardProviders().providers.value.values()) {
    if (provider.id === BUILTIN_KEYBOARD_ID || provider.id === SYSTEM_KEYBOARD_ID) continue
    options.push({ value: provider.id, label: names.get(provider.id) ?? provider.id })
  }
  return options
})

function onMobileInputModeChange(value: string) {
  applyAfterTerminalComposition(() => {
    settings.mobile_input_mode = value as MobileInputMode
    void saveSettings()
  })
}
</script>

<style scoped>
.mobile-input-settings {
  border: 1px solid color-mix(in srgb, var(--accent), var(--border) 68%);
  border-radius: 8px;
  padding: 14px;
  background: color-mix(in srgb, var(--bg-surface), var(--accent) 4%);
}
.mobile-input-mode-control {
  width: 100%;
}
</style>
