<template>
  <BaseDialog
    :visible="visible"
    :title="title"
    size="lg"
    :close-label="cancelText"
    @close="chooseTerminal('cancel')"
  >
    <p class="dialog-message">{{ message }}</p>
    <template #footer>
      <button type="button" class="dialog-btn tray-action cancel" @click="chooseTerminal('cancel')">
        {{ cancelText }}
      </button>
      <button type="button" class="dialog-btn tray-action settings" @click="openSettings">
        {{ openSettingsText }}
      </button>
      <button
        type="button"
        class="dialog-btn dialog-btn--primary tray-action confirm"
        @click="chooseTerminal('confirm')"
      >
        {{ confirmText }}
      </button>
    </template>
  </BaseDialog>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import BaseDialog from './BaseDialog.vue'

const props = defineProps<{
  visible: boolean
  title: string
  message: string
  openSettingsText: string
  confirmText: string
  cancelText: string
}>()

const emit = defineEmits<{ 'open-settings': []; confirm: []; cancel: [] }>()
const settingsOpened = ref(false)
const terminalActionTaken = ref(false)

watch(
  () => props.visible,
  (visible) => {
    if (visible) {
      settingsOpened.value = false
      terminalActionTaken.value = false
    }
  }
)

function openSettings() {
  if (settingsOpened.value || terminalActionTaken.value) return
  settingsOpened.value = true
  emit('open-settings')
}

function chooseTerminal(action: 'confirm' | 'cancel') {
  if (terminalActionTaken.value) return
  terminalActionTaken.value = true
  if (action === 'confirm') emit('confirm')
  else emit('cancel')
}
</script>
