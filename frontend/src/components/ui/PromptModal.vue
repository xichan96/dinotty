<template>
  <BaseDialog
    :visible="visible"
    :title="title"
    size="sm"
    :close-label="cancelText"
    @close="onCancel"
    @keydown="onKey"
  >
    <input
      ref="inputRef"
      v-model="inputValue"
      class="prompt-input"
      :placeholder="placeholder"
      autocomplete="off"
      spellcheck="false"
    />
    <template #footer>
      <button class="dialog-btn" @click="onCancel">{{ cancelText }}</button>
      <button class="dialog-btn dialog-btn--primary" :disabled="!canSubmit" @click="onConfirm">
        {{ confirmText }}
      </button>
    </template>
  </BaseDialog>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import BaseDialog from './BaseDialog.vue'

const props = defineProps<{
  visible: boolean
  title: string
  defaultValue: string
  placeholder: string
  confirmText: string
  cancelText: string
}>()

const emit = defineEmits<{
  confirm: [value: string]
  cancel: []
}>()

const inputRef = ref<HTMLInputElement | null>(null)
const inputValue = ref('')

const canSubmit = computed(() => inputValue.value.trim().length > 0)

watch(
  () => props.visible,
  (visible) => {
    if (visible) {
      inputValue.value = props.defaultValue
      nextTick(() => {
        inputRef.value?.focus()
        inputRef.value?.select()
      })
    }
  },
  { immediate: true }
)

function onConfirm() {
  if (!canSubmit.value) return
  emit('confirm', inputValue.value)
}

function onCancel() {
  emit('cancel')
}

function onKey(e: KeyboardEvent) {
  if (e.key === 'Enter') {
    e.preventDefault()
    e.stopPropagation()
    onConfirm()
  }
}
</script>

<style scoped>
.prompt-input {
  background: var(--bg-input);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  color: var(--fg);
  font: inherit;
  font-size: 16px;
  padding: 8px 10px;
  outline: none;
  width: 100%;
  box-sizing: border-box;
}

.prompt-input:focus {
  border-color: var(--accent);
}
</style>
