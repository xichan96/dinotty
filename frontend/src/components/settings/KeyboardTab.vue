<template>
  <div>
    <MobileInputSection />
    <KeybindingSection />
    <ActionKeyboardEditor />
    <SystemKeyboardEditor />
    <AdvancedKeyboardSettings />
  </div>
</template>

<script setup lang="ts">
import MobileInputSection from './MobileInputSection.vue'
import KeybindingSection from './KeybindingSection.vue'
import ActionKeyboardEditor from './ActionKeyboardEditor.vue'
import SystemKeyboardEditor from './SystemKeyboardEditor.vue'
import AdvancedKeyboardSettings from './AdvancedKeyboardSettings.vue'
</script>
