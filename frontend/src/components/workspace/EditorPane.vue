<template>
  <div
    ref="paneEl"
    class="editor-pane"
    :class="{ active: isActive, 'drag-over': !!dropZone }"
    :data-leaf-id="leafId"
    @mousedown="$emit('focus', leafId)"
    @dragover.prevent="onPaneDragOver"
    @dragleave="onPaneDragLeave"
    @drop.prevent="onPaneDrop"
  >
    <div v-if="dropZone" class="editor-pane-drop-zone" :class="`zone-${dropZone}`">
      {{ dropZone === 'center' ? t('filePreview.dropReplace') : t('filePreview.dropSplit') }}
    </div>
    <div v-if="showHeader" class="editor-pane-header">
      <span v-if="isInActiveGroup" class="editor-pane-group-band"></span>
      <span class="editor-pane-title" :title="displayTitle">
        {{ displayTitle || t('filePreview.pickFile') }}
        <span v-if="editor.editorDirty.value" class="editor-pane-dirty">●</span>
      </span>
      <button
        type="button"
        class="editor-pane-close"
        :title="t('editorSplit.closePane')"
        @click.stop="$emit('close', leafId)"
      >
        &times;
      </button>
    </div>
    <FilePreviewContent
      ref="previewContentRef"
      :pane-id="paneId"
      :file-path="filePath ?? undefined"
      :leaf-id="leafId"
      :preview-loading="previewLoading"
      :preview-err="previewErr"
      :selected-rel="filePath"
      :selected-is-dir="isDir"
      :meta="meta"
      :raw-url="rawUrl"
      :show-save="showHeader"
      :audio-title="audioTitle"
      :audio-sub="audioSub"
      :audio-time-now="audio.audioTimeNow.value"
      :audio-time-total="audio.audioTimeTotal.value"
      :audio-seek-value="audio.audioSeekValue.value"
      :audio-vol-value="audio.audioVolValue.value"
      :audio-playing="audio.audioPlaying.value"
      :editor-dirty="editor.editorDirty.value"
      :editor-text="editor.editorText.value"
      :can-save-editor="editor.canSaveEditor.value"
      :md-show-preview="editor.mdShowPreview.value"
      :html-show-preview="editor.htmlShowPreview.value"
      :markdown-editor-html="editor.markdownEditorHtml.value"
      :office-loading="office.officeLoading.value"
      :office-err="office.officeErr.value"
      :office-html="office.officeHtml.value"
      @audio-time-update="audio.onAudioTimeUpdate(audioRef)"
      @audio-loaded-metadata="audio.onAudioLoadedMetadata(audioRef)"
      @audio-ended="audio.onAudioEnded()"
      @audio-seek-input="(ev: Event) => audio.onAudioSeekInput(audioRef, ev)"
      @seek-audio="(d: number) => audio.seekAudio(audioRef, d)"
      @toggle-audio="audio.toggleAudio(audioRef)"
      @audio-volume-input="(ev: Event) => audio.onAudioVolumeInput(audioRef, ev)"
      @update:md-show-preview="editor.mdShowPreview.value = $event"
      @update:html-show-preview="editor.htmlShowPreview.value = $event"
      @update:editor-text="editor.editorText.value = $event"
      @save-editor="editor.saveEditor"
      @selection-change="editor.onEditorSelectionChange"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount, type Ref } from 'vue'
import * as monaco from 'monaco-editor'
import { useI18n } from '../../composables/useI18n'
import { getApiBase, apiUrl, authFetch, getAuthToken } from '../../composables/apiBase'
import type { DropPosition } from '../../types/pane'
import { isTauri } from '../../composables/useTransport'
import { createFileEditor } from '../../composables/useFileEditor'
import { useOfficePreview } from '../../composables/useOfficePreview'
import { useAudioPlayer } from '../../composables/useAudioPlayer'
import { whenEditorReady } from '../../composables/useEditorRegistry'
import { useCursorGroup, isCursorBroadcasting } from '../../composables/useCursorGroup'
import FilePreviewContent from './FilePreviewContent.vue'

const props = defineProps<{
  leafId: string
  paneId: string
  filePath: string | null
  isDir: boolean
  isActive: boolean
  showHeader: boolean
}>()

