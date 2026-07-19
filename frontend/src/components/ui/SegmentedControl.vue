<template>
  <div class="segmented" role="radiogroup" :aria-label="ariaLabel">
    <button
      v-for="(option, index) in options"
      :key="option.value"
      :ref="(element) => setButtonRef(element, index)"
      type="button"
      role="radio"
      :aria-checked="modelValue === option.value"
      :tabindex="selectedIndex === index || (selectedIndex === -1 && index === 0) ? 0 : -1"
      :class="{ selected: modelValue === option.value }"
      @click="select(option.value)"
      @keydown.left.prevent="moveSelection(-1, index)"
      @keydown.up.prevent="moveSelection(-1, index)"
      @keydown.right.prevent="moveSelection(1, index)"
      @keydown.down.prevent="moveSelection(1, index)"
      @keydown.home.prevent="moveToIndex(0)"
      @keydown.end.prevent="moveToIndex(options.length - 1)"
    >
      {{ option.label }}
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, type ComponentPublicInstance } from 'vue'

const props = defineProps<{
  modelValue: string
  options: Array<{ value: string; label: string }>
  ariaLabel?: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const selectedIndex = computed(() => props.options.findIndex((option) => option.value === props.modelValue))
const buttonElements = ref<Array<HTMLButtonElement | undefined>>([])

function setButtonRef(element: Element | ComponentPublicInstance | null, index: number) {
  buttonElements.value[index] = element instanceof HTMLButtonElement ? element : undefined
}

function select(value: string) {
  emit('update:modelValue', value)
}

function moveSelection(offset: number, currentIndex: number) {
  const baseIndex = selectedIndex.value === -1 ? currentIndex : selectedIndex.value
  const nextIndex = baseIndex + offset
  if (nextIndex < 0 || nextIndex >= props.options.length) return
  moveToIndex(nextIndex)
}

function moveToIndex(index: number) {
  if (index < 0 || index >= props.options.length) return
  const option = props.options[index]
  if (!option) return

  select(option.value)
  nextTick(() => buttonElements.value[index]?.focus())
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
