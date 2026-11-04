<template>
  <!-- Opt-in IME-anchor diagnostics (#323). Enabled with #ime-debug in the
       URL; records the buffer state at composition start and the helper
       textarea's final position, then copies a JSON dump to the clipboard so a
       Windows report does not need DevTools. -->
  <div class="ime-debug-overlay">
    <div class="ime-debug-title">IME diag: {{ count }} entries (Ctrl+Shift+Alt+I)</div>
    <div v-if="last" class="ime-debug-line">{{ last }}</div>
    <div class="ime-debug-actions">
      <button type="button" @click="copy">{{ copyLabel }}</button>
      <button type="button" @click="clear">Clear</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import {
  clearImeDiagnostics,
  copyImeDiagnostics,
  imeDiagnosticsEntries,
  type ImeDiagEntry,
} from '../../utils/imeDiagnostics'

const count = ref(0)
const last = ref('')
const copyLabel = ref('Copy JSON')

let timer = 0
let copyResetTimer = 0

function sample() {
  const entries = imeDiagnosticsEntries()
  count.value = entries.length
  const tail: ImeDiagEntry | undefined = entries[entries.length - 1]
  if (!tail) {
    last.value = ''
    return
  }
  const anchor = tail.anchor ? ` ${tail.anchor.source}@${tail.anchor.col},${tail.anchor.row}` : ''
  const cursor = tail.cursor ? ` cursor=${tail.cursor.x},${tail.cursor.y}` : ''
  const dom = tail.dom ? ` dom=${tail.dom.taLeft}/${tail.dom.taTop}` : ''
  const hit =
    tail.hit === null ? ' hit=none' : tail.hit ? ` hit=${tail.hit.col},${tail.hit.row}` : ''
  last.value = `${tail.kind}${anchor}${hit}${cursor}${dom}`
}

async function copy() {
  const ok = await copyImeDiagnostics()
  copyLabel.value = ok ? 'Copied' : 'Copy failed'
  window.clearTimeout(copyResetTimer)
  copyResetTimer = window.setTimeout(() => (copyLabel.value = 'Copy JSON'), 1500)
}

function clear() {
  clearImeDiagnostics()
  sample()
}

onMounted(() => {
  sample()
  timer = window.setInterval(sample, 500)
})

onBeforeUnmount(() => {
  window.clearInterval(timer)
  window.clearTimeout(copyResetTimer)
})
</script>

<style scoped>
.ime-debug-overlay {
  position: fixed;
  right: 8px;
  bottom: 8px;
  z-index: 10000;
  max-width: min(560px, 92vw);
  padding: 6px 8px;
  border: 1px solid var(--accent);
  border-radius: var(--radius);
  background: var(--bg-surface);
  color: var(--fg);
  font-family: monospace;
  font-size: 10px;
  line-height: 1.4;
  opacity: 0.95;
}

.ime-debug-title {
  font-weight: 600;
}

.ime-debug-line {
  margin-top: 2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--fg-muted);
}

.ime-debug-actions {
  display: flex;
  gap: 6px;
  margin-top: 5px;
}

.ime-debug-actions button {
  padding: 1px 6px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: transparent;
  color: var(--fg);
  font: inherit;
  cursor: pointer;
}

.ime-debug-actions button:hover {
  border-color: var(--accent);
}
</style>
