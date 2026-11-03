import { isTauri } from './useTransport'
import {
  PREVIEW_DOCK_REQUEST_EVENT,
  PREVIEW_DOCK_RESULT_EVENT,
  type PreviewDockFailureReason,
  type PreviewDockRequest,
  type PreviewDockResult,
} from './previewWindowBridge'

export type PreviewDockOutcome = 'ok' | PreviewDockFailureReason

export interface PreviewDockReceiverOptions {
  /** Insert the preview into the main window's current workspace. */
  dock: (request: PreviewDockRequest) => Promise<PreviewDockOutcome>
  /** Close the preview window after a successful insert. */
  closeWindow: (windowLabel: string) => Promise<void>
  /** Surface a failed merge to the user. */
  notify: (outcome: Exclude<PreviewDockOutcome, 'ok'>) => void
}

const PREVIEW_LABEL_PREFIX = 'preview-'
/** Bound the replay guard; a dock request id is only meaningful for a moment. */
const HANDLED_LIMIT = 100

function isPreviewLabel(label: string): boolean {
  return label.startsWith(PREVIEW_LABEL_PREFIX) && label.length > PREVIEW_LABEL_PREFIX.length
}

function isDockRequest(value: unknown): value is PreviewDockRequest {
  if (!value || typeof value !== 'object') return false
  const request = value as Partial<PreviewDockRequest>
  return (
    typeof request.requestId === 'string' &&
    request.requestId.length > 0 &&
    typeof request.windowLabel === 'string' &&
    isPreviewLabel(request.windowLabel) &&
    (request.kind === 'files' || request.kind === 'web')
  )
}

/**
 * Main-window side of the preview dock gesture.
 *
 * A preview window emits `preview-window-dock-request` when its title bar has
 * settled over the main window. This listener merges the preview into the
 * current workspace and, on success, closes the source window. Failures are
 * reported both to the user (`notify`) and back to the preview window (which
 * stays open so nothing is lost).
 *
 * Returns a disposer; a no-op outside the desktop app.
 */
export function usePreviewDockReceiver(options: PreviewDockReceiverOptions): () => void {
  if (!isTauri()) return () => {}
  const tauri = (window as any).__TAURI__
  const listen = tauri?.event?.listen
  const emitTo = tauri?.event?.emitTo
  if (typeof listen !== 'function' || typeof emitTo !== 'function') return () => {}

  let disposed = false
  let unlisten: (() => void) | null = null
  const handled = new Set<string>()

  async function handle(value: unknown): Promise<void> {
    if (disposed || !isDockRequest(value)) return
    const request = value
    if (handled.has(request.requestId)) return
    if (handled.size >= HANDLED_LIMIT) handled.clear()
    handled.add(request.requestId)

    let outcome: PreviewDockOutcome
    try {
      outcome = await options.dock(request)
    } catch (error) {
      console.warn('[preview-dock] merge failed', error)
      outcome = 'insert-failed'
    }

    if (outcome === 'ok') {
      try {
        await options.closeWindow(request.windowLabel)
      } catch (error) {
        // The pane is already in the layout; a stuck window can be closed by
        // the user, so do not report a failed merge.
        console.warn('[preview-dock] failed to close preview window', error)
      }
      return
    }

    options.notify(outcome)
    if (disposed) return
    const result: PreviewDockResult = {
      requestId: request.requestId,
      ok: false,
      reason: outcome,
    }
    try {
      await emitTo(request.windowLabel, PREVIEW_DOCK_RESULT_EVENT, result)
    } catch (error) {
      console.warn('[preview-dock] failed to send the merge result', error)
    }
  }

  void Promise.resolve(
    listen(PREVIEW_DOCK_REQUEST_EVENT, (event: { payload?: unknown }) => {
      void handle(event?.payload)
    })
  )
    .then((fn: () => void) => {
      if (disposed) fn()
      else unlisten = fn
    })
    .catch((error: unknown) => {
      console.warn('[preview-dock] failed to listen for merge requests', error)
    })

  return () => {
    disposed = true
    unlisten?.()
    unlisten = null
    handled.clear()
  }
}
