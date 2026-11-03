<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useSettingsStore } from './stores/settingsStore'
import { loadThemePacks } from './composables/useThemePacks'
import { effectiveTheme } from './composables/useDeviceThemeSelection'
import { probeWindowSession } from './composables/windowSessionProbe'
import {
  PREVIEW_WINDOW_NAVIGATE_EVENT,
  type PreviewWindowPayload,
} from './composables/previewWindowBridge'
import { usePreviewWindowDock } from './composables/usePreviewWindowDock'
import { tauriInvoke } from './composables/useTransport'
import { t } from './composables/useI18n'
import FileWorkspacePreview from './components/preview/FileWorkspacePreview.vue'
import WebPreview from './components/preview/WebPreview.vue'

/**
 * Native preview window (`preview.html?kind=files|web&…`).
 *
 * Desktop-only companion of the split/floating previews: the settings'
 * `preview_open_modes` may route the file browser and web preview here. The
 * window owns no tab state — it talks to the same server as the main window
 * and keeps its own workspace state, scoped by `window:files:<sourcePaneId>`.
 *
 * Windows are multi-instance: a file browser window is bound to the terminal
 * session it browses (one window per `sourcePaneId`, so different workspaces
 * get their own), and every web preview open creates a fresh window. Reopening
 * the same file-browser session focuses its window and emits
 * `preview-window-navigate` with the new target.
 *
 * Dragging the native title bar over the main window merges this preview into
 * the current workspace (`usePreviewWindowDock`).
 */

type ShellState = 'loading' | 'ready' | 'error'

const params = new URLSearchParams(window.location.search)
const kind: 'files' | 'web' = params.get('kind') === 'web' ? 'web' : 'files'

function tauriWindowLabel(): string {
  try {
    const tauri = (
      window as unknown as {
        __TAURI__?: { window?: { getCurrentWindow?: () => { label?: string } } }
      }
    ).__TAURI__
    return tauri?.window?.getCurrentWindow?.()?.label ?? ''
  } catch {
    return ''
  }
}

/** Identity of this native window; carried in the entry URL so the in-window
 *  close affordance can target this instance instead of its kind. */
const windowLabel = params.get('windowLabel')?.trim() || tauriWindowLabel()

const settingsStore = useSettingsStore()

const state = ref<ShellState>('loading')
const sourcePaneId = ref(params.get('sourcePaneId') ?? '')
const filePath = ref(params.get('path') ?? '')
const webUrl = ref(params.get('url') ?? '')

const filesRef = ref<InstanceType<typeof FileWorkspacePreview> | null>(null)
const webRef = ref<InstanceType<typeof WebPreview> | null>(null)

/** Per-window workspace state key; switching source terminals remounts the
 *  file browser under a distinct key so nothing bleeds between sessions. */
const paneId = computed(() => `window:files:${sourcePaneId.value || 'none'}`)

let stopThemeWatch: (() => void) | null = null
let navigateListenerDisposed = false
let unlistenNavigate: (() => void) | null = null
let disposeDock: (() => void) | null = null

/** True while this window's title bar is over the main window. */
const dockHint = ref(false)

/** Live target carried when the window is docked into the main window. */
function currentLocation(): { path?: string; url?: string } {
  if (kind === 'files') {
    const path = filesRef.value?.getCurrentPath?.() || filePath.value
    return { path }
  }
  const url = webRef.value?.getCurrentUrl?.() || webUrl.value
  return { url }
}

type NavigateListener = (
  event: string,
  handler: (event: { payload?: PreviewWindowPayload }) => void
) => Promise<() => void>

async function closeWindow() {
  if (!windowLabel) {
    console.warn('[preview-window] close skipped: window label unavailable')
    return
  }
  try {
    await tauriInvoke('close_preview_window', { windowLabel })
  } catch (error) {
    console.warn('[preview-window] close failed', error)
  }
}

function onNavigate(payload: PreviewWindowPayload | null | undefined) {
  if (!payload || payload.kind !== kind) return
  if (kind === 'web') {
    if (payload.url) webUrl.value = payload.url
    return
  }
  const nextSource = payload.sourcePaneId || sourcePaneId.value
  if (!nextSource) return
  const nextPath = payload.path ?? ''
  if (nextSource !== sourcePaneId.value) {
    // The bound terminal changed: remount under the new state key and boot
    // straight into the requested path.
    sourcePaneId.value = nextSource
    filePath.value = nextPath
    return
  }
  if (nextPath) void filesRef.value?.openFromTerminal(nextPath)
}

