<template>
  <Teleport to="body">
    <div v-if="visible" class="close-backdrop" @click.self="choose('cancel')">
      <section class="close-dialog" role="dialog" aria-modal="true" :aria-label="title">
        <header>
          <h2>{{ title }}</h2>
          <button
            type="button"
            class="icon-close"
            :aria-label="cancelText"
            @click="choose('cancel')"
          >
            &times;
          </button>
        </header>
        <p>{{ message }}</p>
        <footer>
          <button type="button" class="close-action cancel" @click="choose('cancel')">
            {{ cancelText }}
          </button>
          <button
            v-if="canHideToTray"
            type="button"
            class="close-action hide"
            @click="choose('hide')"
          >
            {{ hideText }}
          </button>
          <button type="button" class="close-action quit" @click="choose('quit')">
            {{ quitText }}
          </button>
        </footer>
      </section>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'

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

<style scoped>
.close-backdrop {
  position: fixed;
  inset: 0;
  z-index: 2100;
  display: grid;
  place-items: center;
  background: rgba(0, 0, 0, 0.5);
}

.close-dialog {
  width: min(420px, 90vw);
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-surface);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
}

header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px 0;
}

h2 {
  margin: 0;
  color: var(--fg-bright);
  font-size: 14px;
}

p {
  margin: 0;
  padding: 10px 16px;
  color: var(--fg);
  font-size: 13px;
  line-height: 1.5;
}

footer {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 16px 14px;
}

.icon-close,
.close-action {
  border: 0;
  background: none;
  color: var(--fg-muted);
  cursor: pointer;
}

.icon-close {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  font-size: 16px;
}

.close-action {
  padding: 6px 14px;
  border-radius: 5px;
  font-size: 13px;
}

.icon-close:hover,
.close-action:hover {
  background: var(--bg-hover);
  color: var(--fg);
}

.close-action.hide {
  color: var(--accent);
}

.close-action.quit {
  color: var(--color-red, #ef4444);
}
</style>