const emit = defineEmits<{
  focus: [leafId: string]
  close: [leafId: string]
  'file-drop': [leafId: string, rel: string, position: DropPosition]
}>()

const dropZone = ref<DropPosition | null>(null)

function getDropPosition(ev: DragEvent): DropPosition {
  const el = ev.currentTarget as HTMLElement
  const rect = el.getBoundingClientRect()
  const x = ev.clientX - rect.left
  const y = ev.clientY - rect.top
  const w = rect.width
  const h = rect.height
  const edge = Math.min(Math.min(w, h) * 0.25, 40)

  if (x < edge) return 'left'
  if (x > w - edge) return 'right'
  if (y < edge) return 'top'
  if (y > h - edge) return 'bottom'
  return 'center'
}

function isTreeMoveDrag(ev: DragEvent): boolean {
  const t = ev.dataTransfer?.types
  if (!t) return false
  return t.includes ? t.includes('application/x-tree-move') : (t as any).contains('application/x-tree-move')
}

function onPaneDragOver(ev: DragEvent) {
  if (!isTreeMoveDrag(ev)) return
  ev.dataTransfer!.dropEffect = 'copy'
  dropZone.value = getDropPosition(ev)
}

function onPaneDragLeave() {
  dropZone.value = null
}

function onPaneDrop(ev: DragEvent) {
  dropZone.value = null
  const rel = ev.dataTransfer?.getData('application/x-tree-move')
  if (!rel) return
  const position = getDropPosition(ev)
  emit('file-drop', props.leafId, rel, position)
}

const { t } = useI18n()

// --- Per-pane state ---
const meta = ref<any | null>(null)
const previewLoading = ref(false)
const previewErr = ref('')

const selectedRel: Ref<string | null> = computed(() => props.filePath)
const selectedIsDir: Ref<boolean> = computed(() => props.isDir)

const cursorGroup = useCursorGroup()
const isInActiveGroup = computed(() => {
  const id = cursorGroup.activeGroupId.value
  if (!id) return false
  const g = cursorGroup.groups.value.find((x) => x.id === id)
  return !!g?.entries.some((e) => e.leafId === props.leafId)
})

const editor = createFileEditor({
  paneId: () => props.paneId,
  selectedRel: selectedRel as Ref<string | null>,
  selectedIsDir,
  meta,
})

const office = useOfficePreview({ paneId: () => props.paneId })
const audio = useAudioPlayer()

const previewContentRef = ref<InstanceType<typeof FilePreviewContent> | null>(null)
const audioRef = computed(() => previewContentRef.value?.audioRef ?? null)

const audioTitle = computed(() =>
  props.filePath ? props.filePath.split('/').pop() || props.filePath : ''
)
const audioSub = computed(() => '')

const rawUrl = computed(() => {
  if (!props.filePath) return ''
  const q = new URLSearchParams({ pane_id: props.paneId, path: props.filePath })
  if (isTauri()) {
    const token = getAuthToken()
    if (token) q.set('token', token)
  }
  return apiUrl(`/api/workspace/raw?${q}`)
})

const displayTitle = computed(() => {
  if (!props.filePath) return ''
  return props.filePath.split('/').pop() || props.filePath
})

// --- Load file when filePath changes ---
watch(
  () => [props.filePath, props.isDir] as const,
  async ([newPath, isDir]) => {
    if (!newPath || isDir) {
      meta.value = null
      previewErr.value = ''
      editor.editorText.value = ''
      editor.editorBaseline.value = ''
      return
    }

    const filePath = newPath as string
    previewLoading.value = true
    previewErr.value = ''
    meta.value = null
    office.officeLoading.value = false
    office.officeErr.value = ''
    office.officeHtml.value = ''

    try {
      await getApiBase()
      const q = new URLSearchParams({ pane_id: props.paneId, path: filePath })
      const res = await authFetch(apiUrl(`/api/workspace/meta?${q}`))
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        previewErr.value = j.error || 'error'
        return
      }
      meta.value = await res.json()
      if (meta.value?.kind === 'office') void office.loadOfficePreview(filePath)
    } catch {
      previewErr.value = 'network'
    } finally {
      previewLoading.value = false
    }
  },
  { immediate: true }
)

