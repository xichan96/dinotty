<template>
  <CollapsibleSection
    class="system-keyboard-advanced-gap"
    :title="t('settings.advancedText')"
    level="group"
  >
    <div class="settings-row">
      <label>{{ t('settings.keyboard.quickSendThreshold') }}</label>
      <input
        v-model.number="settings.quick_send_threshold"
        type="number"
        min="0"
        max="5000"
        step="1"
        class="settings-input-number"
        data-setting="quick-send-threshold"
        @change="onQuickSendThresholdChange"
      />
    </div>
    <p class="settings-hint">{{ t('settings.keyboard.quickSendThresholdHint') }}</p>
    <div class="settings-row">
      <label>{{ t('settings.keyboard.sound') }}</label>
      <label class="toggle">
        <input v-model="settings.keyboard_sound" type="checkbox" @change="saveSettings()" />
        <span class="toggle-track"><span class="toggle-thumb"></span></span>
      </label>
    </div>
    <div class="settings-row keyboard-guard-row">
      <label>{{ t('settings.keyboard.guardMode.label') }}</label>
      <SegmentedControl
        class="keyboard-guard-control"
        data-setting="keyboard-guard-mode"
        :model-value="settings.keyboard_guard_mode"
        :options="keyboardGuardModeOptions"
        :aria-label="t('settings.keyboard.guardMode.label')"
        @update:model-value="onKeyboardGuardModeChange"
      />
    </div>
    <p class="settings-hint">{{ t('settings.keyboard.guardMode.hint') }}</p>
    <div class="settings-row">
      <label>{{ t('settings.text.imeKeyboardOverlapPx') }}</label>
      <input
        v-model.number="imeKeyboardOverlapPx"
        type="number"
        min="0"
        max="300"
        step="8"
        class="settings-input-number"
        data-setting="ime-keyboard-overlap-px"
        @change="saveSettings()"
      />
    </div>
    <p class="settings-hint">{{ t('settings.text.imeKeyboardOverlapHint') }}</p>
  </CollapsibleSection>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { imeKeyboardOverlapPx, useSettings } from '../../composables/useSettings'
import { useI18n } from '../../composables/useI18n'
import { normalizeQuickSendThreshold } from '../../utils/keyboardEditUtils'
import type { KeyboardGuardMode } from '../../utils/keyboardGuardMode'
import CollapsibleSection from './CollapsibleSection.vue'
import SegmentedControl from '../ui/SegmentedControl.vue'

const { settings, saveSettings } = useSettings()
const { t } = useI18n()

const keyboardGuardModeOptions = computed(() => [
  { value: 'off', label: t('settings.keyboard.guardMode.off') },
  { value: 'collapse_only', label: t('settings.keyboard.guardMode.collapseOnly') },
  { value: 'open_only', label: t('settings.keyboard.guardMode.openOnly') },
  { value: 'both', label: t('settings.keyboard.guardMode.both') },
])

function onKeyboardGuardModeChange(value: string) {
  settings.keyboard_guard_mode = value as KeyboardGuardMode
  void saveSettings()
}

function onQuickSendThresholdChange() {
  settings.quick_send_threshold = normalizeQuickSendThreshold(settings.quick_send_threshold)
  void saveSettings()
}
</script>

<style scoped>
.system-keyboard-advanced-gap {
  margin-top: 16px;
}
.keyboard-guard-row {
  align-items: stretch;
  flex-direction: column;
}
.keyboard-guard-control {
  width: 100%;
}
</style>
