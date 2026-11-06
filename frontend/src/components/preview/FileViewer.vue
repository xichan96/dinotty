<template>
  <div
    class="file-viewer"
    role="region"
    :aria-label="t('fileViewer.label')"
    :aria-busy="loading ? 'true' : 'false'"
  >
    <header class="file-viewer-toolbar">
      <button
        type="button"
        class="file-viewer-reload"
        :title="t('fileViewer.reload')"
        :aria-label="t('fileViewer.reload')"
        :disabled="loading"
        @click="reload"
      >
        <RotateCw :size="14" />
      </button>
      <div class="file-viewer-heading">
        <span class="file-viewer-title" :title="displayTitle">{{ displayTitle }}</span>
        <span class="file-viewer-path" :title="path">{{ path }}</span>
      </div>
    </header>

    <FilePreviewContent
      ref="previewContentRef"
      :pane-id="sourcePaneId"
      :file-path="path"
      :preview-loading="loading"
      :preview-err="error"
      :selected-rel="path"
      :selected-is-dir="false"
      :meta="meta"
      :raw-url="rawUrl"
      :show-save="false"
      :audio-title="audioTitle"
      :audio-sub="''"
      :audio-time-now="audio.audioTimeNow.value"
      :audio-time-total="audio.audioTimeTotal.value"
      :audio-seek-value="audio.audioSeekValue.value"
      :audio-vol-value="audio.audioVolValue.value"
      :audio-playing="audio.audioPlaying.value"
      :editor-dirty="false"
      :editor-text="ephemeralBuffer"
      :can-save-editor="false"
      :md-show-preview="mdShowPreview"
      :html-show-preview="htmlShowPreview"
      :markdown-editor-html="markdownHtml"
      :office-loading="office.officeLoading.value"
      :office-err="office.officeErr.value"
      :office-html="office.officeHtml.value"
      :read-only="true"
      @audio-time-update="audio.onAudioTimeUpdate(audioRef)"
      @audio-loaded-metadata="audio.onAudioLoadedMetadata(audioRef)"
      @audio-ended="audio.onAudioEnded()"
      @audio-seek-input="(ev: Event) => audio.onAudioSeekInput(audioRef, ev)"
      @seek-audio="(d: number) => audio.seekAudio(audioRef, d)"
      @toggle-audio="audio.toggleAudio(audioRef)"
      @audio-volume-input="(ev: Event) => audio.onAudioVolumeInput(audioRef, ev)"
      @update:md-show-preview="mdShowPreview = $event"
      @update:html-show-preview="htmlShowPreview = $event"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { RotateCw } from 'lucide-vue-next'
import { useI18n } from '../../composables/useI18n'
import { apiUrl, authFetch, getApiBase, getAuthToken } from '../../composables/apiBase'
import { isTauri } from '../../composables/useTransport'
import { renderMarkdownPreview } from '../../composables/useFileEditor'
import { useOfficePreview } from '../../composables/useOfficePreview'
import { useAudioPlayer } from '../../composables/useAudioPlayer'
import FilePreviewContent from '../workspace/FilePreviewContent.vue'

interface ViewerMeta {
  kind: string
  content?: string
  language?: string
  truncated?: boolean
  message?: string
}

const props = defineProps<{
  /** Real terminal pane id; every follow-up preview request is scoped by it. */
  sourcePaneId: string
  /** Workspace-relative path, as delivered by the server. */
  path: string
  title?: string
}>()

const { t } = useI18n()

const meta = ref<ViewerMeta | null>(null)
// Start busy so the first paint shows the loading state, not "pick a file".
const loading = ref(true)
const error = ref<string | null>(null)
const rawBust = ref(0)
const mdShowPreview = ref(false)
const htmlShowPreview = ref(false)
const markdownHtml = ref('')

const office = useOfficePreview({ paneId: () => props.sourcePaneId })
const audio = useAudioPlayer()

const previewContentRef = ref<InstanceType<typeof FilePreviewContent> | null>(null)
const audioRef = computed(() => previewContentRef.value?.audioRef ?? null)

