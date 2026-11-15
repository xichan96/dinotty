<template>
  <div v-if="visible" class="devtools-panel">
    <div class="devtools-header">
      <div class="devtools-tabs">
        <button
          type="button"
          class="devtools-tab"
          :class="{ active: tab === 'console' }"
          @click="tab = 'console'"
        >
          <Bug :size="12" />
          {{ t('devtools.console') }}
          <span v-if="errorCount > 0" class="devtools-badge">{{ errorCount }}</span>
        </button>
        <button
          type="button"
          class="devtools-tab"
          :class="{ active: tab === 'network' }"
          @click="tab = 'network'"
        >
          <Globe :size="12" />
          {{ t('devtools.network') }}
          <span v-if="networkEntries.length > 0" class="devtools-badge net">{{
            networkEntries.length
          }}</span>
        </button>
      </div>
      <div class="devtools-header-actions">
        <template v-if="tab === 'console'">
          <button
            v-for="lv in levels"
            :key="lv"
            type="button"
            class="devtools-level-btn"
            :class="{ active: activeLevels.has(lv), ['level-' + lv]: true }"
            :title="lv"
            @click="toggleLevel(lv)"
          >
            {{ levelLabels[lv] }}
          </button>
        </template>
        <button
          type="button"
          class="devtools-action-btn"
          :title="t('devtools.clear')"
          @click="tab === 'console' ? $emit('clearConsole') : $emit('clearNetwork')"
        >
          <Trash2 :size="12" />
        </button>
        <button
          type="button"
          class="devtools-action-btn"
          :title="t('devtools.close')"
          @click="$emit('update:visible', false)"
        >
          <X :size="12" />
        </button>
      </div>
    </div>

    <!-- Console view -->
    <template v-if="tab === 'console'">
      <div class="devtools-body" ref="bodyRef">
        <div
          v-for="entry in filteredEntries"
          :key="entry.id"
          class="devtools-log"
          :class="'devtools-log-' + entry.level"
        >
          <span class="devtools-log-icon">{{ levelIcons[entry.level] }}</span>
          <span class="devtools-log-content">
            <template v-for="(arg, i) in entry.args" :key="i">
              <span v-if="i > 0" class="devtools-log-sep"> </span>
              <span class="devtools-log-text">{{ arg }}</span>
            </template>
          </span>
          <span class="devtools-log-time">{{ formatTime(entry.ts) }}</span>
        </div>
        <div v-if="filteredEntries.length === 0" class="devtools-empty">
          {{ t('devtools.noLogs') }}
        </div>
      </div>
      <form class="devtools-input" @submit.prevent="onEval">
        <span class="devtools-input-prompt">&gt;</span>
        <input
          ref="inputRef"
          v-model="evalCode"
          type="text"
          :placeholder="t('devtools.evalPlaceholder')"
          autocomplete="off"
          spellcheck="false"
          @keydown="onKeydown"
        />
      </form>
    </template>

    <!-- Network view -->
    <template v-if="tab === 'network'">
      <div class="devtools-body" ref="netBodyRef">
        <div v-for="entry in networkEntries" :key="entry.id" class="devtools-net">
          <span class="devtools-net-method" :class="'method-' + entry.method">{{
            entry.method
          }}</span>
          <span class="devtools-net-url" :title="entry.url">{{ truncateUrl(entry.url) }}</span>
          <span class="devtools-net-status" :class="statusClass(entry.status)">{{
            entry.status || 'ERR'
          }}</span>
          <span class="devtools-net-duration">{{ entry.duration }}ms</span>
          <span class="devtools-log-time">{{ formatTime(entry.ts) }}</span>
        </div>
        <div v-if="networkEntries.length === 0" class="devtools-empty">
          {{ t('devtools.noLogs') }}
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue'
import { Bug, Trash2, X, Globe } from 'lucide-vue-next'
import { useI18n } from '../../composables/useI18n'
import type { ConsoleEntry, NetworkEntry } from '../../composables/useDevTools'

const props = defineProps<{
  visible: boolean
  consoleEntries: ConsoleEntry[]
  networkEntries: NetworkEntry[]
  errorCount: number
}>()

const emit = defineEmits<{
  'update:visible': [v: boolean]
  clearConsole: []
  clearNetwork: []
  eval: [code: string]
}>()

const { t } = useI18n()

const tab = ref<'console' | 'network'>('console')

// Console state
const levels = ['error', 'warn', 'info', 'debug', 'log'] as const
const activeLevels = ref(new Set<string>(levels))
const levelLabels: Record<string, string> = {
  error: 'E',
  warn: 'W',
  info: 'I',
  debug: 'D',
  log: 'L',
}
const levelIcons: Record<string, string> = {
  error: '✖',
  warn: '⚠',
  info: 'ℹ',
  debug: '⋅',
  log: '▸',
}

