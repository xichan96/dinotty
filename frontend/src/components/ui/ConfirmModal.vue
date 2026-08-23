<template>
  <BaseDialog
    ref="dialogRef"
    :visible="visible"
    :title="title"
    size="sm"
    :close-label="cancelText"
    @close="onCancel"
    @keydown="onKey"
  >
    <p class="dialog-message">{{ message }}</p>
    <template #footer>
      <button class="dialog-btn" :class="{ focused: focusIndex === 0 }" @click="onCancel">
        {{ cancelText }}
      </button>
      <button
        class="dialog-btn"
        :class="[
          danger ? 'dialog-btn--danger' : 'dialog-btn--primary',
          { focused: focusIndex === 1 },
        ]"
        @click="onConfirm"
      >
        {{ confirmText }}
      </button>
    </template>
  </BaseDialog>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { settings } from '../../composables/useSettings'
import BaseDialog from './BaseDialog.vue'

const props = withDefaults(
  defineProps<{
    visible: boolean
    title: string
    message: string
    confirmText: string
    cancelText: string
    danger?: boolean
  }>(),
  { danger: true }
)

const emit = defineEmits<{
  confirm: []
  cancel: []
}>()

const focusIndex = ref(0)
const dialogRef = ref<InstanceType<typeof BaseDialog> | null>(null)
const spaceConfirmIssued = ref(false)

watch(
  () => props.visible,
  (visible) => {
    if (visible) {
      focusIndex.value = 0
      spaceConfirmIssued.value = false
    }
  },
  { immediate: true }
)

function onConfirm() {
  emit('confirm')
}

function onCancel() {
  emit('cancel')
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
  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'Tab') {
    e.preventDefault()
    e.stopPropagation()
    focusIndex.value = focusIndex.value === 0 ? 1 : 0
  } else if (e.key === 'Enter') {
    e.preventDefault()
    e.stopPropagation()
    if (focusIndex.value === 0) onCancel()
    else onConfirm()
  }
}
</script>
