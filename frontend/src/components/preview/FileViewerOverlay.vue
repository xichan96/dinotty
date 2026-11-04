<template>
  <Teleport to="body">
    <div
      v-if="store.request"
      class="file-viewer-overlay"
      role="dialog"
      aria-modal="true"
      :aria-label="t('fileViewer.label')"
    >
      <header class="file-viewer-overlay__header">
        <span class="file-viewer-overlay__title" :title="heading">{{ heading }}</span>
        <button
          ref="closeRef"
          type="button"
          class="file-viewer-overlay__close"
          :title="t('fileViewer.close')"
          :aria-label="t('fileViewer.close')"
          @click="store.hide()"
        >
          <X :size="18" />
        </button>
      </header>
      <div class="file-viewer-overlay__content">
        <FileViewer
          :key="store.request.request_id"
          :source-pane-id="store.request.pane_id"
          :path="store.request.path"
          :title="store.request.title"
        />
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { X } from 'lucide-vue-next'
import { useI18n } from '../../composables/useI18n'
import { useFileViewerStore } from '../../stores/fileViewerStore'
import FileViewer from './FileViewer.vue'

/**
 * Full-screen fallback shell for `open_file_viewer` on web/mobile, and on
 * desktop when the native window cannot be created. Mounted lazily by App.vue
 * while a request is pending, so Monaco stays out of the first-paint chunk.
 *
 * One request is visible at a time; a newer request replaces it (the key on
 * FileViewer resets all preview state, including audio/office handlers).
 */

const { t } = useI18n()
const store = useFileViewerStore()

const closeRef = ref<HTMLButtonElement | null>(null)
let previouslyFocused: HTMLElement | null = null

function basename(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, '')
  const cut = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
  return cut >= 0 ? trimmed.slice(cut + 1) : trimmed
}

const heading = computed(() => {
  const request = store.request
  if (!request) return ''
  return request.title?.trim() || basename(request.path)
})

function onKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Escape') return
  event.preventDefault()
  event.stopPropagation()
  store.hide()
}

function activate(): void {
  previouslyFocused =
    document.activeElement instanceof HTMLElement ? document.activeElement : null
  document.addEventListener('keydown', onKeydown, true)
  void nextTick(() => closeRef.value?.focus())
}

function deactivate(): void {
  document.removeEventListener('keydown', onKeydown, true)
  const target = previouslyFocused
  previouslyFocused = null
  target?.focus?.()
}

watch(
  () => Boolean(store.request),
  (open) => {
    if (open) activate()
    else deactivate()
  },
  { immediate: true }
)

onBeforeUnmount(deactivate)
</script>

<style scoped>
.file-viewer-overlay {
  position: fixed;
  inset: 0;
  z-index: calc(var(--z-dialog, 2100) + 50);
  display: flex;
  flex-direction: column;
  height: 100vh;
  height: 100dvh;
  background: var(--bg, #1e1e1e);
  color: var(--fg, #c7c7c7);
  overscroll-behavior: contain;
}

.file-viewer-overlay__header {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 12px;
  padding-top: calc(8px + env(safe-area-inset-top, 0px));
  padding-right: max(12px, env(safe-area-inset-right, 0px));
  padding-left: max(12px, env(safe-area-inset-left, 0px));
  border-bottom: 1px solid var(--border, #2a2a2a);
}

.file-viewer-overlay__title {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  font-weight: 600;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.file-viewer-overlay__close {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 6px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--fg-muted, #888);
  cursor: pointer;
}

.file-viewer-overlay__close:hover,
.file-viewer-overlay__close:focus-visible {
  background: var(--bg-hover, rgba(255, 255, 255, 0.08));
  color: var(--fg, #c7c7c7);
}

.file-viewer-overlay__content {
  flex: 1 1 auto;
  display: flex;
  min-height: 0;
  padding-bottom: env(safe-area-inset-bottom, 0px);
}
</style>
