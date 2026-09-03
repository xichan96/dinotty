<template>
  <div :class="['collapse-wrapper', `collapse-${level}`]">
    <button
      type="button"
      :class="['collapse-title', `collapse-title--${level}`]"
      :aria-expanded="open"
      :aria-controls="bodyId"
      @click="open = !open"
    >
      <ChevronRight :size="14" class="collapse-chevron" :class="{ open }" />
      {{ title }}
    </button>
    <div :id="bodyId" class="collapse-body" :class="{ open }">
      <div class="collapse-inner">
        <slot />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, useId } from 'vue'
import { ChevronRight } from 'lucide-vue-next'

const props = withDefaults(
  defineProps<{
    title: string
    level?: 'group' | 'section'
    defaultOpen?: boolean
  }>(),
  {
    level: 'group',
    defaultOpen: false,
  }
)

const open = ref(props.defaultOpen)
const bodyId = useId()
</script>

<style scoped>
/* ── Title row ── */
.collapse-title {
  display: flex;
  align-items: center;
  gap: 4px;
  width: 100%;
  font: inherit;
  text-align: left;
  background: none;
  border: none;
  color: inherit;
  cursor: pointer;
  user-select: none;
  transition: background 0.15s;
  border-radius: 4px;
  margin: -4px -4px 0;
  padding: 4px;
}
.collapse-title:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: -2px;
}
.collapse-title:hover {
  background: var(--bg-hover);
}
.collapse-title:hover .collapse-chevron {
  color: var(--fg);
}

/* Group-level title */
.collapse-title--group {
  font-size: 11px;
  font-weight: 600;
  color: var(--fg-muted);
  text-transform: uppercase;
  letter-spacing: 0.8px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--border);
  margin-bottom: 14px;
}

/* Section-level title */
.collapse-title--section {
  font-size: 13px;
  font-weight: 600;
  color: var(--fg-muted);
  margin-bottom: 12px;
}

/* ── Chevron ── */
.collapse-chevron {
  flex-shrink: 0;
  color: var(--fg-muted);
  transition:
    transform 0.25s ease,
    color 0.15s;
}
.collapse-chevron.open {
  transform: rotate(90deg);
}

/* ── Collapse animation (CSS grid trick) ── */
.collapse-body {
  display: grid;
  grid-template-rows: 0fr;
  transition: grid-template-rows 0.25s ease;
}
.collapse-body.open {
  grid-template-rows: 1fr;
}
.collapse-inner {
  overflow: hidden;
}
</style>