function listenNavigate() {
  const tauri = (window as unknown as { __TAURI__?: { event?: { listen?: NavigateListener } } })
    .__TAURI__
  const listen = tauri?.event?.listen
  if (typeof listen !== 'function') return
  void Promise.resolve(
    listen(PREVIEW_WINDOW_NAVIGATE_EVENT, (event) => {
      if (!navigateListenerDisposed) onNavigate(event?.payload)
    })
  )
    .then((unlisten) => {
      if (navigateListenerDisposed) {
        if (typeof unlisten === 'function') unlisten()
        return
      }
      unlistenNavigate = typeof unlisten === 'function' ? unlisten : null
    })
    .catch((error: unknown) => {
      console.warn('[preview-window] navigate listener failed', error)
    })
}

onMounted(async () => {
  try {
    if (!(await probeWindowSession())) {
      state.value = 'error'
      return
    }

    // Same theme behavior as the main and detached windows: re-apply when an
    // installed theme lands after the first settings paint.
    stopThemeWatch = watch(effectiveTheme, () => settingsStore.applyTheme())
    void loadThemePacks()
    await settingsStore.load()
    settingsStore.applyTheme()

    state.value = 'ready'
    await nextTick()
    listenNavigate()
    // Dragging this window's title bar onto the main window merges it into the
    // current workspace.
    disposeDock = usePreviewWindowDock({
      windowLabel,
      kind,
      sourcePaneId: () => sourcePaneId.value,
      getLocation: currentLocation,
      onHintChange: (active) => {
        dockHint.value = active
      },
      onRejected: () => {
        dockHint.value = false
      },
    })
  } catch (error) {
    console.error('[preview-window] bootstrap failed:', error)
    state.value = 'error'
  }
})

onBeforeUnmount(() => {
  navigateListenerDisposed = true
  unlistenNavigate?.()
  unlistenNavigate = null
  disposeDock?.()
  disposeDock = null
  dockHint.value = false
  stopThemeWatch?.()
  stopThemeWatch = null
})
</script>

<template>
  <div class="preview-window-shell" :data-state="state">
    <template v-if="state === 'ready'">
      <FileWorkspacePreview
        v-if="kind === 'files' && sourcePaneId"
        :key="sourcePaneId"
        ref="filesRef"
        :visible="true"
        :pane-id="paneId"
        :source-pane-id="sourcePaneId"
        :initial-path="filePath || undefined"
        :is-window="true"
      />
      <WebPreview
        v-else-if="kind === 'web'"
        ref="webRef"
        :visible="true"
        :url="webUrl"
        @close="closeWindow"
      />
      <p
        v-else
        class="preview-window-shell__status preview-window-shell__status--error"
        role="alert"
      >
        {{ t('previewWindow.error') }}
      </p>
    </template>

    <p v-else-if="state === 'loading'" class="preview-window-shell__status" role="status">
      {{ t('previewWindow.loading') }}
    </p>
    <p v-else class="preview-window-shell__status preview-window-shell__status--error" role="alert">
      {{ t('previewWindow.error') }}
    </p>

    <div
      v-if="state === 'ready' && dockHint"
      class="preview-window-shell__dock-hint"
      aria-hidden="true"
    >
      {{ t('previewWindow.dockHint') }}
    </div>
  </div>
</template>

<style scoped>
.preview-window-shell {
  position: relative;
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  min-height: 0;
  background: var(--bg, #1e1e1e);
  color: var(--fg, #c7c7c7);
  overflow: hidden;
}

/* Both preview components are self-contained full-bleed panels. */
.preview-window-shell > * {
  flex: 1;
  min-width: 0;
  min-height: 0;
}

.preview-window-shell__status {
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0;
  font-size: 13px;
  opacity: 0.75;
}

.preview-window-shell__status--error {
  color: var(--danger, #e5484d);
  opacity: 1;
}

/* Absolutely positioned so it does not take a flex slot from the preview. */
.preview-window-shell__dock-hint {
  position: absolute;
  top: 10px;
  left: 50%;
  z-index: 10;
  padding: 6px 14px;
  border-radius: 999px;
  background: var(--accent, #3b82f6);
  color: #fff;
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
  pointer-events: none;
  transform: translateX(-50%);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.35);
}
</style>
