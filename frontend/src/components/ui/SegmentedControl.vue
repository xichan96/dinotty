<template>
  <div class="segmented" role="tablist" :aria-label="ariaLabel">
    <button
      v-for="option in options"
      :key="option.value"
      type="button"
      role="tab"
      :aria-selected="modelValue === option.value"
      :class="{ selected: modelValue === option.value }"
      @click="select(option.value)"
      @keydown.left.prevent="moveSelection(-1)"
      @keydown.right.prevent="moveSelection(1)"
    >
      {{ option.label }}
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  modelValue: string
  options: Array<{ value: string; label: string }>
  ariaLabel?: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const selectedIndex = computed(() => props.options.findIndex((option) => option.value === props.modelValue))

function select(value: string) {
  emit('update:modelValue', value)
}

function moveSelection(offset: number) {
  const nextIndex = selectedIndex.value + offset
  if (nextIndex < 0 || nextIndex >= props.options.length) return
  select(props.options[nextIndex].value)
}
</script>

<style scoped>
.segmented {
  display: flex;
  width: 100%;
  border: 1px solid var(--border);
  border-radius: 4px;
  overflow: hidden;
}

.segmented button {
  flex: 1 1 0;
  min-width: 0;
  border: 0;
  border-right: 1px solid var(--border);
  padding: 6px 10px;
  background: transparent;
  color: var(--fg-muted);
  cursor: pointer;
  font-size: 12px;
}

.segmented button:last-child {
  border-right: 0;
}

.segmented button.selected {
  background: var(--fg-muted);
  color: var(--bg);
}
</style>