// --- Sync editor text from meta ---
watch(
  () => [meta.value?.kind, meta.value?.content],
  () => {
    const m = meta.value
    if (m?.kind === 'text' || m?.kind === 'markdown') {
      const c = m.content ?? ''
      editor.editorText.value = c
      editor.editorBaseline.value = c
    } else {
      editor.editorText.value = ''
      editor.editorBaseline.value = ''
    }
  }
)

// Reset preview toggles on file change
watch(
  () => props.filePath,
  () => {
    editor.mdShowPreview.value = false
    editor.htmlShowPreview.value = false
    editor.editorSelection.value = null
  }
)

// Reset audio on rawUrl change
watch(
  () => [rawUrl.value, meta.value?.kind],
  () => {
    if (meta.value?.kind !== 'audio') return
    audio.resetAudio(audioRef.value)
  }
)

// Tauri: listen for native file-drop CustomEvent bridged from useFileOperations
const paneEl = ref<HTMLElement | null>(null)

function onNativeFileDrop(e: Event) {
  const detail = (e as CustomEvent).detail
  if (!detail) return
  emit('file-drop', detail.leafId || props.leafId, detail.rel, detail.position as DropPosition)
}

const editorEventDisposers: monaco.IDisposable[] = []

onMounted(() => {
  paneEl.value?.addEventListener('file-drop', onNativeFileDrop)
  whenEditorReady(props.leafId).then((editor) => {
    editorEventDisposers.push(
      editor.onDidChangeModelContent((e) => {
        if (isCursorBroadcasting(props.leafId)) return
        cursorGroup.broadcastChange(props.leafId, e.changes)
      }),
      editor.onKeyDown((e) => {
        if (e.keyCode !== monaco.KeyCode.KeyZ) return
        if (!(e.ctrlKey || e.metaKey)) return
        if (!isInActiveGroup.value) return
        e.preventDefault()
        e.stopPropagation()
        if (e.shiftKey) cursorGroup.groupRedo()
        else cursorGroup.groupUndo()
      })
    )
  })
})

onBeforeUnmount(() => {
  paneEl.value?.removeEventListener('file-drop', onNativeFileDrop)
  for (const d of editorEventDisposers) d.dispose()
  editorEventDisposers.length = 0
})
</script>

<style scoped>
.editor-pane {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  position: relative;
  border: 1px solid transparent;
  transition: border-color 0.15s;
}

.editor-pane.active {
  border-color: var(--accent, #4d80ff);
}

.editor-pane-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 8px;
  background: var(--tab-bg, #252525);
  border-bottom: 1px solid var(--border, #333);
  flex-shrink: 0;
  min-height: 28px;
}

.editor-pane-group-band {
  width: 4px;
  height: 14px;
  border-radius: 2px;
  background: var(--accent, #4d80ff);
  flex-shrink: 0;
}

.editor-pane-title {
  flex: 1;
  min-width: 0;
  font-size: 12px;
  color: var(--fg-muted, #888);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.editor-pane-dirty {
  color: var(--color-orange, #d19a66);
  margin-left: 4px;
}

.editor-pane-close {
  flex-shrink: 0;
  width: 20px;
  height: 20px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--fg-muted, #888);
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}

.editor-pane-close:hover {
  background: var(--bg-hover, #333);
  color: var(--fg, #ccc);
}

.editor-pane.drag-over {
  border-color: rgba(59, 130, 246, 0.5);
}

.editor-pane-drop-zone {
  position: absolute;
  z-index: 10;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(59, 130, 246, 0.15);
  border: 2px dashed rgba(59, 130, 246, 0.6);
  border-radius: 4px;
  font-size: 12px;
  color: var(--fg, #c7c7c7);
  pointer-events: none;
  transition: all 0.1s ease;
}

.editor-pane-drop-zone.zone-center {
  inset: 4px;
}

.editor-pane-drop-zone.zone-left {
  top: 4px;
  bottom: 4px;
  left: 4px;
  width: 30%;
}

.editor-pane-drop-zone.zone-right {
  top: 4px;
  bottom: 4px;
  right: 4px;
  width: 30%;
}

.editor-pane-drop-zone.zone-top {
  top: 4px;
  left: 4px;
  right: 4px;
  height: 30%;
}

.editor-pane-drop-zone.zone-bottom {
  bottom: 4px;
  left: 4px;
  right: 4px;
  height: 30%;
}
</style>