function toggleLevel(lv: string) {
  if (activeLevels.value.has(lv)) {
    activeLevels.value.delete(lv)
  } else {
    activeLevels.value.add(lv)
  }
  activeLevels.value = new Set(activeLevels.value)
}

const filteredEntries = computed(() =>
  props.consoleEntries.filter((e) => activeLevels.value.has(e.level))
)

const evalCode = ref('')
const evalHistory = ref<string[]>([])
const historyIndex = ref(-1)
const inputRef = ref<HTMLInputElement>()
const bodyRef = ref<HTMLDivElement>()
const netBodyRef = ref<HTMLDivElement>()

function onEval() {
  const code = evalCode.value.trim()
  if (!code) return
  evalHistory.value.push(code)
  historyIndex.value = evalHistory.value.length
  emit('eval', code)
  evalCode.value = ''
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'ArrowUp') {
    if (historyIndex.value > 0) {
      historyIndex.value--
      evalCode.value = evalHistory.value[historyIndex.value]
    }
    e.preventDefault()
  } else if (e.key === 'ArrowDown') {
    if (historyIndex.value < evalHistory.value.length - 1) {
      historyIndex.value++
      evalCode.value = evalHistory.value[historyIndex.value]
    } else {
      historyIndex.value = evalHistory.value.length
      evalCode.value = ''
    }
    e.preventDefault()
  }
}

