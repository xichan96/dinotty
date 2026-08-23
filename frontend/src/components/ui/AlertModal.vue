<template>
  <BaseDialog
    ref="dialogRef"
    :visible="visible"
    :title="title"
    size="sm"
    :close-label="confirmText"
    @close="onConfirm"
    @keydown="onKey"
  >
    <p class="dialog-message">{{ message }}</p>
    <template #footer>
      <button class="dialog-btn dialog-btn--primary focused" @click="onConfirm">
        {{ confirmText }}
      </button>
    </template>
  </BaseDialog>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { settings } from '../../composables/useSettings'
import BaseDialog from './BaseDialog.vue'

const props = defineProps<{
  visible: boolean
  title: string
  message: string
  confirmText: string
}>()

const emit = defineEmits<{ confirm: [] }>()

const dialogRef = ref<InstanceType<typeof BaseDialog> | null>(null)
const spaceConfirmIssued = ref(false)

watch(
  () => props.visible,
  (visible) => {
    if (visible) spaceConfirmIssued.value = false
  },
  { immediate: true }
)

function onConfirm() {
  emit('confirm')
}

function onKey(e: KeyboardEvent) {
  if (
    settings.space_confirms_dialogs &&
    e.key === ' ' &&
    !e.shiftKey &&
    !e.ctrlKey &&
    !e.altKey &&
    !e.metaKey
  ) {
    const activeElement = document.activeElement
    if (
      activeElement instanceof HTMLElement &&
      dialogRef.value?.rootEl?.contains(activeElement) &&
      (activeElement.matches('button, input, textarea, select, [contenteditable]') ||
        activeElement.isContentEditable)
    ) {
      return
    }

    e.preventDefault()
    e.stopImmediatePropagation()
    if (!spaceConfirmIssued.value) {
      spaceConfirmIssued.value = true
      onConfirm()
    }
    return
  }
  if (e.key === 'Enter') {
    e.preventDefault()
    e.stopPropagation()
    onConfirm()
  }
}
</script>
