import { computed, onScopeDispose } from 'vue'
import type { SyncOpenFileViewer } from '../types/protocol'
import { useFileViewerStore } from '../stores/fileViewerStore'
import { onOpenFileViewer } from './useSyncWebSocket'
import { isTauri, tauriInvoke } from './useTransport'

function basename(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, '')
  const cut = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
  return cut >= 0 ? trimmed.slice(cut + 1) : trimmed
}

/**
 * Presents `open_file_viewer` requests from the sync WebSocket.
 *
 * Desktop opens (or focuses and navigates) the native file-viewer window; when
 * that fails, and everywhere else (web/mobile, and detached windows if they
 * ever registered this), the full-screen overlay in the main window is used.
 * Deliberately ignores `settings.preview_open_modes`: a viewer invocation is
 * not a preview-panel preference, it always gets the dedicated shell.
 *
 * Register once, from the main window's setup. Detached windows never call
 * this, so they ignore the message.
 */
export function useFileViewerPresenter() {
  const store = useFileViewerStore()

  async function present(msg: SyncOpenFileViewer): Promise<void> {
    if (isTauri()) {
      try {
        await tauriInvoke('open_preview_window', {
          kind: 'file',
          sourcePaneId: msg.pane_id,
          path: msg.path,
          title: msg.title?.trim() || basename(msg.path),
        })
        return
      } catch (error) {
        // The window could not be created (or the command is unavailable):
        // fall through to the overlay so the request is never dropped.
        console.warn('[file-viewer] native window failed, using overlay', error)
      }
    }
    store.show(msg)
  }

  const unsubscribe = onOpenFileViewer((msg) => {
    void present(msg)
  })
  onScopeDispose(unsubscribe)

  return {
    /** Non-null while the overlay should be mounted. */
    request: computed(() => store.request),
    present,
  }
}