const fileName = computed(() => props.path.split(/[\\/]/).pop() || props.path)
const displayTitle = computed(() => props.title?.trim() || fileName.value)
const audioTitle = computed(() => fileName.value)
const ephemeralBuffer = computed(() => meta.value?.content ?? '')

const rawUrl = computed(() => {
  const q = new URLSearchParams({ pane_id: props.sourcePaneId, path: props.path })
  if (isTauri()) {
    const token = getAuthToken()
    if (token) q.set('token', token)
  }
  if (rawBust.value) q.set('_t', String(rawBust.value))
  return apiUrl(`/api/workspace/raw?${q}`)
})

/**
 * Monotonic load token: a slow response for a previous path must never
 * overwrite the file the user is looking at now.
 */
let loadToken = 0

function errorText(code: unknown): string {
  return typeof code === 'string' && code
    ? `${t('fileViewer.error')} (${code})`
    : t('fileViewer.error')
}

async function load(): Promise<void> {
  const token = ++loadToken
  loading.value = true
  error.value = null
  try {
    await getApiBase()
    const q = new URLSearchParams({ pane_id: props.sourcePaneId, path: props.path })
    const res = await authFetch(apiUrl(`/api/workspace/meta?${q}`))
    if (token !== loadToken) return
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      if (token !== loadToken) return
      meta.value = null
      error.value = errorText(body?.error)
      return
    }
    const next = (await res.json()) as ViewerMeta
    if (token !== loadToken) return

    meta.value = next
    mdShowPreview.value = next?.kind === 'markdown'
    htmlShowPreview.value = next?.kind === 'html'

    if (next?.kind === 'office') void office.loadOfficePreview(props.path)

    if (next?.kind === 'markdown') {
      const html = await renderMarkdownPreview(next.content ?? '', props.path, props.sourcePaneId)
      if (token !== loadToken) return
      markdownHtml.value = html
    } else {
      markdownHtml.value = ''
    }
  } catch {
    if (token === loadToken) {
      meta.value = null
      error.value = errorText(null)
    }
  } finally {
    if (token === loadToken) loading.value = false
  }
}

/** Reload the current file, busting the raw-response cache. */
function reload(): void {
  rawBust.value += 1
  void load()
}

function resetForNewTarget(): void {
  meta.value = null
  error.value = null
  mdShowPreview.value = false
  htmlShowPreview.value = false
  markdownHtml.value = ''
  office.resetOffice()
  rawBust.value += 1
}

watch(
  () => [props.sourcePaneId, props.path] as const,
  () => {
    resetForNewTarget()
    void load()
  }
)

onMounted(() => {
  void load()
})

defineExpose({ reload })
</script>

<style scoped>
.file-viewer {
  display: flex;
  flex-direction: column;
  flex: 1 1 0;
  min-width: 0;
  min-height: 0;
  height: 100%;
  background: var(--bg-surface, #141414);
  color: var(--fg);
}

.file-viewer-toolbar {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  padding: 6px 10px;
  border-bottom: 1px solid var(--border, #2a2a2a);
}

.file-viewer-reload {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 4px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--fg-muted, #888);
  cursor: pointer;
}

.file-viewer-reload:hover:not(:disabled) {
  background: var(--bg-hover, rgba(255, 255, 255, 0.08));
  color: var(--fg);
}

.file-viewer-reload:disabled {
  opacity: 0.35;
  cursor: default;
}

.file-viewer-heading {
  display: flex;
  align-items: baseline;
  gap: 10px;
  min-width: 0;
  overflow: hidden;
}

.file-viewer-title {
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.file-viewer-path {
  color: var(--fg-muted, #888);
  font-family: var(--font-mono, monospace);
  font-size: 12px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Markdown prose is centred and capped, like a document reader. */
.file-viewer :deep(.file-md-body) {
  width: 100%;
  max-width: 860px;
  margin: 0 auto;
}
</style>
