<template>
  <div class="log-preview">
    <div class="log-preview-chrome">
      <button
        type="button"
        class="log-preview-tab"
        :class="{ active: view === 'log' }"
        data-testid="log-tab"
        @click="showLogTab"
      >
        {{ t('logViewer.log') }}
      </button>
      <button
        type="button"
        class="log-preview-tab"
        :class="{ active: view === 'source' }"
        data-testid="log-source-tab"
        @click="showSourceTab"
      >
        {{ t('logViewer.source') }}
      </button>
      <span class="log-preview-spacer"></span>

      <template v-if="view === 'log'">
        <span class="log-preview-status" data-testid="log-status">
          {{ t('logViewer.tailInfo', { lines: lineCount }) }}
          <template v-if="tailOnly"> · {{ t('logViewer.truncated') }}</template>
        </span>
        <span v-if="paused" class="log-preview-paused">{{ t('logViewer.pause') }}</span>
        <span
          v-else-if="followEnabled && autoScrollPaused"
          class="log-preview-status"
          data-testid="log-autoscroll-paused"
        >
          {{ t('logViewer.followHint') }}
        </span>
        <span v-if="followError" class="log-preview-error" role="status">
          {{ t('logViewer.loadError') }}
        </span>
        <button
          type="button"
          class="log-preview-follow"
          :class="{ active: followEnabled }"
          data-testid="log-follow-toggle"
          :aria-pressed="followEnabled ? 'true' : 'false'"
          :title="t('logViewer.followHint')"
          :disabled="!canFollow"
          @click="toggleFollow"
        >
          {{ followEnabled ? t('logViewer.pause') : t('logViewer.follow') }}
        </button>
      </template>
      <template v-else>
        <span v-if="editorDirty" class="log-preview-dirty">{{ t('filePreview.modified') }}</span>
        <button
          v-if="showSave"
          type="button"
          class="log-preview-save"
          :disabled="!canSaveEditor"
          @click="$emit('saveEditor')"
        >
          {{ t('filePreview.save') }}
        </button>
      </template>
    </div>

    <div v-if="view === 'source'" class="log-preview-source">
      <MonacoEditor
        :model-value="editorText"
        :language="meta?.language || 'plaintext'"
        :readonly="!!meta?.truncated"
        :file-path="filePath"
        :pane-id="paneId"
        :leaf-id="leafId"
        @update:model-value="$emit('update:editorText', $event)"
        @save="$emit('saveEditor')"
        @selection-change="(p) => $emit('selection-change', p)"
      />
    </div>

    <div v-else class="log-preview-main">
      <div v-if="loading" class="log-preview-placeholder">
        {{ t('filePreview.loading') }}
      </div>
      <div v-else-if="loadError" class="log-preview-placeholder err">
        <span>{{ t('logViewer.loadError') }}</span>
        <button type="button" class="log-preview-retry" @click="reload">
          {{ t('filePreview.retry') }}
        </button>
      </div>
      <div v-else-if="lineCount === 0" class="log-preview-placeholder">
        {{ t('logViewer.empty') }}
      </div>
      <div
        v-else
        ref="scrollEl"
        class="log-preview-scroll"
        data-testid="log-scroll"
        @scroll.passive="onScroll"
      >
        <div
          v-for="(line, lineIndex) in renderedLines"
          :key="lineIndex"
          class="log-preview-line"
          :data-line="lineIndex + 1"
        >
          <span class="log-preview-line-no" aria-hidden="true">{{ lineIndex + 1 }}</span>
          <span class="log-preview-line-text">
            <span
              v-for="(segment, segmentIndex) in line"
              :key="segmentIndex"
              :style="ansiStyleToCss(segment.style)"
              >{{ segment.text }}</span
            >
          </span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import {
  computed,
  defineAsyncComponent,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from 'vue'
import { useI18n } from '../../composables/useI18n'
import { authFetch } from '../../composables/apiBase'
import { ansiStyleToCss, parseAnsiLines } from '../../utils/ansi'
import {
  capLogText,
  decodeUtf8Slice,
  parseContentRange,
  shouldAutoScroll,
  utf8ByteLength,
} from '../../utils/logTail'

const MonacoEditor = defineAsyncComponent(() => import('./MonacoEditor.vue'))

const { t } = useI18n()

const props = defineProps<{
  meta: { content?: string; truncated?: boolean; language?: string } | null
  rawUrl: string
  filePath?: string
  paneId?: string
  leafId?: string
  editorText: string
  editorDirty: boolean
  showSave: boolean
  canSaveEditor: boolean
}>()

defineEmits<{
  'update:editorText': [value: string]
  saveEditor: []
  'selection-change': [payload: { text: string; rect: DOMRect | null }]
}>()

/** Tail chunk read on first open (and when the viewer falls back to tail mode). */
const TAIL_BYTES = 256 * 1024
const POLL_INTERVAL_MS = 1200
const MAX_LINES = 5000
const MAX_BYTES = 2 * 1024 * 1024

const view = ref<'log' | 'source'>('log')
const bufferText = ref('')
const loading = ref(false)
const loadError = ref(false)
const followError = ref(false)
const followEnabled = ref(false)
const paused = ref(false)
const tailOnly = ref(false)
const autoScrollPaused = ref(false)
const fileOffset = ref<number | null>(null)
const scrollEl = ref<HTMLElement | null>(null)

let loadGeneration = 0
let loadController: AbortController | null = null
let pollTimer: ReturnType<typeof setInterval> | null = null
let pollController: AbortController | null = null
let pollInFlight = false
let pollDecoder: TextDecoder | null = null
// Bumped whenever a polling session starts or stops. A response that resolves
// after its session ended is discarded, even where abort is a no-op (the
// desktop bridge ignores AbortSignal).
let pollGeneration = 0

const renderedLines = computed(() => {
  const text = bufferText.value.replace(/\r\n?/g, '\n')
  if (text === '') return []
  const lines = parseAnsiLines(text)
  // A trailing newline produces a final empty entry; it is not a real line.
  if (lines.length > 1 && lines[lines.length - 1].length === 0) lines.pop()
  return lines
})

const lineCount = computed(() => renderedLines.value.length)
// Without a known byte offset (a partial response without Content-Range) there
// is nothing safe to poll from.
const canFollow = computed(() => fileOffset.value !== null)

function isAbortError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'name' in error
    ? (error as { name?: string }).name === 'AbortError'
    : false
}

