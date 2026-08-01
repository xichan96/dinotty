<template>
  <Teleport to="body">
    <div v-if="visible" class="tray-backdrop" @click.self="chooseTerminal('cancel')">
      <section class="tray-dialog" role="dialog" aria-modal="true" :aria-label="title">
        <header>
          <div class="title-group">
            <span class="tray-glyph" aria-hidden="true">▣</span>
            <h2>{{ title }}</h2>
          </div>
          <button
            type="button"
            class="icon-close"
            :aria-label="cancelText"
            @click="chooseTerminal('cancel')"
          >
            &times;
          </button>
        </header>
        <p>{{ message }}</p>
        <footer>
          <button type="button" class="tray-action cancel" @click="chooseTerminal('cancel')">
            {{ cancelText }}
          </button>
          <button type="button" class="tray-action settings" @click="openSettings">
            {{ openSettingsText }}
          </button>
          <button type="button" class="tray-action confirm" @click="chooseTerminal('confirm')">
            {{ confirmText }}
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

<style scoped>
.tray-backdrop {
  position: fixed;
  inset: 0;
  z-index: 2110;
  display: grid;
  place-items: center;
  background: rgba(0, 0, 0, 0.55);
}

.tray-dialog {
  width: min(520px, 92vw);
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--bg-surface);
  box-shadow: 0 12px 36px rgba(0, 0, 0, 0.45);
}

header,
.title-group {
  display: flex;
  align-items: center;
}

header {
  justify-content: space-between;
  padding: 16px 18px 0;
}

.title-group {
  gap: 10px;
}

.tray-glyph {
  display: grid;
  width: 28px;
  height: 28px;
  place-items: center;
  border-radius: 7px;
  background: color-mix(in srgb, var(--accent) 18%, transparent);
  color: var(--accent);
  font-size: 15px;
}

h2 {
  margin: 0;
  color: var(--fg-bright);
  font-size: 15px;
}

p {
  margin: 0;
  padding: 14px 18px 8px;
  color: var(--fg);
  font-size: 13px;
  line-height: 1.6;
}

footer {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
  padding: 14px 18px 18px;
}

.icon-close,
.tray-action {
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

.tray-action {
  padding: 7px 13px;
  border-radius: 6px;
  font-size: 13px;
}

.icon-close:hover,
.tray-action:hover {
  background: var(--bg-hover);
  color: var(--fg);
}

.tray-action.settings {
  border: 1px solid var(--border);
  color: var(--fg-bright);
}

.tray-action.confirm {
  background: var(--accent);
  color: var(--bg, #111827);
}

.tray-action.confirm:hover {
  filter: brightness(1.08);
}
</style>