function formatTime(ts: number): string {
  const d = new Date(ts)
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}.${d.getMilliseconds().toString().padStart(3, '0')}`
}

function truncateUrl(url: string): string {
  if (url.length <= 60) return url
  try {
    const u = new URL(url, location.href)
    const path = u.pathname + u.search
    if (path.length <= 50) return u.host + path
    return u.host + path.slice(0, 47) + '...'
  } catch {
    return url.length <= 60 ? url : url.slice(0, 57) + '...'
  }
}

function statusClass(s: number): string {
  if (!s || s === 0) return 'status-err'
  if (s >= 200 && s < 300) return 'status-2xx'
  if (s >= 300 && s < 400) return 'status-3xx'
  if (s >= 400 && s < 500) return 'status-4xx'
  return 'status-5xx'
}

// Keep a pinned list at the bottom after a batch lands. Awaiting nextTick
// before measuring means one layout read per update batch instead of reading a
// stale pre-append layout and then writing again; hidden tabs (clientHeight 0)
// are skipped entirely so a mounted-but-inactive preview never forces layout.
async function scrollToBottomIfPinned(el: HTMLElement | undefined) {
  if (!el) return
  await nextTick()
  if (el.clientHeight === 0) return
  const isAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40
  if (isAtBottom) el.scrollTop = el.scrollHeight
}

// Auto-scroll console
watch(
  () => props.consoleEntries.length,
  () => {
    if (tab.value !== 'console') return
    void scrollToBottomIfPinned(bodyRef.value)
  }
)

// Auto-scroll network
watch(
  () => props.networkEntries.length,
  () => {
    if (tab.value !== 'network') return
    void scrollToBottomIfPinned(netBodyRef.value)
  }
)

// Focus input when panel becomes visible in console tab
watch(
  () => props.visible,
  async (v) => {
    if (v && tab.value === 'console') {
      await nextTick()
      inputRef.value?.focus()
    }
  }
)
</script>

<style scoped>
.devtools-panel {
  display: flex;
  flex-direction: column;
  border-top: 1px solid var(--border, #333);
  background: var(--bg, #1a1a1a);
  height: 220px;
  flex-shrink: 0;
}

.devtools-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 2px 8px;
  background: var(--tab-bg, #252525);
  border-bottom: 1px solid var(--border, #333);
  flex-shrink: 0;
  min-height: 28px;
}

.devtools-tabs {
  display: flex;
  align-items: center;
  gap: 1px;
}

.devtools-tab {
  display: flex;
  align-items: center;
  gap: 4px;
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  color: var(--fg-muted, #888);
  font-size: 11px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 3px 3px 0 0;
  cursor: pointer;
  position: relative;
}

.devtools-tab:hover {
  color: var(--fg, #ccc);
}

.devtools-tab.active {
  color: var(--fg, #ccc);
  border-bottom-color: var(--accent, #89b4fa);
}

.devtools-badge {
  background: #e74c3c;
  color: #fff;
  font-size: 10px;
  font-weight: 700;
  padding: 0 5px;
  border-radius: 8px;
  min-width: 16px;
  text-align: center;
  line-height: 16px;
}

.devtools-badge.net {
  background: #3498db;
}

.devtools-header-actions {
  display: flex;
  align-items: center;
  gap: 2px;
}

.devtools-level-btn {
  background: none;
  border: 1px solid transparent;
  color: var(--fg-muted, #666);
  font-size: 10px;
  font-weight: 700;
  padding: 1px 4px;
  border-radius: 3px;
  cursor: pointer;
  line-height: 1;
}

.devtools-level-btn.active {
  border-color: var(--border, #444);
  color: var(--fg, #ccc);
}

.devtools-level-btn.active.level-error {
  color: #e74c3c;
}
.devtools-level-btn.active.level-warn {
  color: #f39c12;
}
.devtools-level-btn.active.level-info {
  color: #3498db;
}
.devtools-level-btn.active.level-debug {
  color: #9b59b6;
}
.devtools-level-btn.active.level-log {
  color: var(--fg-muted, #888);
}

.devtools-action-btn {
  background: none;
  border: none;
  color: var(--fg-muted, #888);
  padding: 2px 4px;
  border-radius: 3px;
  cursor: pointer;
  display: flex;
  align-items: center;
}

.devtools-action-btn:hover {
  color: var(--fg, #ccc);
  background: var(--tab-hover-bg, #333);
}

.devtools-body {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  font-family: var(--font-mono);
  font-size: 11px;
  line-height: 1.5;
  padding: 2px 0;
}

/* Console entries */
.devtools-log {
  display: flex;
  align-items: flex-start;
  padding: 1px 8px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.03);
  gap: 6px;
}

.devtools-log:hover {
  background: rgba(255, 255, 255, 0.03);
}

.devtools-log-icon {
  flex-shrink: 0;
  width: 14px;
  text-align: center;
  font-size: 10px;
  line-height: 1.5;
}

.devtools-log-error .devtools-log-icon {
  color: #e74c3c;
}
.devtools-log-warn .devtools-log-icon {
  color: #f39c12;
}
.devtools-log-info .devtools-log-icon {
  color: #3498db;
}
.devtools-log-debug .devtools-log-icon {
  color: #9b59b6;
}
.devtools-log-log .devtools-log-icon {
  color: var(--fg-muted, #666);
}

.devtools-log-content {
  flex: 1;
  min-width: 0;
  word-break: break-all;
  white-space: pre-wrap;
}

.devtools-log-error {
  color: #e74c3c;
  background: rgba(231, 76, 60, 0.06);
}
.devtools-log-warn {
  color: #f39c12;
  background: rgba(243, 156, 18, 0.06);
}
.devtools-log-info {
  color: var(--fg, #ccc);
}
.devtools-log-debug {
  color: var(--fg-muted, #888);
}
.devtools-log-log {
  color: var(--fg, #ccc);
}

.devtools-log-sep {
  margin: 0 2px;
}

.devtools-log-time {
  flex-shrink: 0;
  color: var(--fg-muted, #555);
  font-size: 10px;
  line-height: 1.5;
}

/* Network entries */
.devtools-net {
  display: flex;
  align-items: center;
  padding: 1px 8px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.03);
  gap: 6px;
}

.devtools-net:hover {
  background: rgba(255, 255, 255, 0.03);
}

.devtools-net-method {
  flex-shrink: 0;
  font-weight: 700;
  font-size: 10px;
  width: 36px;
  text-align: center;
  padding: 1px 0;
  border-radius: 2px;
}

.method-GET {
  color: #2ecc71;
}
.method-POST {
  color: #f39c12;
}
.method-PUT {
  color: #3498db;
}
.method-DELETE {
  color: #e74c3c;
}
.method-PATCH {
  color: #9b59b6;
}

.devtools-net-url {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--fg, #ccc);
}

.devtools-net-status {
  flex-shrink: 0;
  font-weight: 700;
  font-size: 10px;
  width: 30px;
  text-align: center;
}

.status-2xx {
  color: #2ecc71;
}
.status-3xx {
  color: #3498db;
}
.status-4xx {
  color: #f39c12;
}
.status-5xx {
  color: #e74c3c;
}
.status-err {
  color: #e74c3c;
}

.devtools-net-duration {
  flex-shrink: 0;
  color: var(--fg-muted, #888);
  font-size: 10px;
  width: 48px;
  text-align: right;
}

/* Shared */
.devtools-empty {
  padding: 16px 8px;
  text-align: center;
  color: var(--fg-muted, #666);
  font-size: 11px;
}

.devtools-input {
  display: flex;
  align-items: center;
  border-top: 1px solid var(--border, #333);
  padding: 0 8px;
  flex-shrink: 0;
}

.devtools-input-prompt {
  color: #3498db;
  font-family: var(--font-mono);
  font-size: 12px;
  font-weight: 700;
  margin-right: 6px;
}

.devtools-input input {
  flex: 1;
  min-width: 0;
  background: none;
  border: none;
  color: var(--fg, #ccc);
  font-family: var(--font-mono);
  font-size: 12px;
  padding: 4px 0;
  outline: none;
}

.devtools-input input::placeholder {
  color: var(--fg-muted, #555);
}
</style>