/** Replace the buffer, enforcing the line and byte budgets. */
function capBuffer(text: string): boolean {
  const result = capLogText(text, MAX_LINES, MAX_BYTES)
  bufferText.value = result.text
  return result.trimmed
}

function applyLoadedText(
  text: string,
  offset: number | null,
  options: { tail?: boolean } = {}
): void {
  const trimmed = capBuffer(text)
  fileOffset.value = offset
  tailOnly.value = Boolean(options.tail) || trimmed
}

async function scrollToBottom(): Promise<void> {
  await nextTick()
  const element = scrollEl.value
  if (element) element.scrollTop = element.scrollHeight
}

async function loadInitial(): Promise<void> {
  const generation = ++loadGeneration
  stopFollow(false)
  loadController?.abort()
  const controller = new AbortController()
  loadController = controller

  loading.value = true
  loadError.value = false
  followError.value = false
  paused.value = false
  autoScrollPaused.value = false
  bufferText.value = ''
  fileOffset.value = null
  tailOnly.value = false

  const content = props.meta?.content
  if (!props.meta?.truncated && content != null) {
    const bytes = utf8ByteLength(content)
    applyLoadedText(content, bytes)
    loading.value = false
    await scrollToBottom()
    return
  }

  if (!props.rawUrl) {
    loading.value = false
    loadError.value = true
    return
  }

  try {
    const response = await authFetch(props.rawUrl, {
      headers: { Range: `bytes=-${TAIL_BYTES}` },
      signal: controller.signal,
    })
    if (generation !== loadGeneration) return

    if (response.status === 416) {
      applyLoadedText('', 0)
    } else if (response.status === 200 || response.status === 206) {
      const bytes = new Uint8Array(await response.arrayBuffer())
      if (generation !== loadGeneration) return
      const range = parseContentRange(response.headers.get('content-range'))
      const text = decodeUtf8Slice(bytes)
      if (range) {
        applyLoadedText(text, range.end + 1, { tail: range.start > 0 })
      } else if (response.status === 200) {
        applyLoadedText(text, bytes.length)
      } else {
        // A partial response without Content-Range leaves the offset unknown.
        applyLoadedText(text, null)
      }
    } else {
      loadError.value = true
    }
  } catch (error) {
    if (!isAbortError(error) && generation === loadGeneration) loadError.value = true
  } finally {
    if (generation === loadGeneration) {
      loading.value = false
      if (!loadError.value) await scrollToBottom()
    }
  }
}

