<template>
  <Teleport to="body">
    <div
      v-if="visible"
      class="ctx-backdrop"
      @click.self="$emit('close')"
      @contextmenu.self.prevent="$emit('close')"
    >
      <div class="ctx-menu" :style="menuStyle">
        <button
          v-for="(item, i) in items"
          :key="i"
          class="ctx-item"
          :class="{ danger: item.danger, disabled: item.disabled }"
          @click="onSelect(item)"
        >
          <component :is="item.icon" v-if="item.icon" :size="14" class="ctx-icon" />
          <span>{{ item.label }}</span>
        </button>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { Component } from 'vue'

export interface ContextMenuItem {
  label: string
  icon?: Component
  danger?: boolean
  disabled?: boolean
  action: () => void
}

const props = defineProps<{
  visible: boolean
  x: number
  y: number
  items: ContextMenuItem[]
}>()

const emit = defineEmits<{
  close: []
}>()

const menuStyle = computed(() => {
  // Keep menu within viewport
  const menuW = 180
  const menuH = props.items.length * 36 + 8
  const vw = window.innerWidth
  const vh = window.innerHeight
  const left = Math.min(props.x, vw - menuW - 8)
  const top = Math.min(props.y, vh - menuH - 8)
  return { left: `${left}px`, top: `${top}px` }
})

function onSelect(item: ContextMenuItem) {
  if (item.disabled) return
  item.action()
  emit('close')
}
</script>

<style scoped>
.ctx-backdrop {
  position: fixed;
  inset: 0;
  z-index: 2200;
}
.ctx-menu {
  position: fixed;
  min-width: 160px;
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 4px 0;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
  z-index: 2201;
}
.ctx-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 14px;
  cursor: pointer;
  border: none;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 13px;
  width: 100%;
  text-align: left;
  -webkit-tap-highlight-color: transparent;
}
.ctx-item:hover {
  background: var(--bg-hover);
}
.ctx-item.danger {
  color: var(--color-red, #ef4444);
}
.ctx-item.disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.ctx-icon {
  flex-shrink: 0;
  color: var(--text-muted, #888);
}
.ctx-item.danger .ctx-icon {
  color: var(--color-red, #ef4444);
}
</style>
