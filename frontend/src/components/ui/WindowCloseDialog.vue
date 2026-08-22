<template>
  <BaseDialog
    :visible="visible"
    :title="title"
    size="sm"
    :close-label="cancelText"
    @close="choose('cancel')"
  >
    <p class="dialog-message">{{ message }}</p>
    <template #footer>
      <button type="button" class="dialog-btn close-action cancel" @click="choose('cancel')">
        {{ cancelText }}
      </button>
      <button
        v-if="canHideToTray"
        type="button"
        class="dialog-btn dialog-btn--primary close-action hide"
        @click="choose('hide')"
      >
        {{ hideText }}
      </button>
      <button
        type="button"
        class="dialog-btn dialog-btn--danger close-action quit"
        @click="choose('quit')"
      >
        {{ quitText }}
      </button>
    </template>
  </BaseDialog>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import BaseDialog from './BaseDialog.vue'

const props = defineProps<{
  visible: boolean
  canHideToTray: boolean
  title: string
  message: string
  hideText: string
  quitText: string
  cancelText: string
}>()

const emit = defineEmits<{ hide: []; quit: []; cancel: [] }>()
const actionTaken = ref(false)

watch(
  () => props.visible,
  (visible) => {
    if (visible) actionTaken.value = false
  }
)

function choose(action: 'hide' | 'quit' | 'cancel') {
  if (actionTaken.value) return
  actionTaken.value = true
  if (action === 'hide') emit('hide')
  else if (action === 'quit') emit('quit')
  else emit('cancel')
}
</script>