async function pollOnce(): Promise<void> {
  if (!followEnabled.value || pollInFlight || fileOffset.value === null) return
  pollInFlight = true
  const generation = pollGeneration
  const controller = new AbortController()
  pollController = controller
  const startOffset = fileOffset.value

  try {
    const response = await authFetch(props.rawUrl, {
      headers: { Range: `bytes=${startOffset}-` },
      signal: controller.signal,
    })
    if (generation !== pollGeneration || !followEnabled.value) return

    // 416 means the offset is already at EOF: there is nothing new to read.
    if (response.status === 416) {
      followError.value = false
      return
    }
    if (response.status !== 200 && response.status !== 206) {
      followError.value = true
      return
    }

    const bytes = new Uint8Array(await response.arrayBuffer())
    if (generation !== pollGeneration || !followEnabled.value) return
    const stayAtBottom = shouldAutoScroll(scrollEl.value)

    if (response.status === 200) {
      // The server ignored Range and sent the whole file.
      pollDecoder = new TextDecoder()
      applyLoadedText(decodeUtf8Slice(bytes), bytes.length)
    } else {
      if (bytes.length > 0) {
        const chunk = pollDecoder
          ? pollDecoder.decode(bytes, { stream: true })
          : decodeUtf8Slice(bytes)
        if (capBuffer(bufferText.value + chunk)) tailOnly.value = true
      }
      const range = parseContentRange(response.headers.get('content-range'))
      fileOffset.value = range ? range.end + 1 : startOffset + bytes.length
    }

    followError.value = false
    if (stayAtBottom) {
      autoScrollPaused.value = false
      await scrollToBottom()
    } else {
      autoScrollPaused.value = true
    }
  } catch (error) {
    if (!isAbortError(error)) followError.value = true
  } finally {
    if (pollController === controller) pollController = null
    if (generation === pollGeneration) pollInFlight = false
  }
}

function beginPolling(): void {
  pollGeneration += 1
  pollDecoder = new TextDecoder()
  void pollOnce()
  pollTimer = setInterval(() => void pollOnce(), POLL_INTERVAL_MS)
}

function startFollow(): void {
  if (followEnabled.value) return
  followEnabled.value = true
  paused.value = false
  autoScrollPaused.value = false
  document.addEventListener('visibilitychange', onVisibilityChange)
  beginPolling()
}

function stopFollow(userInitiated = true): void {
  pollGeneration += 1
  if (pollTimer !== null) {
    clearInterval(pollTimer)
    pollTimer = null
  }
  pollController?.abort()
  pollController = null
  pollInFlight = false
  pollDecoder = null
  document.removeEventListener('visibilitychange', onVisibilityChange)
  if (followEnabled.value && userInitiated) paused.value = true
  followEnabled.value = false
}

function onVisibilityChange(): void {
  if (!followEnabled.value) return
  if (document.hidden) {
    pollGeneration += 1
    if (pollTimer !== null) {
      clearInterval(pollTimer)
      pollTimer = null
    }
    pollController?.abort()
    pollController = null
    pollInFlight = false
  } else if (pollTimer === null) {
    beginPolling()
  }
}

function toggleFollow(): void {
  if (followEnabled.value) stopFollow()
  else startFollow()
}

function onScroll(): void {
  if (!followEnabled.value) return
  autoScrollPaused.value = !shouldAutoScroll(scrollEl.value)
}

function showLogTab(): void {
  view.value = 'log'
}

function showSourceTab(): void {
  // No point polling a log the user cannot see.
  if (followEnabled.value) stopFollow()
  view.value = 'source'
}

function reload(): void {
  void loadInitial()
}

watch(
  () => props.rawUrl,
  () => {
    void loadInitial()
  }
)

onMounted(() => {
  void loadInitial()
})

onBeforeUnmount(() => {
  loadGeneration += 1
  stopFollow(false)
  loadController?.abort()
  loadController = null
})
</script>

<style scoped>
.log-preview {
  flex: 1 1 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--bg-surface, #141414);
}

.log-preview-chrome {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--border);
  background: var(--tab-bg);
  flex-shrink: 0;
}

.log-preview-tab {
  border: none;
  background: var(--bg, #1a1a1a);
  color: var(--fg-muted, #888);
  font-size: 12px;
  padding: 3px 8px;
  border-radius: 3px;
  cursor: pointer;
}

.log-preview-tab:hover {
  color: var(--fg);
}

.log-preview-tab.active {
  background: var(--bg-hover, #333);
  color: var(--fg-bright, #eee);
}

.log-preview-spacer {
  flex: 1 1 auto;
}

.log-preview-status,
.log-preview-dirty,
.log-preview-paused,
.log-preview-error {
  font-size: 12px;
  color: var(--fg-muted, #888);
  white-space: nowrap;
}

.log-preview-paused {
  color: var(--color-orange, #d19a66);
}

.log-preview-error {
  color: var(--color-red, #c91b00);
}

.log-preview-follow {
  border: 1px solid var(--border);
  background: var(--bg, #1a1a1a);
  color: var(--fg-muted, #888);
  font-size: 12px;
  padding: 3px 10px;
  border-radius: 3px;
  cursor: pointer;
}

.log-preview-follow:hover {
  color: var(--fg);
}

.log-preview-follow:disabled {
  opacity: 0.4;
  cursor: default;
}

.log-preview-follow.active {
  background: var(--accent, #0e639c);
  border-color: var(--accent, #0e639c);
  color: #fff;
}

.log-preview-save {
  border: none;
  background: var(--accent, #0e639c);
  color: #fff;
  font-size: 12px;
  padding: 4px 12px;
  border-radius: 3px;
  cursor: pointer;
}

.log-preview-save:disabled {
  opacity: 0.4;
  cursor: default;
}

.log-preview-source {
  flex: 1 1 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.log-preview-main {
  flex: 1 1 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.log-preview-placeholder {
  flex: 1 1 0;
  min-height: min(120px, 35vh);
  display: flex;
  flex-direction: column;
  gap: 10px;
  align-items: center;
  justify-content: center;
  color: var(--fg-muted, #888);
  font-size: clamp(12px, 2.6vmin, 17px);
  padding: clamp(8px, 2vmin, 16px);
  text-align: center;
}

.log-preview-placeholder.err {
  color: var(--color-red, #c91b00);
}

.log-preview-retry {
  border: 1px solid var(--border);
  background: var(--bg-hover);
  color: var(--fg);
  font-size: 12px;
  padding: 4px 12px;
  border-radius: 4px;
  cursor: pointer;
}

.log-preview-scroll {
  flex: 1 1 0;
  min-height: 0;
  overflow: auto;
  padding: 6px 0;
  font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
  font-size: clamp(11px, 2.2vmin, 14px);
  line-height: 1.45;
  color: var(--fg, #d4d4d4);
  tab-size: 4;
}

.log-preview-line {
  display: flex;
  width: max-content;
  min-width: 100%;
  padding-right: 12px;
}

.log-preview-line-no {
  flex: 0 0 auto;
  width: 5ch;
  padding-right: 1.2ch;
  text-align: right;
  color: var(--fg-muted, #666);
  user-select: none;
  position: sticky;
  left: 0;
  background: var(--bg-surface, #141414);
}

.log-preview-line-text {
  flex: 0 0 auto;
  white-space: pre;
}
</style>
